import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compressStoredFiles,
  createJobQueue,
  getSkillFile,
  migrateToLatest,
  openDatabase,
  seedCategories,
  vacuumSqlite,
} from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { GitHubClient } from '@skillxone/github';
import { createDefaultScanners } from '@skillxone/security';
import { skillCapForStars } from '@skillxone/shared';
import { createProcessors } from './processors';
import type { SeedFile } from './processors';
import { syncRepository } from './sync';
import type { SyncDeps } from './sync';
import { FakeGitHub, skillMd } from './test-support';
import type { FakeRepo } from './test-support';

const OFFLINE_SCAN = { scanners: createDefaultScanners({ osv: null, gitleaksBinary: null }) };

let handle: DatabaseHandle;
let github: FakeGitHub;
let deps: SyncDeps;
const now = new Date('2026-06-01T00:00:00.000Z');

function repo(id: number, owner: string, stars: number, files: Record<string, string>): FakeRepo {
  return { id, owner, ownerId: id, name: 'skills', stars, files };
}
const target = (owner: string) => ({ owner, repo: 'skills', source: 'test' });

beforeEach(async () => {
  handle = await openDatabase('file::memory:');
  await migrateToLatest(handle.db);
  await seedCategories(handle.db);
  github = new FakeGitHub();
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

const activeNames = async (owner: string) =>
  (
    await handle.db
      .selectFrom('skills as s')
      .innerJoin('repositories as r', 'r.id', 's.repository_id')
      .select('s.name')
      .where('r.owner', '=', owner)
      .where('s.status', '=', 'active')
      .orderBy('s.name')
      .execute()
  ).map((row) => row.name);

const manySkills = (count: number) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const name = `skill-${String(i).padStart(2, '0')}`;
      return [`skills/${name}/SKILL.md`, skillMd(name)];
    }),
  );

describe('skill caps by stars', () => {
  it('scales the cap with stars and never exceeds the ceiling', () => {
    expect(skillCapForStars(0)).toBe(25);
    expect(skillCapForStars(5)).toBe(50);
    expect(skillCapForStars(50)).toBe(150);
    expect(skillCapForStars(5000)).toBe(500);
    expect(skillCapForStars(5000, 100)).toBe(100);
  });

  it('indexes only the first skills of a repository with no stars', async () => {
    github.repos.push(repo(1, 'nobody', 0, manySkills(30)));
    const summary = await syncRepository(deps, target('nobody'));
    expect(summary.overCap).toBe(5);
    const names = await activeNames('nobody');
    expect(names).toHaveLength(25);
    expect(names[0]).toBe('skill-00');
  });

  it('does not cap a protected (seed) repository', async () => {
    github.repos.push(repo(1, 'curated', 0, manySkills(30)));
    await syncRepository({ ...deps, protectedRepositories: ['Curated/skills'] }, target('curated'));
    expect(await activeNames('curated')).toHaveLength(30);
  });
});

describe('identical copies', () => {
  const original = { 'skills/alpha/SKILL.md': skillMd('alpha') };

  it('skips a copy of a skill already indexed from a more starred repository', async () => {
    github.repos.push(repo(1, 'origin', 200, original), repo(2, 'copier', 0, original));
    await syncRepository(deps, target('origin'));
    const summary = await syncRepository(deps, target('copier'));
    expect(summary.duplicates).toBe(1);
    expect(await activeNames('copier')).toEqual([]);
    expect(await activeNames('origin')).toEqual(['alpha']);
  });

  it('keeps the more starred copy when the copy was indexed first, and purges the other', async () => {
    github.repos.push(repo(1, 'origin', 200, original), repo(2, 'copier', 0, original));
    await syncRepository(deps, target('copier'));
    await syncRepository(deps, target('origin'));
    expect(await activeNames('copier')).toEqual(['alpha']);

    const seeds: SeedFile = { repositories: [], collections: [], searchQueries: [] };
    const processors = createProcessors({ ...deps, scan: OFFLINE_SCAN }, seeds);
    const result = await processors.compact_catalog!({}, {} as never);
    expect(result).toMatchObject({ duplicates: 1, purged: 1 });
    expect(await activeNames('copier')).toEqual([]);
    expect(await activeNames('origin')).toEqual(['alpha']);
    const left = await handle.db.selectFrom('skills').select('id').execute();
    expect(left).toHaveLength(1);
    await expect(vacuumSqlite(handle.db)).resolves.toBeUndefined();

    // Running it again changes nothing.
    expect(await processors.compact_catalog!({}, {} as never)).toMatchObject({
      duplicates: 0,
      capped: 0,
      purged: 0,
    });
  });

  it('keeps the copy in a protected repository even with fewer stars', async () => {
    github.repos.push(repo(1, 'popular', 900, original), repo(2, 'curated', 1, original));
    const protectedDeps = { ...deps, protectedRepositories: ['curated/skills'] };
    await syncRepository(protectedDeps, target('popular'));
    await syncRepository(protectedDeps, target('curated'));
    const seeds: SeedFile = {
      repositories: ['curated/skills'],
      collections: [],
      searchQueries: [],
    };
    await createProcessors({ ...deps, scan: OFFLINE_SCAN }, seeds).compact_catalog!(
      {},
      {} as never,
    );
    expect(await activeNames('curated')).toEqual(['alpha']);
    expect(await activeNames('popular')).toEqual([]);
  });
});

describe('catalog size guard', () => {
  it('stops adding new repositories once the catalog is full, but keeps existing ones current', async () => {
    github.repos.push(
      repo(1, 'first', 50, manySkills(3)),
      repo(2, 'second', 50, { 'skills/other/SKILL.md': skillMd('other') }),
    );
    const full = { ...deps, limits: { maxCatalogSkills: 3 } };
    expect((await syncRepository(full, target('first'))).created).toBe(3);
    const skipped = await syncRepository(full, target('second'));
    expect(skipped).toMatchObject({ status: 'skipped', detail: 'catalog full' });
    const codes = await handle.db.selectFrom('ingestion_errors').select('code').execute();
    expect(codes.map((row) => row.code)).toContain('CATALOG_FULL');

    github.repos[0]!.files['skills/skill-00/SKILL.md'] = skillMd('skill-00', 'Changed text.');
    github.repos[0]!.files['README.md'] = 'changed';
    expect((await syncRepository(full, target('first'))).status).toBe('synced');
  });
});

describe('file compression', () => {
  const longScript = `#!/bin/sh\n${'echo "a line of a long helper script"\n'.repeat(80)}`;

  it('stores long non-SKILL.md files compressed and reads them back unchanged', async () => {
    github.repos.push(
      repo(1, 'octo', 10, {
        'skills/alpha/SKILL.md': skillMd('alpha'),
        'skills/alpha/scripts/run.sh': longScript,
      }),
    );
    await syncRepository(deps, target('octo'));
    const rows = await handle.db
      .selectFrom('skill_files')
      .select(['path', 'content', 'content_encoding'])
      .orderBy('path')
      .execute();
    const md = rows.find((row) => row.path === 'SKILL.md')!;
    const script = rows.find((row) => row.path === 'scripts/run.sh')!;
    expect(md.content_encoding).toBeNull();
    expect(script.content_encoding).toBe('gzip-base64');
    expect(script.content!.length).toBeLessThan(longScript.length / 4);

    const skill = await handle.db.selectFrom('skills').select('slug').executeTakeFirstOrThrow();
    const file = await getSkillFile(handle.db, skill.slug, 'scripts/run.sh');
    expect(file?.content).toBe(longScript);
  });

  it('compresses files stored before compression existed, resumably', async () => {
    github.repos.push(
      repo(1, 'octo', 10, {
        'skills/alpha/SKILL.md': skillMd('alpha'),
        'skills/alpha/scripts/run.sh': longScript,
      }),
    );
    await syncRepository(deps, target('octo'));
    // Simulate a row written by the previous release.
    await handle.db
      .updateTable('skill_files')
      .set({ content: longScript, content_encoding: null })
      .where('path', '=', 'scripts/run.sh')
      .execute();

    const first = await compressStoredFiles(handle.db, '', 500);
    expect(first).toMatchObject({ compressed: 1, nextAfterId: null });
    expect((await compressStoredFiles(handle.db, '', 500)).compressed).toBe(0);
    const skill = await handle.db.selectFrom('skills').select('slug').executeTakeFirstOrThrow();
    expect((await getSkillFile(handle.db, skill.slug, 'scripts/run.sh'))?.content).toBe(longScript);
  });

  it('never treats stored text as compressed unless the column says so', async () => {
    const { decodeFileContent } = await import('@skillxone/database');
    expect(decodeFileContent('H4sIAAAAAAAA', null)).toBe('H4sIAAAAAAAA');
    expect(decodeFileContent('not base64 gzip', 'gzip-base64')).toBeNull();
    expect(decodeFileContent('x', 'something-else')).toBeNull();
  });
});
