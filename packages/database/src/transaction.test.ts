import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest, openDatabase, writeTransaction } from './index';
import type { DatabaseHandle } from './index';

const Database = createRequire(import.meta.url)('better-sqlite3') as new (path: string) => {
  pragma(source: string): unknown;
  prepare(sql: string): { run(...args: unknown[]): unknown };
  close(): void;
};

describe('writeTransaction on SQLite', () => {
  let dir: string;
  let handle: DatabaseHandle;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'skillxone-tx-'));
    handle = await openDatabase(`file:${join(dir, 'tx.db')}`);
    await migrateToLatest(handle.db);
  });
  afterEach(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes the write lock before the first statement, so a read-then-write cannot be refused midway', async () => {
    const other = new Database(join(dir, 'tx.db'));
    other.pragma('busy_timeout = 0');
    const write = () =>
      other
        .prepare("insert into settings (key, value_json, updated_at) values ('other', '1', 'x')")
        .run();
    try {
      await writeTransaction(handle.db, async (trx) => {
        // Only a read so far; a deferred transaction would not hold the write lock yet.
        await trx.selectFrom('settings').selectAll().execute();
        expect(write).toThrow(/locked|busy/i);
        await trx
          .insertInto('settings')
          .values({ key: 'mine', value_json: '1', updated_by: null, updated_at: 'x' })
          .execute();
      });
      // After commit the other connection can write again.
      expect(write).not.toThrow();
    } finally {
      other.close();
    }
    const keys = (
      await handle.db.selectFrom('settings').select('key').orderBy('key').execute()
    ).map((r) => r.key);
    expect(keys).toEqual(['mine', 'other']);
  });

  it('rolls back on error', async () => {
    await expect(
      writeTransaction(handle.db, async (trx) => {
        await trx
          .insertInto('settings')
          .values({ key: 'gone', value_json: '1', updated_by: null, updated_at: 'x' })
          .execute();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await handle.db.selectFrom('settings').selectAll().execute()).toEqual([]);
    // The connection is usable afterwards.
    await writeTransaction(handle.db, async (trx) => {
      await trx
        .insertInto('settings')
        .values({ key: 'ok', value_json: '1', updated_by: null, updated_at: 'x' })
        .execute();
    });
    expect(await handle.db.selectFrom('settings').select('key').execute()).toEqual([{ key: 'ok' }]);
  });
});
