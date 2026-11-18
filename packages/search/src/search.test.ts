import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listSkills,
  migrateToLatest,
  openDatabase,
  seedCategories,
  seedDevFixtures,
} from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { createSearchBackend, toFtsQuery, tokenize } from './index';
import type { SearchBackend } from './index';

let handle: DatabaseHandle;
let search: SearchBackend;

beforeEach(async () => {
  handle = await openDatabase('file::memory:');
  await migrateToLatest(handle.db);
  await seedCategories(handle.db);
  await seedDevFixtures(handle.db, () => new Date('2026-06-01T00:00:00.000Z'));
  search = createSearchBackend(handle);
  await search.rebuild();
});
afterEach(async () => {
  await handle.close();
});

const names = async (query: string) =>
  (
    await listSkills(handle.db, {
      restrictToIds: await search.search(query),
      textMatched: true,
      pageSize: 100,
    })
  ).items.map((s) => s.name);

describe('query building', () => {
  it('tokenises to bounded lowercase words', () => {
    expect(tokenize('  SQL-Query  Reviewer! ')).toEqual(['sql', 'query', 'reviewer']);
    expect(tokenize('a b c d e f g h i j k')).toHaveLength(8);
    expect(tokenize('x'.repeat(500))[0]).toHaveLength(40);
    expect(tokenize('"*:^()')).toEqual([]);
  });

  it('quotes every token and makes the last one a prefix', () => {
    expect(toFtsQuery('sql rev')).toBe('"sql" "rev"*');
    expect(toFtsQuery('docker', 'name')).toBe('name : ("docker"*)');
    expect(toFtsQuery('   ')).toBeNull();
  });

  it('neutralises FTS5 syntax in user input', () => {
    expect(toFtsQuery('foo" OR "bar')).toBe('"foo" "or" "bar"*');
    expect(toFtsQuery('NEAR(a b, 2)')).toBe('"near" "a" "b" "2"*');
    expect(toFtsQuery('name:secret -x ^y *')).toBe('"name" "secret" "x" "y"*');
  });
});

describe('search', () => {
  it('indexes every active skill', async () => {
    expect(await search.health()).toMatchObject({ ok: true, indexed: 25, expected: 25 });
  });

  it('matches by prefix while typing', async () => {
    expect(await names('dock')).toEqual(['dockerfile-reviewer']);
    expect(await names('terra')).toEqual(['terraform-plan-explainer']);
  });

  it('stems words', async () => {
    // "reviewing" and "reviews" share a stem with "reviewer"/"reviews" in the fixtures.
    expect(await names('reviewing')).toContain('pull-request-reviewer');
  });

  it('requires every term', async () => {
    expect(await names('sql review')).toEqual(['sql-query-reviewer']);
    expect(await names('sql nonsenseword')).toEqual([]);
  });

  it('ranks a name match above a body-only match', async () => {
    // Every fixture body contains the word "procedure"; only one name can contain "csv".
    const results = await names('csv');
    expect(results[0]).toBe('csv-profiler');
    // "spreadsheet-cleaner" mentions CSV only in its description, so it comes after.
    expect(results).toContain('spreadsheet-cleaner');
    expect(results.indexOf('csv-profiler')).toBeLessThan(results.indexOf('spreadsheet-cleaner'));
  });

  it('searches the SKILL.md body, repository and category', async () => {
    expect((await names('repeatable reviewable')).length).toBe(25); // phrase from every body
    expect((await names('ops-skills')).length).toBe(4); // repository name
    expect(await names('analytics')).toEqual(expect.arrayContaining(['csv-profiler'])); // category name
  });

  it('returns nothing for input with no searchable terms', async () => {
    for (const query of ['', '   ', '"', '***', '()', '-', ':^']) {
      expect(await search.search(query), JSON.stringify(query)).toEqual([]);
    }
  });

  it('survives hostile input without errors', async () => {
    const hostile = [
      '" OR 1=1 --',
      "'; DROP TABLE skills_fts; --",
      'NEAR(',
      'a AND',
      'NOT',
      '"unbalanced',
      'name:',
      '{a b}',
      'a* b* c*',
      '\u0000\u0001',
      '%_%',
      '😀 🚀',
      'x'.repeat(5000),
    ];
    for (const query of hostile) {
      await expect(
        search.search(query),
        JSON.stringify(query.slice(0, 20)),
      ).resolves.toBeInstanceOf(Array);
      await expect(search.suggest(query)).resolves.toBeInstanceOf(Array);
    }
    expect((await search.health()).ok).toBe(true);
  });

  it('caps the number of results', async () => {
    expect(await search.search('fixture', 3)).toHaveLength(3);
    expect((await search.search('fixture', 1_000_000)).length).toBeLessThanOrEqual(1000);
  });
});

describe('combined with catalog filters', () => {
  const run = async (q: string, extra: Parameters<typeof listSkills>[1] = {}) =>
    listSkills(handle.db, { restrictToIds: await search.search(q), textMatched: true, ...extra });

  it('applies filters to search results', async () => {
    const all = await run('reviewer');
    const verified = await run('reviewer', { verification: 'VERIFIED' });
    const devops = await run('reviewer', {
      verification: 'VERIFIED',
      category: 'devops',
      agent: 'codex',
    });
    expect(all.total).toBeGreaterThan(verified.total - 1);
    expect(verified.items.every((s) => s.verificationState === 'VERIFIED')).toBe(true);
    // The name match comes first; other results matched "review" in their instructions.
    expect(devops.items[0]?.name).toBe('dockerfile-reviewer');
    expect(
      devops.items.every((s) => s.verificationState === 'VERIFIED' && s.agents.includes('codex')),
    ).toBe(true);
    expect(devops.total).toBeLessThan(verified.total);
  });

  it('paginates search results stably and without overlap', async () => {
    const pageSize = 4;
    const first = await run('fixture', { pageSize, page: 1 });
    expect(first.total).toBe(25);
    const seen: string[] = [];
    for (let page = 1; page <= first.pageCount; page += 1) {
      const result = await run('fixture', { pageSize, page });
      seen.push(...result.items.map((s) => s.id));
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    // Same query, same order.
    const again = await run('fixture', { pageSize, page: 1 });
    expect(again.items.map((s) => s.id)).toEqual(first.items.map((s) => s.id));
  });

  it('lets an explicit sort override relevance order', async () => {
    const byName = await run('reviewer', { sort: 'name' });
    const sorted = [...byName.items.map((s) => s.name)].sort();
    expect(byName.items.map((s) => s.name)).toEqual(sorted);
  });

  it('blends quality into the order of equally relevant matches', async () => {
    const [risky, safe] = ['fixture_skill_remote-setup-helper', 'fixture_skill_ci-pipeline-doctor'];
    const score = (id: string, quality: number) =>
      handle.db
        .insertInto('ranking_scores')
        .values({
          skill_id: id,
          quality_score: quality,
          signals_json: '{}',
          weights_version: '1',
          computed_at: '2026-06-01T00:00:00.000Z',
        })
        .execute();
    await score(risky, 0.05);
    await score(safe, 0.9);
    // Both are in "ops-skills"; the repository term matches them equally.
    const ids = await search.search('ops-skills');
    expect(ids.indexOf(safe)).toBeLessThan(ids.indexOf(risky));
  });
});

describe('suggestions', () => {
  it('completes skill names', async () => {
    const suggestions = await search.suggest('read');
    expect(suggestions[0]).toMatchObject({
      name: 'readme-writer',
      slug: 'example-fixture/docs-skills/readme-writer',
    });
    expect(await search.suggest('zzzz')).toEqual([]);
  });
});

describe('index maintenance', () => {
  it('re-indexes one repository after its skills change', async () => {
    await handle.db
      .updateTable('skills')
      .set({ name: 'zebra-striper', description: 'Paints stripes.' })
      .where('id', '=', 'fixture_skill_csv-profiler')
      .execute();
    expect(await names('zebra')).toEqual([]); // not indexed yet
    expect(await search.indexRepository('fixture_repo_data-skills')).toBe(3);
    expect(await names('zebra')).toEqual(['zebra-striper']);
    expect(await names('paints stripes')).toEqual(['zebra-striper']);
    expect((await search.health()).ok).toBe(true);
  });

  it('drops removed skills from the index', async () => {
    await handle.db
      .updateTable('skills')
      .set({ status: 'removed' })
      .where('id', '=', 'fixture_skill_csv-profiler')
      .execute();
    await search.indexRepository('fixture_repo_data-skills');
    expect(await search.health()).toMatchObject({ ok: true, indexed: 24, expected: 24 });
  });

  it('reports an out-of-date index', async () => {
    await handle.db
      .updateTable('skills')
      .set({ status: 'removed' })
      .where('id', '=', 'fixture_skill_csv-profiler')
      .execute();
    const health = await search.health();
    expect(health).toMatchObject({ ok: false, indexed: 25, expected: 24 });
    expect(health.detail).toContain('reindex');
  });

  it('detects a corrupt index and repairs it by rebuilding', async () => {
    // A file database, so a second low-level connection can damage the index the way disk
    // corruption would. SQLite normally forbids writing to FTS internals; unsafe mode lifts
    // that for this test only.
    const dir = mkdtempSync(join(tmpdir(), 'skillxone-search-'));
    const file = join(dir, 'catalog.db');
    const onDisk = await openDatabase(`file:${file}`);
    try {
      await migrateToLatest(onDisk.db);
      await seedCategories(onDisk.db);
      await seedDevFixtures(onDisk.db);
      const backend = createSearchBackend(onDisk);
      await backend.rebuild();
      expect((await backend.health()).ok).toBe(true);

      const raw = new BetterSqlite3(file);
      raw.unsafeMode(true);
      raw.prepare("update skills_search_data set block = x'deadbeef' where id > 10").run();
      raw.close();

      const damaged = await backend.health();
      expect(damaged.ok).toBe(false);
      expect(damaged.detail).toContain('damaged');

      expect(await backend.rebuild()).toBe(25);
      expect(await backend.health()).toMatchObject({ ok: true, indexed: 25 });
      expect((await backend.search('dockerfile')).length).toBeGreaterThan(0);
    } finally {
      await onDisk.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recreates a missing index on demand', async () => {
    await sql`drop table skills_search`.execute(handle.db);
    await sql`drop table skills_search_map`.execute(handle.db);
    await search.ensure();
    expect(await search.search('docker')).toEqual([]);
    expect((await search.health()).ok).toBe(false);
    await search.rebuild();
    expect(await names('docker')).toEqual(['dockerfile-reviewer']);
  });
  it('keeps no copy of the documents and removes deleted skills on re-index', async () => {
    const tables = await sql<{ name: string }>`
      select name from sqlite_master where name like 'skills_search%'
    `.execute(handle.db);
    expect(tables.rows.map((row) => row.name)).not.toContain('skills_search_content');

    const hit = await handle.db
      .selectFrom('skills')
      .select(['id', 'repository_id'])
      .where('name', '=', 'dockerfile-reviewer')
      .executeTakeFirstOrThrow();
    await handle.db.deleteFrom('skills').where('id', '=', hit.id).execute();
    await search.indexRepository(hit.repository_id);
    expect(await names('dockerfile')).toEqual([]);
    expect((await search.health()).ok).toBe(true);
  });

  it('drops the legacy full-copy table once', async () => {
    await sql`create virtual table skills_fts using fts5(name)`.execute(handle.db);
    expect(await search.dropLegacy()).toBe(true);
    expect(await search.dropLegacy()).toBe(false);
  });
});
