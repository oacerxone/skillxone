import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupSqlite, restoreSqlite, verifySqliteFile } from './backup';
import { migrateToLatest, openDatabase, seedCategories, seedDevFixtures } from './index';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillxone-backup-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const count = async (url: string) => {
  const handle = await openDatabase(url);
  try {
    const row = await handle.db
      .selectFrom('skills')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  } finally {
    await handle.close();
  }
};

describe('SQLite backup and restore', () => {
  it('round-trips a live database', async () => {
    const url = `file:${join(dir, 'live.db')}`;
    const live = await openDatabase(url);
    await migrateToLatest(live.db);
    await seedCategories(live.db);
    await seedDevFixtures(live.db);

    // Back up while the connection is open and has uncheckpointed WAL content.
    const backup = join(dir, 'backups', 'one.db');
    const result = await backupSqlite(url, backup);
    expect(result.bytes).toBeGreaterThan(0);
    expect(await verifySqliteFile(backup)).toEqual({ ok: true, detail: 'ok' });
    await expect(backupSqlite(url, backup)).rejects.toThrow('already exists');

    // Damage the live data, then restore.
    await live.db.deleteFrom('skills').execute();
    await live.close();
    expect(await count(url)).toBe(0);

    const restored = await restoreSqlite(backup, url, { now: new Date('2026-06-01T00:00:00Z') });
    expect(restored.previous).toContain('before-restore-2026-06-01');
    expect(await count(url)).toBe(25);
    // The pre-restore state is kept so the restore can be undone.
    expect(await count(`file:${restored.previous!}`)).toBe(0);
  });

  it('refuses to restore something that is not a skillxone database', async () => {
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'not a database');
    expect((await verifySqliteFile(junk)).ok).toBe(false);
    await expect(restoreSqlite(junk, `file:${join(dir, 'x.db')}`)).rejects.toThrow(
      'Refusing to restore',
    );
    await expect(
      restoreSqlite(join(dir, 'missing.db'), `file:${join(dir, 'x.db')}`),
    ).rejects.toThrow('File not found');
    await expect(backupSqlite('file::memory:', join(dir, 'm.db'))).rejects.toThrow('in-memory');
    await expect(backupSqlite('postgres://x/y', join(dir, 'p.db'))).rejects.toThrow('pg_dump');
  });
});
