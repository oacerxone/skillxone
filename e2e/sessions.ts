import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Test-only helper: creates users and sessions directly in the e2e database, the same way
 * the sign-in callback does, so admin pages can be exercised without a GitHub OAuth app.
 */

const root = join(import.meta.dirname, '..');
const require = createRequire(join(root, 'packages/database/package.json'));
interface SqliteDatabase {
  pragma(source: string): unknown;
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
}
const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;

function databasePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/skillxone.db';
  const path = url.replace(/^file:/, '');
  return path.startsWith('/') ? path : join(root, path);
}

export type Role = 'user' | 'moderator' | 'admin';

/** A user stored as admin whose id is not on the allowlist (removed after signing in). */
export type TestAccount = Role | 'revoked-admin';

export interface TestSession {
  cookie: string;
  csrf: string;
}

/** Matches apps/web/lib/security.ts. */
const csrfFor = (secret: string) =>
  createHmac('sha256', secret).update('skillxone-csrf-v1').digest('base64url');

export function createTestSession(account: TestAccount): TestSession {
  const role: Role = account === 'revoked-admin' ? 'admin' : account;
  const db = new Database(databasePath());
  try {
    db.pragma('busy_timeout = 5000');
    const githubId = {
      user: 990_000_001,
      moderator: 990_000_002,
      admin: 990_000_003,
      'revoked-admin': 990_000_004,
    }[account];
    const now = new Date().toISOString();
    const userId = `e2e_user_${account}`;
    db.prepare(
      `insert into users (id, github_id, login, role, created_at, last_login_at) values (?, ?, ?, ?, ?, ?)
       on conflict(github_id) do update set role = excluded.role, is_disabled = 0`,
    ).run(userId, githubId, `e2e-${account}`, role, now, now);
    const token = randomBytes(32).toString('base64url');
    const csrfSecret = randomBytes(32).toString('base64url');
    db.prepare(
      'insert into sessions (id, user_id, token_hash, csrf_secret, expires_at, created_at) values (?, ?, ?, ?, ?, ?)',
    ).run(
      `e2e_session_${randomBytes(6).toString('hex')}`,
      userId,
      createHash('sha256').update(token).digest('hex'),
      csrfSecret,
      new Date(Date.now() + 3_600_000).toISOString(),
      now,
    );
    return { cookie: `sx_session=${token}`, csrf: csrfFor(csrfSecret) };
  } finally {
    db.close();
  }
}
