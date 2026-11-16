import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CATEGORIES,
  INITIAL_TABLES,
  hasDevFixtures,
  migrateDownAll,
  migrateToLatest,
  openDatabase,
  removeDevFixtures,
  seedCategories,
  seedDevFixtures,
} from './index';
import type { DatabaseHandle } from './index';

let handle: DatabaseHandle;

beforeEach(async () => {
  handle = await openDatabase('file::memory:');
});
afterEach(async () => {
  await handle.close();
});

const tableNames = async () =>
  (await handle.db.introspection.getTables()).map((t) => t.name).sort();

describe('migrations', () => {
  it('creates every table on an empty database', async () => {
    const outcome = await migrateToLatest(handle.db);
    expect(outcome.applied).toEqual(['0001_initial']);
    expect(await tableNames()).toEqual([...INITIAL_TABLES].sort());
  });

  it('is a no-op when run again', async () => {
    await migrateToLatest(handle.db);
    const second = await migrateToLatest(handle.db);
    expect(second.applied).toEqual([]);
  });

  it('rolls back to an empty schema', async () => {
    await migrateToLatest(handle.db);
    await migrateDownAll(handle.db);
    expect(await tableNames()).toEqual([]);
  });
});

describe('schema constraints', () => {
  const repo = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    github_id: 1,
    owner: 'o',
    name: 'n',
    full_name_lower: 'o/n',
    discovery_source: 'test',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeEach(async () => {
    await migrateToLatest(handle.db);
  });

  it('applies column defaults', async () => {
    await handle.db.insertInto('repositories').values(repo()).execute();
    const row = await handle.db.selectFrom('repositories').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('active');
    expect(row.stars).toBe(0);
    expect(row.previous_full_names).toBe('[]');
  });

  it('rejects values outside an enumeration', async () => {
    await expect(
      handle.db
        .insertInto('repositories')
        .values(repo({ status: 'bogus' })) // not in the enumeration
        .execute(),
    ).rejects.toThrow(/CHECK/i);
  });

  it('enforces foreign keys', async () => {
    await expect(
      handle.db
        .insertInto('skills')
        .values({
          id: 's1',
          repository_id: 'missing',
          path: '',
          slug: 'o/n/s',
          name: 's',
          first_indexed_at: '2026-01-01T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        })
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it('keys a repository by its stable GitHub id', async () => {
    await handle.db.insertInto('repositories').values(repo()).execute();
    await expect(
      handle.db
        .insertInto('repositories')
        .values(repo({ id: 'r2', full_name_lower: 'renamed/n' }))
        .execute(),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('allows one skill per directory in a repository', async () => {
    await handle.db.insertInto('repositories').values(repo()).execute();
    const skill = (id: string, path: string) => ({
      id,
      repository_id: 'r1',
      path,
      slug: `o/n/${id}`,
      name: id,
      first_indexed_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    await handle.db.insertInto('skills').values(skill('a', 'skills/a')).execute();
    await handle.db.insertInto('skills').values(skill('b', 'skills/b')).execute();
    await expect(
      handle.db.insertInto('skills').values(skill('c', 'skills/a')).execute(),
    ).rejects.toThrow(/UNIQUE/i);
  });
});

describe('seed data', () => {
  beforeEach(async () => {
    await migrateToLatest(handle.db);
  });

  it('seeds categories idempotently', async () => {
    expect(await seedCategories(handle.db)).toBe(DEFAULT_CATEGORIES.length);
    expect(await seedCategories(handle.db)).toBe(0);
  });

  it('marks every fixture row as development-only and removes them cleanly', async () => {
    await seedCategories(handle.db);
    expect(await hasDevFixtures(handle.db)).toBe(false);

    const first = await seedDevFixtures(handle.db);
    expect(first.repositories).toBeGreaterThan(0);
    expect(first.skills).toBeGreaterThan(0);
    expect(await seedDevFixtures(handle.db)).toEqual({ repositories: 0, skills: 0 });
    expect(await hasDevFixtures(handle.db)).toBe(true);

    const repos = await handle.db.selectFrom('repositories').selectAll().execute();
    for (const r of repos) {
      expect(r.discovery_source).toBe('dev-fixture');
      expect(r.github_id).toBeLessThan(0);
    }

    await removeDevFixtures(handle.db);
    expect(await hasDevFixtures(handle.db)).toBe(false);
    const leftover = await handle.db.selectFrom('skills').select('id').execute();
    expect(leftover).toEqual([]);
  });
});
