import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INITIAL_TABLES,
  createJobQueue,
  migrateDownAll,
  migrateToLatest,
  openDatabase,
  seedCategories,
  seedDevFixtures,
} from './index';
import type { DatabaseHandle } from './index';

/**
 * Runs the same migrations and queue against PostgreSQL to keep the second dialect honest.
 * Skipped unless TEST_DATABASE_URL points at a disposable database; CI provides one.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgreSQL dialect', () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await openDatabase(url!);
    await migrateDownAll(handle.db);
  });
  afterAll(async () => {
    await migrateDownAll(handle.db);
    await handle.close();
  });

  it('applies migrations, and re-running is a no-op', async () => {
    expect((await migrateToLatest(handle.db)).applied).toEqual(['0001_initial']);
    expect((await migrateToLatest(handle.db)).applied).toEqual([]);
    const tables = (await handle.db.introspection.getTables()).map((t) => t.name);
    for (const table of INITIAL_TABLES) expect(tables).toContain(table);
  });

  it('loads seed data idempotently', async () => {
    expect(await seedCategories(handle.db)).toBeGreaterThan(0);
    expect(await seedCategories(handle.db)).toBe(0);
    const first = await seedDevFixtures(handle.db);
    expect(await seedDevFixtures(handle.db)).toEqual(first);
    const repo = await handle.db.selectFrom('repositories').selectAll().executeTakeFirstOrThrow();
    expect(typeof repo.github_id).toBe('number');
  });

  it('runs the job queue: dedupe, claim once, retry, complete', async () => {
    const queue = createJobQueue(handle.db, { backoffBaseMs: 1 });
    const first = await queue.enqueue('noop', { n: 1 }, { dedupeKey: 'pg:1' });
    expect((await queue.enqueue('noop', {}, { dedupeKey: 'pg:1' })).id).toBe(first.id);

    const [a, b] = await Promise.all([queue.claim('a', [], 60_000), queue.claim('b', [], 60_000)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const owner = a ? 'a' : 'b';

    expect(await queue.fail(first.id, owner, 'boom')).toBe('retry');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const retried = await queue.claim('c', [], 60_000);
    expect(retried?.attempts).toBe(2);
    expect(await queue.complete(first.id, 'c', { ok: true })).toBe(true);
    expect((await queue.get(first.id))?.status).toBe('succeeded');
  });
});
