import { isValidRepoRef } from './refs';
import type { RepoRef } from './refs';

/**
 * Minimal GitHub REST client for ingestion (ADR-004).
 *
 * - Requests go only to fixed hosts; owner and repository names are validated first.
 * - Conditional requests (ETag) make an unchanged resource cost almost nothing.
 * - Primary and secondary rate limits are honoured: short waits are slept through,
 *   long ones surface as `RateLimitError` so the job can be parked until the reset time.
 * - 5xx responses and network errors are retried with exponential backoff.
 * - The token is sent only to api.github.com and never appears in errors or logs.
 */

export const API_HOST = 'https://api.github.com';
export const RAW_HOST = 'https://raw.githubusercontent.com';
const API_VERSION = '2022-11-28';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitHubClientOptions {
  token?: string;
  fetch?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  maxRetries?: number;
  /** Longest rate-limit wait to sleep through inside a request; longer waits throw. */
  maxInlineWaitMs?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}
export class NotFoundError extends GitHubError {
  constructor(what: string) {
    super(`Not found: ${what}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}
export class RateLimitError extends GitHubError {
  constructor(
    public readonly resetAt: Date,
    public readonly kind: 'primary' | 'secondary',
  ) {
    super(
      `GitHub ${kind} rate limit reached; retry after ${resetAt.toISOString()}`,
      'RATE_LIMITED',
      429,
    );
    this.name = 'RateLimitError';
  }
}

export interface RateLimitState {
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
  /** Requests sent by this client instance, for reporting. */
  requests: number;
  notModified: number;
}

export interface ApiResult<T> {
  /** False when the server answered 304 Not Modified. */
  modified: boolean;
  data: T | null;
  etag: string | null;
  /** URL of the next page, taken from the Link header. */
  next: string | null;
}

export interface RepoMetadata {
  id: number;
  owner: { login: string; id: number; type: string };
  name: string;
  full_name: string;
  description: string | null;
  homepage: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  private: boolean;
  pushed_at: string | null;
  created_at: string | null;
  license: { spdx_id: string | null } | null;
}

export interface GitTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}
export interface GitTree {
  sha: string;
  truncated: boolean;
  tree: GitTreeItem[];
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class GitHubClient {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly options: Required<
    Pick<
      GitHubClientOptions,
      'maxRetries' | 'maxInlineWaitMs' | 'retryBaseMs' | 'requestTimeoutMs' | 'userAgent'
    >
  >;
  private readonly token: string | undefined;
  readonly rateLimit: RateLimitState = {
    limit: null,
    remaining: null,
    resetAt: null,
    requests: 0,
    notModified: 0,
  };

  constructor(options: GitHubClientOptions = {}) {
    this.token = options.token || undefined;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      maxInlineWaitMs: options.maxInlineWaitMs ?? 20_000,
      retryBaseMs: options.retryBaseMs ?? 1000,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      // GitHub requires a User-Agent. The default is generic; operators can set their own.
      userAgent: options.userAgent ?? 'agent-skills-indexer',
    };
  }

  get authenticated(): boolean {
    return this.token !== undefined;
  }

  private assertRef(ref: RepoRef): void {
    if (!isValidRepoRef(ref)) throw new GitHubError('Invalid repository reference', 'INVALID_REF');
  }

  private readRateHeaders(response: Response): void {
    const number = (name: string) => {
      const value = response.headers.get(name);
      return value === null || value === '' ? null : Number(value);
    };
    const limit = number('x-ratelimit-limit');
    const remaining = number('x-ratelimit-remaining');
    const reset = number('x-ratelimit-reset');
    if (limit !== null && Number.isFinite(limit)) this.rateLimit.limit = limit;
    if (remaining !== null && Number.isFinite(remaining)) this.rateLimit.remaining = remaining;
    if (reset !== null && Number.isFinite(reset)) this.rateLimit.resetAt = new Date(reset * 1000);
  }

  /** Decides whether a 403/429 is a rate limit, and until when to wait. */
  private rateLimitFrom(response: Response): RateLimitError | null {
    if (response.status !== 403 && response.status !== 429) return null;
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return new RateLimitError(new Date(this.now().getTime() + retryAfter * 1000), 'secondary');
    }
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const resetAt =
        Number.isFinite(reset) && reset > 0
          ? new Date(reset * 1000)
          : new Date(this.now().getTime() + 60_000);
      return new RateLimitError(resetAt, 'primary');
    }
    // 429 without headers: treat as a secondary limit with a conservative wait.
    return response.status === 429
      ? new RateLimitError(new Date(this.now().getTime() + 60_000), 'secondary')
      : null;
  }

  /**
   * Sends one API request with retries. `url` must be on the API host; it is either built
   * by this class or taken from a Link header that is checked against the host.
   */
  private async send(url: string, etag?: string | null, accept?: string): Promise<Response> {
    if (!url.startsWith(`${API_HOST}/`))
      throw new GitHubError('Refusing non-API URL', 'INVALID_URL');
    const headers: Record<string, string> = {
      Accept: accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': this.options.userAgent,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (etag) headers['If-None-Match'] = etag;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      let response: Response;
      try {
        this.rateLimit.requests += 1;
        response = await this.fetchImpl(url, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(this.options.requestTimeoutMs),
        });
      } catch (cause) {
        // Network failure or timeout: retry. The cause may mention the URL but never the token.
        lastError = new GitHubError(
          `Network error: ${cause instanceof Error ? cause.name : 'unknown'}`,
          'NETWORK',
        );
        if (attempt < this.options.maxRetries) {
          await this.sleep(this.options.retryBaseMs * 2 ** attempt);
          continue;
        }
        break;
      }

      this.readRateHeaders(response);

      const limited = this.rateLimitFrom(response);
      if (limited) {
        const waitMs = limited.resetAt.getTime() - this.now().getTime();
        if (waitMs <= this.options.maxInlineWaitMs && attempt < this.options.maxRetries) {
          await this.sleep(Math.max(0, waitMs) + 250);
          continue;
        }
        throw limited;
      }

      if (response.status >= 500) {
        lastError = new GitHubError(
          `GitHub server error ${response.status}`,
          'SERVER_ERROR',
          response.status,
        );
        if (attempt < this.options.maxRetries) {
          await this.sleep(this.options.retryBaseMs * 2 ** attempt);
          continue;
        }
        break;
      }
      return response;
    }
    throw lastError instanceof Error ? lastError : new GitHubError('Request failed', 'NETWORK');
  }

  private nextLink(response: Response): string | null {
    const link = response.headers.get('link');
    if (!link) return null;
    const match = /<([^>]+)>;\s*rel="next"/.exec(link);
    const url = match?.[1];
    return url && url.startsWith(`${API_HOST}/`) ? url : null;
  }

  private async json<T>(url: string, what: string, etag?: string | null): Promise<ApiResult<T>> {
    const response = await this.send(url, etag);
    if (response.status === 304) {
      this.rateLimit.notModified += 1;
      return { modified: false, data: null, etag: etag ?? null, next: null };
    }
    if (response.status === 404 || response.status === 451) throw new NotFoundError(what);
    if (response.status === 409)
      throw new GitHubError(`Repository is empty: ${what}`, 'EMPTY_REPOSITORY', 409);
    if (response.status === 401)
      throw new GitHubError('GitHub rejected the token', 'UNAUTHORIZED', 401);
    if (response.status === 422)
      throw new GitHubError(
        `GitHub could not process the request for ${what}`,
        'UNPROCESSABLE',
        422,
      );
    if (!response.ok) {
      throw new GitHubError(
        `Unexpected GitHub response ${response.status} for ${what}`,
        'UNEXPECTED',
        response.status,
      );
    }
    return {
      modified: true,
      data: (await response.json()) as T,
      etag: response.headers.get('etag'),
      next: this.nextLink(response),
    };
  }

  /** Repository metadata. Renamed and transferred repositories are followed by redirect. */
  async getRepo(ref: RepoRef, etag?: string | null): Promise<ApiResult<RepoMetadata>> {
    this.assertRef(ref);
    return this.json(
      `${API_HOST}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
      `${ref.owner}/${ref.repo}`,
      etag,
    );
  }

  /** Repository metadata by numeric id, which is stable across renames and transfers. */
  async getRepoById(id: number, etag?: string | null): Promise<ApiResult<RepoMetadata>> {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new GitHubError('Invalid repository id', 'INVALID_REF');
    return this.json(`${API_HOST}/repositories/${id}`, `repository ${id}`, etag);
  }

  /** Commit SHA at the tip of a branch (a small request that returns only the SHA). */
  async getBranchHead(ref: RepoRef, branch: string): Promise<string> {
    this.assertRef(ref);
    const url = `${API_HOST}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/commits/${encodeURIComponent(branch)}`;
    const response = await this.send(url, null, 'application/vnd.github.sha');
    if (response.status === 404 || response.status === 422)
      throw new NotFoundError(`branch ${branch}`);
    if (response.status === 409)
      throw new GitHubError('Repository is empty', 'EMPTY_REPOSITORY', 409);
    if (!response.ok)
      throw new GitHubError(
        `Unexpected GitHub response ${response.status}`,
        'UNEXPECTED',
        response.status,
      );
    const sha = (await response.text()).trim();
    if (!/^[0-9a-f]{40}$/.test(sha))
      throw new GitHubError('GitHub returned an invalid commit SHA', 'UNEXPECTED');
    return sha;
  }

  /** File listing of a commit or tree. `truncated` is true when GitHub cut a very large tree. */
  async getTree(ref: RepoRef, sha: string, recursive = true): Promise<GitTree> {
    this.assertRef(ref);
    if (!/^[0-9a-f]{40}$/.test(sha))
      throw new GitHubError('Invalid tree or commit SHA', 'INVALID_REF');
    const url = `${API_HOST}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`;
    const result = await this.json<GitTree>(url, `tree ${sha.slice(0, 7)}`);
    return result.data!;
  }

  /** Follows `rel="next"` links up to `maxPages`, yielding each page's items. */
  async *paginate<T>(firstUrl: string, what: string, maxPages: number): AsyncGenerator<T[]> {
    let url: string | null = firstUrl;
    for (let page = 0; url && page < maxPages; page += 1) {
      const result: ApiResult<{ items?: T[] } | T[]> = await this.json(url, what);
      const data = result.data;
      yield Array.isArray(data) ? data : (data?.items ?? []);
      url = result.next;
    }
  }

  /** Repository search. 30 requests per minute authenticated, 10 unauthenticated; 1000 results per query. */
  searchRepositories(
    query: string,
    maxPages = 3,
    sort: 'stars' | 'updated' = 'stars',
  ): AsyncGenerator<RepoMetadata[]> {
    const url = `${API_HOST}/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=100`;
    return this.paginate(url, 'repository search', maxPages);
  }

  /** Number of repositories a search matches (GitHub returns at most 1000 of them). */
  async countRepositories(query: string): Promise<number> {
    const url = `${API_HOST}/search/repositories?q=${encodeURIComponent(query)}&per_page=1`;
    const result = await this.json<{ total_count?: unknown }>(url, 'repository search count');
    const total = Number(result.data?.total_count);
    return Number.isFinite(total) && total >= 0 ? total : 0;
  }

  /**
   * Code search. Requires authentication, is limited to about 10 requests per minute and
   * 1000 results per query, and only covers default branches. Treated as a scarce resource.
   */
  searchCode(
    query: string,
    maxPages = 2,
  ): AsyncGenerator<Array<{ path: string; repository: { full_name: string } }>> {
    if (!this.token) throw new GitHubError('Code search requires a GitHub token', 'UNAUTHORIZED');
    const url = `${API_HOST}/search/code?q=${encodeURIComponent(query)}&per_page=100`;
    return this.paginate(url, 'code search', maxPages);
  }

  /**
   * Downloads one file at an exact commit from the raw content host, which does not use the
   * API quota. The body is streamed and abandoned as soon as it exceeds `maxBytes`, so a
   * huge file never has to fit in memory.
   */
  async fetchRawFile(
    ref: RepoRef,
    commitSha: string,
    path: string,
    maxBytes: number,
  ): Promise<{ content: Uint8Array; truncated: boolean }> {
    this.assertRef(ref);
    if (!/^[0-9a-f]{40}$/.test(commitSha))
      throw new GitHubError('Invalid commit SHA', 'INVALID_REF');
    if (
      path.startsWith('/') ||
      path.split('/').some((segment) => segment === '..' || segment === '.')
    ) {
      throw new GitHubError('Invalid file path', 'INVALID_REF');
    }
    const url = `${RAW_HOST}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${commitSha}/${encodePath(path)}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        // No Authorization header: the token is never sent to the raw host.
        const response = await this.fetchImpl(url, {
          headers: { 'User-Agent': this.options.userAgent },
          redirect: 'error',
          signal: AbortSignal.timeout(this.options.requestTimeoutMs),
        });
        if (response.status === 404) throw new NotFoundError(path);
        if (response.status === 429 || response.status >= 500) {
          lastError = new GitHubError(
            `Raw host answered ${response.status}`,
            'SERVER_ERROR',
            response.status,
          );
          if (attempt < this.options.maxRetries) {
            await this.sleep(this.options.retryBaseMs * 2 ** attempt);
            continue;
          }
          break;
        }
        if (!response.ok)
          throw new GitHubError(
            `Raw host answered ${response.status}`,
            'UNEXPECTED',
            response.status,
          );
        return await readBounded(response, maxBytes);
      } catch (cause) {
        if (cause instanceof GitHubError) throw cause;
        lastError = new GitHubError(
          `Network error: ${cause instanceof Error ? cause.name : 'unknown'}`,
          'NETWORK',
        );
        if (attempt < this.options.maxRetries)
          await this.sleep(this.options.retryBaseMs * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new GitHubError('Download failed', 'NETWORK');
  }
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<{ content: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { content: new Uint8Array(), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const content = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.length;
  }
  return { content, truncated };
}
