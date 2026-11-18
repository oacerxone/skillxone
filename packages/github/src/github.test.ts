import { describe, expect, it } from 'vitest';
import {
  GitHubClient,
  GitHubError,
  NotFoundError,
  RateLimitError,
  codeSearchProvider,
  collectionProvider,
  extractRepoLinks,
  parseRepoRef,
  repoSearchProvider,
  seedProvider,
  starBands,
} from './index';
import type { DiscoveryProvider, FetchLike, RepoCandidate } from './index';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const SHA = 'a'.repeat(40);

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** Fake fetch that answers from a queue of canned responses and records every call. */
function fakeFetch(responses: Array<Response | Error | ((call: Call) => Response)>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, headers: { ...(init?.headers as Record<string, string>) } };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request to ${url}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call) : next;
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

function client(responses: Parameters<typeof fakeFetch>[0], options: { token?: string } = {}) {
  const { fetchImpl, calls } = fakeFetch(responses);
  const sleeps: number[] = [];
  const gh = new GitHubClient({
    token: options.token,
    fetch: fetchImpl,
    now: () => NOW,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    retryBaseMs: 100,
    maxInlineWaitMs: 5000,
  });
  return { gh, calls, sleeps };
}

const REF = { owner: 'octo', repo: 'skills' };
const resetIn = (seconds: number) => String(Math.floor(NOW.getTime() / 1000) + seconds);

describe('parseRepoRef', () => {
  it.each([
    ['octo/skills', 'octo', 'skills'],
    ['https://github.com/octo/skills', 'octo', 'skills'],
    ['https://github.com/octo/skills.git', 'octo', 'skills'],
    ['https://github.com/octo/skills/', 'octo', 'skills'],
    ['https://github.com/octo/skills/tree/main/skills/x', 'octo', 'skills'],
    ['https://www.github.com/Octo-Org/my.repo_1', 'Octo-Org', 'my.repo_1'],
    ['  octo/skills  ', 'octo', 'skills'],
  ])('accepts %s', (input, owner, repo) => {
    expect(parseRepoRef(input)).toEqual({ owner, repo });
  });

  it.each([
    '',
    'octo',
    'octo/skills/extra',
    'http://github.com/octo/skills',
    'https://gitlab.com/octo/skills',
    'https://github.com.evil.example/octo/skills',
    'https://evil.example/github.com/octo/skills',
    'https://user:pass@github.com/octo/skills',
    'https://github.com:8443/octo/skills',
    'https://169.254.169.254/latest/meta-data',
    'http://localhost:3000/a/b',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ssh://git@github.com/octo/skills',
    'git@github.com:octo/skills.git',
    '-octo/skills',
    'octo-/skills',
    'oc--to/skills',
    'octo/..',
    'octo/.',
    'octo/sk ills',
    'octo/skills?x=1',
    'octo/skills#frag',
    '../../etc/passwd',
    `${'a'.repeat(40)}/skills`,
    'x'.repeat(400),
  ])('rejects %j', (input) => {
    expect(parseRepoRef(input)).toBeNull();
  });

  it('extracts distinct repository links from Markdown', () => {
    const md =
      'See https://github.com/octo/skills and [x](https://github.com/Octo/Skills/tree/main) plus https://github.com/a/b. Not https://gitlab.com/c/d.';
    expect(extractRepoLinks(md)).toEqual([
      { owner: 'octo', repo: 'skills' },
      { owner: 'a', repo: 'b' },
    ]);
  });
});

describe('GitHubClient requests', () => {
  it('sends the token only to the API host and identifies itself', async () => {
    const { gh, calls } = client(
      [json({ id: 1 }, { headers: { etag: '"abc"' } }), new Response('file')],
      { token: 'secret-token' },
    );
    const result = await gh.getRepo(REF);
    expect(result.etag).toBe('"abc"');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/octo/skills');
    expect(calls[0]?.headers.Authorization).toBe('Bearer secret-token');
    expect(calls[0]?.headers['User-Agent']).toBeTruthy();

    await gh.fetchRawFile(REF, SHA, 'skills/x/SKILL.md', 1000);
    expect(calls[1]?.url).toBe(
      `https://raw.githubusercontent.com/octo/skills/${SHA}/skills/x/SKILL.md`,
    );
    expect(calls[1]?.headers.Authorization).toBeUndefined();
  });

  it('refuses invalid references before any request is made', async () => {
    const { gh, calls } = client([]);
    await expect(gh.getRepo({ owner: '../evil', repo: 'x' })).rejects.toThrow(GitHubError);
    await expect(gh.getTree(REF, 'main')).rejects.toThrow(GitHubError);
    await expect(gh.fetchRawFile(REF, SHA, '../../secret', 10)).rejects.toThrow(GitHubError);
    await expect(gh.fetchRawFile(REF, SHA, '/etc/passwd', 10)).rejects.toThrow(GitHubError);
    await expect(gh.fetchRawFile(REF, 'HEAD', 'a', 10)).rejects.toThrow(GitHubError);
    expect(calls).toHaveLength(0);
  });

  it('uses conditional requests and reports 304 as unmodified', async () => {
    const { gh, calls } = client([new Response(null, { status: 304 })]);
    const result = await gh.getRepo(REF, '"abc"');
    expect(result).toMatchObject({ modified: false, data: null, etag: '"abc"' });
    expect(calls[0]?.headers['If-None-Match']).toBe('"abc"');
    expect(gh.rateLimit.notModified).toBe(1);
  });

  it('maps 404 to NotFoundError', async () => {
    const { gh } = client([json({ message: 'Not Found' }, { status: 404 })]);
    await expect(gh.getRepo(REF)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('retries server errors with exponential backoff, then succeeds', async () => {
    const { gh, sleeps, calls } = client([
      new Response('', { status: 502 }),
      new Response('', { status: 503 }),
      json({ id: 7 }),
    ]);
    expect((await gh.getRepo(REF)).data).toEqual({ id: 7 });
    expect(sleeps).toEqual([100, 200]);
    expect(calls).toHaveLength(3);
  });

  it('gives up after the retry limit and reports the failure', async () => {
    const { gh, calls } = client(
      Array.from({ length: 4 }, () => new Response('', { status: 500 })),
    );
    await expect(gh.getRepo(REF)).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(calls).toHaveLength(4);
  });

  it('retries network errors without leaking details', async () => {
    const { gh } = client([new TypeError('fetch failed: secret-token in url'), json({ id: 1 })], {
      token: 'secret-token',
    });
    expect((await gh.getRepo(REF)).data).toEqual({ id: 1 });

    const failing = client(
      Array.from({ length: 4 }, () => new TypeError('boom secret-token')),
      {
        token: 'secret-token',
      },
    );
    const error: unknown = await failing.gh.getRepo(REF).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as Error).message).not.toContain('secret-token');
  });

  it('tracks the rate-limit budget from response headers', async () => {
    const { gh } = client([
      json(
        { id: 1 },
        {
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4321',
            'x-ratelimit-reset': resetIn(600),
          },
        },
      ),
    ]);
    await gh.getRepo(REF);
    expect(gh.rateLimit).toMatchObject({ limit: 5000, remaining: 4321, requests: 1 });
    expect(gh.rateLimit.resetAt?.getTime()).toBe(NOW.getTime() + 600_000);
  });

  it('throws RateLimitError with the reset time when the primary limit is exhausted', async () => {
    const { gh, calls } = client([
      json(
        { message: 'rate limit' },
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': resetIn(1800) },
        },
      ),
    ]);
    const error = await gh.getRepo(REF).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).kind).toBe('primary');
    expect((error as RateLimitError).resetAt.getTime()).toBe(NOW.getTime() + 1_800_000);
    expect(calls).toHaveLength(1); // not hammered
  });

  it('sleeps through a short secondary limit using Retry-After', async () => {
    const { gh, sleeps } = client([
      json({ message: 'slow down' }, { status: 429, headers: { 'retry-after': '2' } }),
      json({ id: 1 }),
    ]);
    expect((await gh.getRepo(REF)).data).toEqual({ id: 1 });
    expect(sleeps).toEqual([2250]);
  });

  it('does not mistake an ordinary 403 for a rate limit', async () => {
    const { gh } = client([
      json({ message: 'forbidden' }, { status: 403, headers: { 'x-ratelimit-remaining': '50' } }),
    ]);
    await expect(gh.getRepo(REF)).rejects.toMatchObject({ code: 'UNEXPECTED', status: 403 });
  });

  it('reads the branch head as a bare SHA and validates it', async () => {
    const ok = client([new Response(`${SHA}\n`)]);
    expect(await ok.gh.getBranchHead(REF, 'main')).toBe(SHA);
    expect(ok.calls[0]?.headers.Accept).toBe('application/vnd.github.sha');

    const bad = client([new Response('<html>not a sha</html>')]);
    await expect(bad.gh.getBranchHead(REF, 'main')).rejects.toThrow(GitHubError);
  });

  it('returns the tree and its truncated flag', async () => {
    const { gh, calls } = client([
      json({
        sha: SHA,
        truncated: true,
        tree: [{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'b', size: 3 }],
      }),
    ]);
    const tree = await gh.getTree(REF, SHA);
    expect(tree.truncated).toBe(true);
    expect(tree.tree).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://api.github.com/repos/octo/skills/git/trees/${SHA}?recursive=1`,
    );
  });
});

describe('pagination', () => {
  it('follows next links and stops at the page limit', async () => {
    const page = (n: number, hasNext: boolean) =>
      json(
        { items: [{ full_name: `o/r${n}`, private: false }] },
        hasNext
          ? {
              headers: {
                link: `<https://api.github.com/search/repositories?q=x&page=${n + 1}>; rel="next"`,
              },
            }
          : {},
      );
    const { gh, calls } = client([page(1, true), page(2, true), page(3, true)]);
    const names: string[] = [];
    for await (const items of gh.searchRepositories('x', 2))
      names.push(...items.map((i) => i.full_name));
    expect(names).toEqual(['o/r1', 'o/r2']);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain('page=2');
  });

  it('ignores a next link that points at another host', async () => {
    const { gh, calls } = client([
      json({ items: [] }, { headers: { link: '<https://evil.example/steal>; rel="next"' } }),
    ]);
    for await (const page of gh.searchRepositories('x', 5)) void page;
    expect(calls).toHaveLength(1);
  });
});

describe('raw file download', () => {
  it('stops reading at the size limit', async () => {
    const { gh } = client([new Response('x'.repeat(5000))]);
    const result = await gh.fetchRawFile(REF, SHA, 'big.txt', 1000);
    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(1000);
  });

  it('returns small files whole', async () => {
    const { gh } = client([new Response('hello')]);
    const result = await gh.fetchRawFile(REF, SHA, 'a b/ü.md', 1000);
    expect(new TextDecoder().decode(result.content)).toBe('hello');
    expect(result.truncated).toBe(false);
  });

  it('encodes path segments', async () => {
    const { gh, calls } = client([new Response('x')]);
    await gh.fetchRawFile(REF, SHA, 'a b/c#d?.md', 10);
    expect(calls[0]?.url.endsWith('/a%20b/c%23d%3F.md')).toBe(true);
  });

  it('maps a missing file to NotFoundError', async () => {
    const { gh } = client([new Response('', { status: 404 })]);
    await expect(gh.fetchRawFile(REF, SHA, 'gone.md', 10)).rejects.toBeInstanceOf(NotFoundError);
  });
});

async function collect(provider: DiscoveryProvider) {
  const report = { notes: [] as string[] };
  const candidates: RepoCandidate[] = [];
  for await (const candidate of provider.discover(report)) candidates.push(candidate);
  return { candidates, notes: report.notes };
}

describe('discovery providers', () => {
  it('seed provider validates entries and reports bad ones', async () => {
    const { candidates, notes } = await collect(
      seedProvider([
        'octo/skills',
        'https://github.com/a/b',
        'not a repo',
        'https://evil.example/a/b',
      ]),
    );
    expect(candidates).toEqual([
      { owner: 'octo', repo: 'skills', source: 'seed' },
      { owner: 'a', repo: 'b', source: 'seed' },
    ]);
    expect(notes).toHaveLength(2);
  });

  it('repository search skips private repositories and survives a rate limit', async () => {
    const { gh } = client([
      json({ total_count: 2 }),
      json({
        items: [
          { full_name: 'a/public', private: false },
          { full_name: 'a/secret', private: true },
        ],
      }),
      json(
        { message: 'limit' },
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': resetIn(3600) },
        },
      ),
    ]);
    const { candidates, notes } = await collect(
      repoSearchProvider(gh, ['topic:agent-skills', 'topic:other'], { pauseMs: 0 }),
    );
    expect(candidates).toEqual([{ owner: 'a', repo: 'public', source: 'repo-search' }]);
    expect(notes[0]).toContain('RATE_LIMITED');
  });

  it('builds star bands from the floor upwards', () => {
    expect(starBands(5)).toEqual([
      { lo: 5, hi: 9 },
      { lo: 10, hi: 19 },
      { lo: 20, hi: 49 },
      { lo: 50, hi: 99 },
      { lo: 100, hi: 499 },
      { lo: 500, hi: 1999 },
      { lo: 2000, hi: null },
    ]);
    expect(starBands(3000)).toEqual([{ lo: 3000, hi: null }]);
  });

  it('recent search lists recently pushed repositories above the star floor', async () => {
    const { gh, calls } = client([
      json({ total_count: 1 }),
      json({ items: [{ full_name: 'a/b' }] }),
    ]);
    const { candidates } = await collect(
      repoSearchProvider(gh, ['topic:agent-skills'], { pauseMs: 0, minStars: 5, now: () => NOW }),
    );
    expect(candidates).toEqual([{ owner: 'a', repo: 'b', source: 'repo-search' }]);
    const q = decodeURIComponent(calls[1]!.url);
    expect(q).toContain('stars:>=5');
    expect(q).toContain('pushed:>=2026-05-29');
    expect(q).toContain('sort=updated');
  });

  it('full search splits a band over the result cap by creation date, pausing between requests', async () => {
    const pauses: number[] = [];
    const page = (name: string) => json({ items: [{ full_name: name }] });
    const { gh, calls } = client([
      json({ total_count: 1500 }), // band stars:>=2000 is over the cap
      json({ total_count: 2500 }), // whole date range: still over, split
      json({ total_count: 600 }), // first half
      page('a/old'),
      json({ total_count: 700 }), // second half
      page('a/new'),
    ]);
    const { candidates } = await collect(
      repoSearchProvider(gh, ['topic:x'], {
        mode: 'full',
        minStars: 2000,
        pauseMs: 50,
        sleep: async (ms) => {
          pauses.push(ms);
        },
        now: () => NOW,
      }),
    );
    expect(candidates.map((c) => `${c.owner}/${c.repo}`)).toEqual(['a/old', 'a/new']);
    expect(decodeURIComponent(calls[2]!.url)).toMatch(/created:2008-01-01\.\.\d{4}-\d{2}-\d{2}/);
    expect(pauses).toHaveLength(calls.length - 1);
  });

  it('code search is skipped, visibly, without a token', async () => {
    const { gh, calls } = client([]);
    const { candidates, notes } = await collect(codeSearchProvider(gh));
    expect(candidates).toEqual([]);
    expect(notes).toEqual(['Code search skipped: it requires a GitHub token.']);
    expect(calls).toHaveLength(0);
  });

  it('code search yields repositories when authenticated', async () => {
    const { gh } = client(
      [json({ items: [{ path: 'skills/x/SKILL.md', repository: { full_name: 'a/b' } }] })],
      {
        token: 't',
      },
    );
    const { candidates } = await collect(codeSearchProvider(gh, ['filename:SKILL.md']));
    expect(candidates).toEqual([{ owner: 'a', repo: 'b', source: 'code-search' }]);
  });

  it('collection provider reads links from a README', async () => {
    const { gh } = client([
      json({ id: 1, default_branch: 'main' }),
      new Response(SHA),
      new Response('- https://github.com/a/b\n- https://github.com/octo/list (self)\n'),
    ]);
    const { candidates } = await collect(collectionProvider(gh, ['octo/list']));
    expect(candidates).toEqual([{ owner: 'a', repo: 'b', source: 'collection' }]);
  });
});
