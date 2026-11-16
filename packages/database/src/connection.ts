import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { Kysely, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { findWorkspaceRoot } from '@skillxone/shared';
import type { Database } from './types';

export type DialectName = 'sqlite' | 'postgres';

export interface DatabaseHandle {
  db: Kysely<Database>;
  dialect: DialectName;
  /** Closes the connection (and checkpoints the SQLite WAL). */
  close(): Promise<void>;
}

export interface OpenOptions {
  /** Directory that relative SQLite paths resolve from. Defaults to the repository root. */
  baseDir?: string;
  /** Milliseconds a SQLite writer waits for a lock before failing. */
  busyTimeoutMs?: number;
}

/** Turns `file:./data/app.db` into an absolute path; `file::memory:` stays in memory. */
export function resolveSqlitePath(url: string, baseDir: string): string {
  const raw = url.slice('file:'.length);
  if (raw === ':memory:' || raw === '') return ':memory:';
  return isAbsolute(raw) ? raw : resolve(baseDir, raw);
}

export async function openDatabase(
  url: string,
  options: OpenOptions = {},
): Promise<DatabaseHandle> {
  if (url.startsWith('file:')) return openSqlite(url, options);
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return openPostgres(url);
  throw new Error('Unsupported DATABASE_URL scheme. Use file:, postgres:// or postgresql://.');
}

async function openSqlite(url: string, options: OpenOptions): Promise<DatabaseHandle> {
  const { default: BetterSqlite3 } = await import('better-sqlite3');
  const path = resolveSqlitePath(url, options.baseDir ?? findWorkspaceRoot());
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const sqlite = new BetterSqlite3(path);
  // WAL lets readers proceed while the single writer commits; see overview.md section 6.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma(`busy_timeout = ${Math.trunc(options.busyTimeoutMs ?? 5000)}`);
  sqlite.pragma('foreign_keys = ON');

  const db = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, dialect: 'sqlite', close: () => db.destroy() };
}

async function openPostgres(url: string): Promise<DatabaseHandle> {
  const { default: pg } = await import('pg');
  // GitHub ids are stored as bigint; they fit in a JS number, so parse int8 as one.
  pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return { db, dialect: 'postgres', close: () => db.destroy() };
}

/**
 * Throws unless the database answers and the schema has been migrated.
 * Used by the health endpoint.
 */
export async function assertDatabaseReady(db: Kysely<Database>): Promise<void> {
  await sql`select 1`.execute(db);
  await db.selectFrom('categories').select('id').limit(1).execute();
}
