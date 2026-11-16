import { SqliteAdapter, sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from './types';

/**
 * Runs `fn` in a transaction that is allowed to write.
 *
 * On SQLite the transaction starts with BEGIN IMMEDIATE, which takes the write lock up front.
 * A plain (deferred) transaction that reads first and writes later cannot wait for the lock:
 * if another connection committed in between, SQLite fails it at once with "database is
 * locked" instead of honouring the busy timeout. Taking the lock first makes concurrent
 * writers (web app and worker) queue politely. PostgreSQL uses a normal transaction.
 */
export async function writeTransaction<T>(
  db: Kysely<Database>,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  if (!(db.getExecutor().adapter instanceof SqliteAdapter)) return db.transaction().execute(fn);
  return db.connection().execute(async (connection) => {
    await sql`begin immediate`.execute(connection);
    try {
      // A Transaction is a Kysely bound to one connection; this connection is exactly that.
      const result = await fn(connection as unknown as Transaction<Database>);
      await sql`commit`.execute(connection);
      return result;
    } catch (error) {
      await sql`rollback`.execute(connection).catch(() => undefined);
      throw error;
    }
  });
}
