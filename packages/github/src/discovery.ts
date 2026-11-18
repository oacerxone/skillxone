import type { GitHubClient } from './client';
import { GitHubError } from './client';
import { extractRepoLinks, parseRepoRef } from './refs';
import type { RepoRef } from './refs';

/**
 * Discovery providers find repositories that may contain skills. They only produce
 * candidates; whether a candidate really has a SKILL.md is decided when it is synced.
 * To add a source, implement `DiscoveryProvider` and register it in the worker.
 */

export interface RepoCandidate extends RepoRef {
  /** Provider id, stored as the repository's `discovery_source` when first indexed. */
  source: string;
}

export interface DiscoveryReport {
  /** Human-readable notes: skipped providers, partial results. Never silently dropped. */
  notes: string[];
}

export interface DiscoveryProvider {
  id: string;
  discover(report: DiscoveryReport): AsyncIterable<RepoCandidate>;
}

/** Curated list of repositories, e.g. `catalog/seeds.json`. Invalid entries are reported. */
export function seedProvider(entries: readonly string[]): DiscoveryProvider {
  return {
    id: 'seed',
    async *discover(report) {
      for (const entry of entries) {
        const ref = parseRepoRef(entry);
        if (ref) yield { ...ref, source: 'seed' };
        else report.notes.push(`Ignored invalid seed entry: ${JSON.stringify(entry).slice(0, 80)}`);
      }
    },
  };
}

/** GitHub returns at most this many results for one search, however many pages are asked for. */
export const SEARCH_RESULT_CAP = 1000;
const PAGE_SIZE = 100;

export interface RepoSearchOptions {
  /**
   * `full` walks every matching repository by slicing each query into star bands, and the
   * bands into creation-date windows, until each slice has at most 1000 results. `recent`
   * lists only repositories pushed in the last few days, most recently updated first.
   */
  mode?: 'full' | 'recent';
  /** Repositories with fewer stars are not listed. */
  minStars?: number;
  /** Days back for `recent` mode. */
  recentDays?: number;
  /** Pause between search requests; GitHub allows 30 a minute with a token, 10 without. */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Star bands, low to high, starting at `minStars`. `hi` null means no upper bound. */
export function starBands(minStars: number): Array<{ lo: number; hi: number | null }> {
  const edges = [0, 1, 5, 10, 20, 50, 100, 500, 2000];
  const lows = [...new Set([minStars, ...edges.filter((edge) => edge > minStars)])].sort(
    (a, b) => a - b,
  );
  return lows.map((lo, index) => ({
    lo,
    hi: index + 1 < lows.length ? lows[index + 1]! - 1 : null,
  }));
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const starQualifier = (band: { lo: number; hi: number | null }) =>
  band.hi === null ? `stars:>=${band.lo}` : `stars:${band.lo}..${band.hi}`;

/** Repository search by topic or keyword. Public, unarchived repositories only. */
export function repoSearchProvider(
  client: GitHubClient,
  queries: readonly string[],
  options: RepoSearchOptions = {},
): DiscoveryProvider {
  const mode = options.mode ?? 'recent';
  const minStars = Math.max(0, Math.trunc(options.minStars ?? 0));
  const pauseMs = options.pauseMs ?? (client.authenticated ? 2_100 : 6_100);
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());

  return {
    id: mode === 'full' ? 'repo-search-full' : 'repo-search',
    async *discover(report) {
      let requests = 0;
      const paced = async <T>(work: () => Promise<T>): Promise<T> => {
        if (requests > 0 && pauseMs > 0) await sleep(pauseMs);
        requests += 1;
        return work();
      };
      const count = (q: string) => paced(() => client.countRepositories(q));

      async function* fetchSlice(
        q: string,
        total: number,
        sort: 'stars' | 'updated',
      ): AsyncGenerator<RepoCandidate> {
        const pages = Math.min(Math.ceil(Math.min(total, SEARCH_RESULT_CAP) / PAGE_SIZE), 10);
        if (pages === 0) return;
        const iterator = client.searchRepositories(q, pages, sort)[Symbol.asyncIterator]();
        // One paced request per page; the iterator ends by itself when no next page exists.
        for (let page = 0; page < pages; page += 1) {
          const next = await paced(() => iterator.next());
          if (next.done) break;
          for (const repo of next.value) {
            if (repo.private) continue;
            const ref = parseRepoRef(repo.full_name);
            if (ref) yield { ...ref, source: 'repo-search' };
          }
          // A short page is the last one: stop without spending a paced request on it.
          if (next.value.length < PAGE_SIZE) break;
        }
      }

      // Splits a slice by creation date until each part fits under the result cap.
      async function* byCreated(
        base: string,
        from: Date,
        to: Date,
        depth: number,
      ): AsyncGenerator<RepoCandidate> {
        const q = `${base} created:${day(from)}..${day(to)}`;
        const total = await count(q);
        const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
        if (total <= SEARCH_RESULT_CAP || spanDays < 2 || depth >= 12) {
          if (total > SEARCH_RESULT_CAP) {
            report.notes.push(
              `"${q}" matches ${total} repositories; only ${SEARCH_RESULT_CAP} are listed.`,
            );
          }
          yield* fetchSlice(q, total, 'stars');
          return;
        }
        const middle = new Date(from.getTime() + Math.floor(spanDays / 2) * 86_400_000);
        yield* byCreated(base, from, middle, depth + 1);
        yield* byCreated(base, new Date(middle.getTime() + 86_400_000), to, depth + 1);
      }

      for (const query of queries) {
        try {
          if (mode === 'recent') {
            const since = new Date(now().getTime() - (options.recentDays ?? 3) * 86_400_000);
            const q = `${query} archived:false stars:>=${minStars} pushed:>=${day(since)}`;
            yield* fetchSlice(q, await count(q), 'updated');
            continue;
          }
          for (const band of starBands(minStars)) {
            const base = `${query} archived:false ${starQualifier(band)}`;
            const total = await count(base);
            if (total <= SEARCH_RESULT_CAP) yield* fetchSlice(base, total, 'stars');
            else yield* byCreated(base, new Date('2008-01-01T00:00:00Z'), now(), 0);
          }
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          report.notes.push(`Repository search "${query}" stopped early: ${error.code}`);
          if (error.code === 'RATE_LIMITED') return;
        }
      }
    },
  };
}

/**
 * Code search for SKILL.md files. GitHub caps each query at 1000 results and about 10
 * requests per minute, so results are partitioned by path and this provider cannot claim
 * complete coverage. Without a token it reports that it was skipped.
 */
export function codeSearchProvider(
  client: GitHubClient,
  queries: readonly string[] = [
    'filename:SKILL.md path:skills',
    'filename:SKILL.md path:.claude/skills',
    'filename:SKILL.md path:.agents/skills',
  ],
): DiscoveryProvider {
  return {
    id: 'code-search',
    async *discover(report) {
      if (!client.authenticated) {
        report.notes.push('Code search skipped: it requires a GitHub token.');
        return;
      }
      for (const query of queries) {
        try {
          for await (const page of client.searchCode(query)) {
            for (const hit of page) {
              const ref = parseRepoRef(hit.repository.full_name);
              if (ref) yield { ...ref, source: 'code-search' };
            }
          }
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          report.notes.push(`Code search "${query}" stopped early: ${error.code}`);
          if (error.code === 'RATE_LIMITED') return;
        }
      }
    },
  };
}

/** Repositories linked from the README of known collection ("awesome list") repositories. */
export function collectionProvider(
  client: GitHubClient,
  collections: readonly string[],
): DiscoveryProvider {
  return {
    id: 'collection',
    async *discover(report) {
      for (const entry of collections) {
        const ref = parseRepoRef(entry);
        if (!ref) {
          report.notes.push(
            `Ignored invalid collection entry: ${JSON.stringify(entry).slice(0, 80)}`,
          );
          continue;
        }
        try {
          const repo = (await client.getRepo(ref)).data;
          if (!repo) continue;
          const head = await client.getBranchHead(ref, repo.default_branch);
          const readme = await client.fetchRawFile(ref, head, 'README.md', 1_000_000);
          const text = new TextDecoder().decode(readme.content);
          for (const linked of extractRepoLinks(text)) {
            if (
              linked.owner.toLowerCase() === ref.owner.toLowerCase() &&
              linked.repo.toLowerCase() === ref.repo.toLowerCase()
            ) {
              continue;
            }
            yield { ...linked, source: 'collection' };
          }
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          report.notes.push(`Collection ${ref.owner}/${ref.repo} could not be read: ${error.code}`);
          if (error.code === 'RATE_LIMITED') return;
        }
      }
    },
  };
}
