import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { findWorkspaceRoot } from '@skillxone/shared';
import { resolveSqlitePath } from './connection';

/**
 * Online backup and restore for the SQLite database, using SQLite's backup API so a copy is
 * consistent even while the web app and worker are running. PostgreSQL deployments use
 * pg_dump and pg_restore instead (see docs/deployment).
 */

type BetterSqlite = typeof import('better-sqlite3');

async function driver(): Promise<BetterSqlite> {
  return (await import('better-sqlite3')).default as unknown as BetterSqlite;
}

function sqlitePath(url: string, baseDir: string): string {
  if (!url.startsWith('file:'))
    throw new Error('Backup and restore here are for SQLite. Use pg_dump for PostgreSQL.');
  const path = resolveSqlitePath(url, baseDir);
  if (path === ':memory:') throw new Error('An in-memory database cannot be backed up.');
  return path;
}

/** Checks a database file: SQLite's integrity check passes and the schema has been migrated. */
export async function verifySqliteFile(path: string): Promise<{ ok: boolean; detail: string }> {
  if (!existsSync(path)) return { ok: false, detail: 'File not found.' };
  const Database = await driver();
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok')
      return { ok: false, detail: `Integrity check failed: ${String(integrity).slice(0, 200)}` };
    const migrated = db
      .prepare(
        "select count(*) as n from sqlite_master where type = 'table' and name = 'kysely_migration'",
      )
      .get() as { n: number };
    if (migrated.n !== 1)
      return { ok: false, detail: 'Not a skillxone database (no migration table).' };
    return { ok: true, detail: 'ok' };
  } catch (error) {
    return { ok: false, detail: `Not a readable SQLite database (${(error as Error).message}).` };
  } finally {
    db.close();
  }
}

export async function backupSqlite(
  url: string,
  target: string,
  options: { baseDir?: string } = {},
): Promise<{ path: string; bytes: number }> {
  const source = sqlitePath(url, options.baseDir ?? findWorkspaceRoot());
  if (existsSync(target)) throw new Error('The backup file already exists; choose a new name.');
  mkdirSync(dirname(target), { recursive: true });
  const Database = await driver();
  const db = new Database(source, { fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
  const check = await verifySqliteFile(target);
  if (!check.ok) {
    rmSync(target, { force: true });
    throw new Error(`The backup did not verify: ${check.detail}`);
  }
  return { path: target, bytes: statSync(target).size };
}

/**
 * Replaces the database with a backup. Stop the web app and worker first. The current
 * database is kept next to it as `<name>.before-restore-<time>` so a restore can be undone.
 */
export async function restoreSqlite(
  backup: string,
  url: string,
  options: { baseDir?: string; now?: Date } = {},
): Promise<{ restored: string; previous: string | null }> {
  const check = await verifySqliteFile(backup);
  if (!check.ok) throw new Error(`Refusing to restore: ${check.detail}`);
  const target = sqlitePath(url, options.baseDir ?? findWorkspaceRoot());
  const Database = await driver();
  let previous: string | null = null;
  if (existsSync(target)) {
    previous = `${target}.before-restore-${(options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')}`;
    const current = new Database(target, { fileMustExist: true });
    try {
      await current.backup(previous);
    } finally {
      current.close();
    }
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true });
  mkdirSync(dirname(target), { recursive: true });
  const source = new Database(backup, { readonly: true, fileMustExist: true });
  try {
    await source.backup(target);
  } finally {
    source.close();
  }
  return { restored: target, previous };
}
