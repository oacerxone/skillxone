import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createJobQueue,
  getSkillBySlug,
  listSkills,
  migrateToLatest,
  openDatabase,
  seedCategories,
} from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { GitHubClient, RateLimitError } from '@skillxone/github';
import type { FetchLike } from '@skillxone/github';
import { createSearchBackend } from '@skillxone/search';
import { computeContentHash } from '@skillxone/skill-parser';
import { createProcessors, runDiscovery, runRanking } from './processors';
import { drainQueue } from './runner';
import { syncRepository } from './sync';
import type { SyncDeps } from './sync';

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
const skillMd = (name: string, description = `Does ${name} things.`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nInstructions.\n`;

interface FakeRepo {
  id: number;
  owner: string;
  ownerId: number;
  name: string;
  stars: number;
  private?: boolean;
  archived?: boolean;
  files: Record<string, string>;
  modes?: Record<string, string>;
}

/** An in-memory stand-in for api.github.com and raw.githubusercontent.com. */
class FakeGitHub {
  repos: FakeRepo[] = [];
  /** Old `owner/name` (lowercase) -> repository id, to emulate GitHub's rename redirects. */
  redirects = new Map<string, number>();
  apiCalls: string[] = [];
  rawCalls: string[] = [];
  rateLimited = false;
  truncateRecursive = false;

  head(repo: FakeRepo) {
    return sha1(JSON.stringify([repo.files, repo.modes ?? {}]));
  }
  private etag(repo: FakeRepo) {
    return `"${sha1(JSON.stringify([repo.owner, repo.ownerId, repo.name, repo.stars, repo.archived, this.head(repo)]))}"`;
  }
  private find(owner: string, name: string) {
    const key = `${owner}/${name}`.toLowerCase();
    return (
      this.repos.find((r) => `${r.owner}/${r.name}`.toLowerCase() === key) ??
      this.repos.find((r) => r.id === this.redirects.get(key))
    );
  }
  private treeItems(repo: FakeRepo, prefix: string, recursive: boolean) {
    const items = new Map<
      string,
      { path: string; mode: string; type: string; sha: string; size?: number }
    >();
    for (const [path, content] of Object.entries(repo.files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const segments = rest.split('/');
      if (recursive || segments.length === 1) {
        items.set(rest, {
          path: rest,
          mode: repo.modes?.[path] ?? '100644',
          type: 'blob',
          sha: sha1(`blob:${content}`),
          size: Buffer.byteLength(content),
        });
      }
      if (!recursive && segments.length > 1) {
        const dir = segments[0]!;
        items.set(dir, {
          path: dir,
          mode: '040000',
          type: 'tree',
          sha: sha1(`tree:${prefix}${dir}/`),
        });
      }
    }
    return [...items.values()];
  }

  fetch: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const { hostname, pathname, searchParams } = new URL(url);
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (hostname === 'raw.githubusercontent.com') {
      this.rawCalls.push(pathname);
      const [owner, name, commit, ...rest] = parts;
      const repo = this.find(owner!, name!);
      const content = repo && commit === this.head(repo) ? repo.files[rest.join('/')] : undefined;
      return content === undefined ? new Response('', { status: 404 }) : new Response(content);
    }

    this.apiCalls.push(pathname);
    if (this.rateLimited) {
      return new Response('{}', {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
      });
    }
    const [, owner, name, ...rest] = parts;
    const repo = this.find(owner!, name!);
    if (!repo) return Response.json({ message: 'Not Found' }, { status: 404 });

    if (rest.length === 0) {
      if (headers['If-None-Match'] === this.etag(repo)) return new Response(null, { status: 304 });
      return Response.json(
        {
          id: repo.id,
          owner: { login: repo.owner, id: repo.ownerId, type: 'Organization' },
          name: repo.name,
          full_name: `${repo.owner}/${repo.name}`,
          description: 'A fake repository',
          homepage: null,
          default_branch: 'main',
          stargazers_count: repo.stars,
          forks_count: 3,
          open_issues_count: 1,
          archived: repo.archived ?? false,
          disabled: false,
          fork: false,
          private: repo.private ?? false,
          pushed_at: '2026-05-01T00:00:00Z',
          created_at: '2025-01-01T00:00:00Z',
          license: { spdx_id: 'MIT' },
        },
        { headers: { etag: this.etag(repo) } },
      );
    }
    if (rest[0] === 'commits') return new Response(this.head(repo));
    if (rest[0] === 'git' && rest[1] === 'trees') {
      const sha = rest[2]!;
      const recursive = searchParams.get('recursive') === '1';
      if (sha === this.head(repo)) {
        if (recursive && this.truncateRecursive) {
          return Response.json({
            sha,
            truncated: true,
            tree: this.treeItems(repo, '', true).slice(0, 1),
          });
        }
        return Response.json({ sha, truncated: false, tree: this.treeItems(repo, '', recursive) });
      }
      const dirs = new Set(
        Object.keys(repo.files)
          .filter((p) => p.includes('/'))
          .map((p) => `${p.split('/')[0]}/`),
      );
      const prefix = [...dirs].find((dir) => sha1(`tree:${dir}`) === sha);
      if (prefix)
        return Response.json({ sha, truncated: false, tree: this.treeItems(repo, prefix, true) });
    }
    return Response.json({ message: 'Not Found' }, { status: 404 });
  };
}

let handle: DatabaseHandle;
let github: FakeGitHub;
let deps: SyncDeps;
let now: Date;
const TARGET = { owner: 'octo', repo: 'skills', source: 'seed' };

function repo(overrides: Partial<FakeRepo> = {}): FakeRepo {
  return {
    id: 1001,
    owner: 'octo',
    ownerId: 1,
    name: 'skills',
    stars: 100,
    files: {
      'README.md': '# Skills',
      'skills/alpha/SKILL.md': skillMd('alpha'),
      'skills/alpha/scripts/run.sh': '#!/bin/sh\necho hi\n',
      'skills/beta/SKILL.md': skillMd('beta'),
    },
    modes: { 'skills/alpha/scripts/run.sh': '100755' },
    ...overrides,
  };
}

beforeEach(async () => {
  handle = await openDatabase('file::memory:');
  await migrateToLatest(handle.db);
  await seedCategories(handle.db);
  github = new FakeGitHub();
  now = new Date('2026-06-01T00:00:00.000Z');
  deps = {
    db: handle.db,
    client: new GitHubClient({ fetch: github.fetch, sleep: async () => undefined, maxRetries: 0 }),
    queue: createJobQueue(handle.db, { clock: () => now }),
    now: () => now,
  };
});
afterEach(async () => {
  await handle.close();
});

const skillRow = (name: string) =>
  handle.db.selectFrom('skills').selectAll().where('name', '=', name).executeTakeFirst();
const errorCodes = async () =>
  (await handle.db.selectFrom('ingestion_errors').select('code').execute()).map((e) => e.code);
const queuedScans = async () =>
  (await handle.db.selectFrom('sync_jobs').select('id').where('type', '=', 'scan_skill').execute())
    .length;

describe('first sync', () => {
  it('indexes every skill as its own record with files, hash and commit', async () => {
    github.repos.push(repo());
    const summary = await syncRepository(deps, TARGET);
    expect(summary).toMatchObject({ status: 'synced', skillsFound: 2, created: 2, errors: 0 });
    expect(github.apiCalls).toHaveLength(3); // metadata, branch head, tree

    const alpha = await getSkillBySlug(handle.db, 'octo/skills/alpha');
    expect(alpha).toBeDefined();
    expect(alpha!.path).toBe('skills/alpha');
    expect(alpha!.stars).toBe(100);
    expect(alpha!.verificationState).toBe('UNVERIFIED');
    expect(alpha!.currentVersion?.commitSha).toBe(github.head(github.repos[0]!));
    expect(alpha!.files.map((f) => f.path)).toEqual(['SKILL.md', 'scripts/run.sh']);
    expect(alpha!.files.find((f) => f.path === 'scripts/run.sh')?.is_executable).toBe(1);
    expect(alpha!.agents).toEqual(['claude-code', 'codex']);

    // The stored hash is the lock-file-compatible hash of exactly these files.
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(alpha!.currentVersion?.contentHash).toBe(
      computeContentHash([
        { path: 'SKILL.md', content: encode(skillMd('alpha')) },
        { path: 'scripts/run.sh', content: encode('#!/bin/sh\necho hi\n') },
      ]),
    );
  });

  it('records a metrics snapshot and queues a scan per new version', async () => {
    github.repos.push(repo());
    await syncRepository(deps, TARGET);
    const metrics = await handle.db.selectFrom('github_metrics_history').selectAll().execute();
    expect(metrics).toMatchObject([{ captured_on: '2026-06-01', stars: 100 }]);
    expect(await queuedScans()).toBe(2);
  });

  it('reports an unknown repository instead of dropping it silently', async () => {
    const summary = await syncRepository(deps, {
      owner: 'nobody',
      repo: 'nothing',
      source: 'seed',
    });
    expect(summary.status).toBe('not_found');
    expect(await errorCodes()).toEqual(['NOT_FOUND']);
    expect(await handle.db.selectFrom('repositories').select('id').execute()).toEqual([]);
  });

  it('does not index private repositories', async () => {
    github.repos.push(repo({ private: true }));
    expect((await syncRepository(deps, TARGET)).status).toBe('skipped');
    expect((await listSkills(handle.db)).total).toBe(0);
    expect(await errorCodes()).toEqual(['PRIVATE']);
  });
});

describe('incremental sync', () => {
  beforeEach(async () => {
    github.repos.push(repo());
    await syncRepository(deps, TARGET);
    github.apiCalls = [];
    github.rawCalls = [];
  });

  it('costs one conditional request when nothing changed', async () => {
    const summary = await syncRepository(deps, TARGET);
    expect(summary.status).toBe('not_modified');
    expect(github.apiCalls).toHaveLength(1);
    expect(github.rawCalls).toHaveLength(0);
  });

  it('costs two requests and no downloads when only metadata changed', async () => {
    github.repos[0]!.stars = 250;
    const summary = await syncRepository(deps, TARGET);
    expect(summary.status).toBe('unchanged');
    expect(github.apiCalls).toHaveLength(2);
    expect(github.rawCalls).toHaveLength(0);
    expect((await getSkillBySlug(handle.db, 'octo/skills/alpha'))?.stars).toBe(250);
  });

  it('is idempotent when re-run against the same commit', async () => {
    await handle.db.updateTable('repositories').set({ head_sha: null, etag: null }).execute();
    const summary = await syncRepository(deps, TARGET);
    expect(summary).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(await handle.db.selectFrom('skill_versions').select('id').execute()).toHaveLength(2);
  });

  it('creates a new version and withdraws verification when content changes', async () => {
    const before = await skillRow('alpha');
    await handle.db
      .updateTable('skills')
      .set({ verification_state: 'VERIFIED', lifecycle_state: 'COMPLETE' })
      .where('id', '=', before!.id)
      .execute();
    const scansBefore = await queuedScans();

    now = new Date('2026-06-02T00:00:00.000Z');
    github.repos[0]!.files['skills/alpha/SKILL.md'] = skillMd('alpha', 'A changed description.');
    const summary = await syncRepository(deps, TARGET);
    expect(summary).toMatchObject({ updated: 1, unchanged: 1, created: 0 });

    const after = await skillRow('alpha');
    expect(after!.id).toBe(before!.id);
    expect(after!.current_version_id).not.toBe(before!.current_version_id);
    expect(after!.verification_state).toBe('UNVERIFIED');
    expect(after!.lifecycle_state).toBe('PENDING');
    expect(after!.description).toBe('A changed description.');

    const versions = await handle.db
      .selectFrom('skill_versions')
      .select('id')
      .where('skill_id', '=', before!.id)
      .execute();
    expect(versions).toHaveLength(2); // history is kept
    const records = await handle.db
      .selectFrom('verification_records')
      .selectAll()
      .where('skill_id', '=', before!.id)
      .orderBy('valid_from')
      .execute();
    expect(records.map((r) => r.reason)).toEqual(['NEW_SKILL', 'CONTENT_CHANGED']);
    expect(records[0]!.superseded_at).not.toBeNull();
    expect(records[1]!.superseded_at).toBeNull();
    expect(await queuedScans()).toBe(scansBefore + 1);
  });

  it('reuses the earlier version when content is reverted', async () => {
    const original = github.repos[0]!.files['skills/alpha/SKILL.md']!;
    github.repos[0]!.files['skills/alpha/SKILL.md'] = skillMd('alpha', 'Temporary.');
    await syncRepository(deps, TARGET);
    github.repos[0]!.files['skills/alpha/SKILL.md'] = original;
    await syncRepository(deps, TARGET);
    const alpha = await skillRow('alpha');
    const versions = await handle.db
      .selectFrom('skill_versions')
      .selectAll()
      .where('skill_id', '=', alpha!.id)
      .execute();
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.id === alpha!.current_version_id)?.description).toBe(
      'Does alpha things.',
    );
  });

  it('marks a deleted skill as removed and keeps its history', async () => {
    delete github.repos[0]!.files['skills/beta/SKILL.md'];
    const summary = await syncRepository(deps, TARGET);
    expect(summary.removed).toBe(1);
    expect((await skillRow('beta'))?.status).toBe('removed');
    expect((await listSkills(handle.db)).items.map((s) => s.name)).toEqual(['alpha']);
    expect(await handle.db.selectFrom('skill_versions').select('id').execute()).toHaveLength(2);
  });

  it('keeps the same record when a skill directory is renamed', async () => {
    const before = await skillRow('beta');
    const files = github.repos[0]!.files;
    files['skills/gamma/SKILL.md'] = files['skills/beta/SKILL.md']!;
    delete files['skills/beta/SKILL.md'];
    // The old path is gone and the content is identical, so it is the same skill, moved.
    const summary = await syncRepository(deps, TARGET);
    expect(summary).toMatchObject({ created: 0, removed: 0 });

    const rows = await handle.db.selectFrom('skills').selectAll().execute();
    expect(rows).toHaveLength(2);
    const moved = rows.find((r) => r.id === before!.id);
    expect(moved).toMatchObject({ path: 'skills/gamma', status: 'active' });
    // Same content, so no new version and no reason to rescan.
    expect(moved!.current_version_id).toBe(before!.current_version_id);
  });
});

describe('repository lifecycle', () => {
  beforeEach(async () => {
    github.repos.push(repo());
    await syncRepository(deps, TARGET);
  });

  it('follows a rename by GitHub id and moves skill URLs', async () => {
    github.repos[0]!.name = 'agent-skills';
    github.redirects.set('octo/skills', 1001);
    const summary = await syncRepository(deps, TARGET); // still asked for by the old name
    expect(summary.repository).toBe('octo/agent-skills');

    const rows = await handle.db.selectFrom('repositories').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'agent-skills', full_name_lower: 'octo/agent-skills' });
    expect(JSON.parse(rows[0]!.previous_full_names)).toEqual(['octo/skills']);
    expect(await getSkillBySlug(handle.db, 'octo/agent-skills/alpha')).toBeDefined();
    expect(await getSkillBySlug(handle.db, 'octo/skills/alpha')).toBeUndefined();
  });

  it('withdraws verification when ownership is transferred', async () => {
    await handle.db
      .updateTable('skills')
      .set({ verification_state: 'VERIFIED', lifecycle_state: 'COMPLETE' })
      .execute();
    Object.assign(github.repos[0]!, { owner: 'newco', ownerId: 2 });
    github.redirects.set('octo/skills', 1001);
    await syncRepository(deps, TARGET);

    const skills = await handle.db
      .selectFrom('skills')
      .select(['slug', 'verification_state'])
      .orderBy('slug')
      .execute();
    expect(skills).toEqual([
      { slug: 'newco/skills/alpha', verification_state: 'UNVERIFIED' },
      { slug: 'newco/skills/beta', verification_state: 'UNVERIFIED' },
    ]);
    expect(await errorCodes()).toContain('OWNER_CHANGED');
    const reasons = await handle.db
      .selectFrom('verification_records')
      .select('reason')
      .where('superseded_at', 'is', null)
      .execute();
    expect(reasons.every((r) => r.reason === 'OWNER_CHANGED')).toBe(true);
  });

  it('marks a repository deleted only after two consecutive misses', async () => {
    github.repos = [];
    expect((await syncRepository(deps, TARGET)).status).toBe('missing');
    expect((await listSkills(handle.db)).total).toBe(2); // one miss changes nothing visible

    expect((await syncRepository(deps, TARGET)).status).toBe('deleted');
    const row = await handle.db
      .selectFrom('repositories')
      .select(['status', 'missing_count'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'deleted', missing_count: 2 });
    expect((await listSkills(handle.db)).total).toBe(0);
    expect(await handle.db.selectFrom('skills').select('id').execute()).toHaveLength(2); // kept
  });

  it('recovers when a missing repository comes back', async () => {
    const saved = github.repos;
    github.repos = [];
    await syncRepository(deps, TARGET);
    github.repos = saved;
    saved[0]!.stars = 101; // force a metadata change
    await syncRepository(deps, TARGET);
    const row = await handle.db
      .selectFrom('repositories')
      .select(['status', 'missing_count'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'active', missing_count: 0 });
  });

  it('records an archived repository', async () => {
    github.repos[0]!.archived = true;
    await syncRepository(deps, TARGET);
    const row = await handle.db
      .selectFrom('repositories')
      .select(['status', 'is_archived'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'archived', is_archived: 1 });
    expect((await getSkillBySlug(handle.db, 'octo/skills/alpha'))?.repositoryArchived).toBe(true);
  });

  it('releases a name that now belongs to a different repository', async () => {
    github.repos = [repo({ id: 2002, ownerId: 9 })]; // same name, different repository
    await syncRepository(deps, TARGET);
    const rows = await handle.db
      .selectFrom('repositories')
      .select(['github_id', 'status', 'full_name_lower'])
      .orderBy('github_id')
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ github_id: 1001, status: 'unreachable' });
    expect(rows[1]).toMatchObject({
      github_id: 2002,
      status: 'active',
      full_name_lower: 'octo/skills',
    });
    expect(await errorCodes()).toContain('REPO_NAME_REUSED');
  });

  it('skips a repository an administrator disabled', async () => {
    await handle.db.updateTable('repositories').set({ status: 'disabled' }).execute();
    github.apiCalls = [];
    expect((await syncRepository(deps, TARGET)).status).toBe('skipped');
    expect(github.apiCalls).toHaveLength(0);
  });
});

describe('problem input', () => {
  it('indexes a malformed SKILL.md and records what is wrong with it', async () => {
    github.repos.push(
      repo({
        files: {
          'skills/broken/SKILL.md': '# No frontmatter here\n',
          'skills/Mismatch/SKILL.md': skillMd('other-name'),
        },
      }),
    );
    const summary = await syncRepository(deps, TARGET);
    expect(summary).toMatchObject({ created: 2, errors: 0 });

    const broken = await skillRow('broken');
    expect(broken).toMatchObject({ spec_valid: 0, description: '' });
    const version = await handle.db
      .selectFrom('skill_versions')
      .select('parse_errors_json')
      .where('id', '=', broken!.current_version_id!)
      .executeTakeFirstOrThrow();
    expect(JSON.parse(version.parse_errors_json).map((i: { code: string }) => i.code)).toContain(
      'MISSING_FRONTMATTER',
    );
    expect((await skillRow('other-name'))?.spec_valid).toBe(0);
  });

  it('does not store oversized files and flags the hash as not lock-compatible', async () => {
    github.repos.push(
      repo({
        files: { 'skills/big/SKILL.md': skillMd('big'), 'skills/big/data.txt': 'x'.repeat(5000) },
      }),
    );
    deps.limits = { maxFileBytes: 1000 };
    await syncRepository(deps, TARGET);
    const big = await getSkillBySlug(handle.db, 'octo/skills/big');
    expect(big!.files.find((f) => f.path === 'data.txt')).toMatchObject({
      truncated: 1,
      size_bytes: 5000,
    });
    expect(github.rawCalls.some((call) => call.endsWith('data.txt'))).toBe(false); // never downloaded
    const version = await handle.db
      .selectFrom('skill_versions')
      .select('parse_errors_json')
      .executeTakeFirstOrThrow();
    expect(version.parse_errors_json).toContain('HASH_NOT_LOCK_COMPATIBLE');
  });

  it('treats files containing NUL bytes as binary and stores no content', async () => {
    github.repos.push(
      repo({ files: { 'skills/bin/SKILL.md': skillMd('bin'), 'skills/bin/blob.dat': 'a\u0000b' } }),
    );
    await syncRepository(deps, TARGET);
    const file = await handle.db
      .selectFrom('skill_files')
      .selectAll()
      .where('path', '=', 'blob.dat')
      .executeTakeFirstOrThrow();
    expect(file).toMatchObject({ is_binary: 1, content: null, kind: 'binary' });
  });

  it('falls back to per-directory listing when the tree is truncated', async () => {
    github.repos.push(repo());
    github.truncateRecursive = true;
    const summary = await syncRepository(deps, TARGET);
    expect(summary).toMatchObject({ skillsFound: 2, created: 2, errors: 0 });
  });

  it('propagates a rate limit so the job can be parked', async () => {
    github.repos.push(repo());
    github.rateLimited = true;
    await expect(syncRepository(deps, TARGET)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('gives two skills with the same declared name distinct URLs', async () => {
    github.repos.push(
      repo({
        files: { 'a/dup/SKILL.md': skillMd('dup'), 'b/dup/SKILL.md': skillMd('dup', 'Another.') },
      }),
    );
    await syncRepository(deps, TARGET);
    const slugs = (
      await handle.db.selectFrom('skills').select('slug').orderBy('slug').execute()
    ).map((s) => s.slug);
    expect(slugs).toHaveLength(2);
    expect(slugs[0]).toBe('octo/skills/dup');
    expect(slugs[1]).toMatch(/^octo\/skills\/dup~[0-9a-f]{6}$/);
  });
});

describe('discovery and the queue', () => {
  const seeds = {
    repositories: ['octo/skills', 'https://github.com/octo/skills', 'bad entry'],
    collections: [],
    searchQueries: [],
  };

  it('queues one sync job per distinct repository and reports invalid seeds', async () => {
    const result = await runDiscovery(deps, seeds, 'seed');
    expect(result).toMatchObject({ candidates: 2, enqueued: 1 });
    expect(result.notes).toHaveLength(1);
    expect((await runDiscovery(deps, seeds, 'seed')).enqueued).toBe(0); // already queued
  });

  it('drains discovery through to indexed skills', async () => {
    github.repos.push(repo());
    await deps.queue.enqueue('discover', { provider: 'seed' });
    const summary = await drainQueue(deps.queue, createProcessors(deps, seeds), { workerId: 'w' });
    // discover -> sync_repo -> index_repo + rank
    expect(summary).toMatchObject({ succeeded: 4, dead: 0, retried: 0 });
    expect((await listSkills(handle.db)).total).toBe(2);
    // The new skills are searchable and ranked without any further step.
    const search = createSearchBackend(handle);
    expect(await search.health()).toMatchObject({ ok: true, indexed: 2 });
    expect(await search.search('alpha')).toHaveLength(1);
    const ranked = await listSkills(handle.db);
    expect(ranked.items.every((s) => s.quality !== null && s.quality > 0)).toBe(true);
    // scan jobs wait for a worker that knows how to run them
    expect(await queuedScans()).toBe(2);
  });

  it('parks sync jobs when GitHub is rate limited', async () => {
    github.repos.push(repo());
    github.rateLimited = true;
    await runDiscovery(deps, seeds, 'seed');
    const summary = await drainQueue(deps.queue, createProcessors(deps, seeds), { workerId: 'w' });
    expect(summary).toMatchObject({ deferred: 1, dead: 0, retried: 0 });
    const job = await handle.db
      .selectFrom('sync_jobs')
      .selectAll()
      .where('type', '=', 'sync_repo')
      .executeTakeFirstOrThrow();
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(new Date(job.run_after).getTime()).toBeGreaterThan(now.getTime());
  });

  it('recrawl queues previously indexed repositories, never fixtures', async () => {
    github.repos.push(repo());
    await syncRepository(deps, TARGET);
    now = new Date('2026-06-03T00:00:00.000Z');
    const result = await runDiscovery(deps, seeds, 'recrawl');
    expect(result).toMatchObject({ candidates: 1, enqueued: 1 });
  });

  it('rejects a queued payload that does not name a valid repository', async () => {
    await deps.queue.enqueue('sync_repo', { owner: '../..', repo: 'x' }, { maxAttempts: 1 });
    const summary = await drainQueue(deps.queue, createProcessors(deps, seeds), { workerId: 'w' });
    expect(summary.dead).toBe(1);
    expect(github.apiCalls).toHaveLength(0);
  });
});

describe('ranking job', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 5, 1 + n));

  it('scores every skill and explains the score', async () => {
    github.repos.push(repo());
    await syncRepository(deps, TARGET);
    const summary = await runRanking(handle.db, now);
    expect(summary).toEqual({ skills: 2, maxHistoryDays: 1 });

    const alpha = await getSkillBySlug(handle.db, 'octo/skills/alpha');
    expect(alpha!.quality).toBeGreaterThan(0);
    expect(alpha!.quality).toBeLessThanOrEqual(1);
    expect(Object.keys(alpha!.ranking!.signals)).toContain('popularity');
    expect(alpha!.ranking!.signals.growth!.explanation).toContain('Not enough recorded history');
  });

  it('produces trend scores only once seven days of real snapshots exist', async () => {
    github.repos.push(repo());
    for (let n = 0; n <= 8; n += 1) {
      now = day(n);
      github.repos[0]!.stars = 100 + n * 25; // the fake repository gains stars each day
      await syncRepository(deps, TARGET);
      await runRanking(handle.db, now);
      const row = await handle.db
        .selectFrom('ranking_scores')
        .select(['trending_score', 'history_days'])
        .executeTakeFirstOrThrow();
      if (n < 7) expect(row.trending_score, `day ${n}`).toBe(0);
      else expect(row.trending_score, `day ${n}`).toBeGreaterThan(0);
      expect(row.history_days).toBe(n + 1);
    }
    const trending = await listSkills(handle.db, { sort: 'trending' });
    expect(trending.items).toHaveLength(2);
  });

  it('sorts a flagged skill last under the recommended order', async () => {
    github.repos.push(repo());
    await syncRepository(deps, TARGET);
    await handle.db
      .updateTable('skills')
      .set({ verification_state: 'FLAGGED' })
      .where('name', '=', 'alpha')
      .execute();
    await handle.db
      .updateTable('skills')
      .set({ verification_state: 'VERIFIED' })
      .where('name', '=', 'beta')
      .execute();
    await runRanking(handle.db, now);
    const result = await listSkills(handle.db, { sort: 'recommended' });
    expect(result.items.map((s) => s.name)).toEqual(['beta', 'alpha']);
  });
});
