import { createHash, randomBytes } from 'node:crypto';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { newId, toIso } from '@skillxone/shared';
import type { AuditLogsTable, Database, ReportsTable, SubmissionsTable, UsersTable } from './types';
import { writeTransaction } from './transaction';

/**
 * Community input (submissions and reports), accounts, sessions, settings and the audit log.
 *
 * Inputs reaching these functions have been validated by the caller; these functions still
 * bound every text they store. IP addresses are never stored, only a keyed hash.
 */

type Db = Kysely<Database> | Transaction<Database>;

export type UserRole = 'user' | 'moderator' | 'admin';
export type User = Selectable<UsersTable>;
export type Submission = Selectable<SubmissionsTable>;
export type Report = Selectable<ReportsTable>;
export type ReportType = ReportsTable['type'];

export const REPORT_TYPES: readonly ReportType[] = [
  'security_concern',
  'false_positive',
  'inaccurate_metadata',
  'duplicate',
  'takedown',
  'other',
];

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const clip = (value: string | null | undefined, max: number) =>
  value === null || value === undefined ? null : value.slice(0, max);

// ---------------------------------------------------------------------------------------
// Settings

export async function getSetting<T>(db: Db, key: string): Promise<T | undefined> {
  const row = await db
    .selectFrom('settings')
    .select('value_json')
    .where('key', '=', key)
    .executeTakeFirst();
  if (!row) return undefined;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return undefined;
  }
}

export async function setSetting(
  db: Db,
  key: string,
  value: unknown,
  userId: string | null,
  now: Date,
): Promise<void> {
  const values = { value_json: JSON.stringify(value), updated_by: userId, updated_at: toIso(now) };
  await db
    .insertInto('settings')
    .values({ key, ...values })
    .onConflict((oc) => oc.column('key').doUpdateSet(values))
    .execute();
}

/**
 * Secret used to hash client IP addresses. Created once and kept in the database, so no
 * configuration is needed and hashes stay stable across restarts.
 */
export async function ipHashSecret(db: Db, now: Date): Promise<string> {
  const existing = await getSetting<string>(db, 'ip_hash_secret');
  if (typeof existing === 'string' && existing.length >= 32) return existing;
  const secret = randomBytes(32).toString('hex');
  await db
    .insertInto('settings')
    .values({
      key: 'ip_hash_secret',
      value_json: JSON.stringify(secret),
      updated_by: null,
      updated_at: toIso(now),
    })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
  return (await getSetting<string>(db, 'ip_hash_secret')) ?? secret;
}

export function hashIp(ip: string, secret: string): string {
  return createHash('sha256').update(`${secret}\0${ip}`).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------------------
// Audit log

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
}

export async function writeAudit(db: Db, entry: AuditEntry, now: Date): Promise<void> {
  await db
    .insertInto('audit_logs')
    .values({
      id: newId(now),
      actor_id: entry.actorId,
      action: entry.action.slice(0, 80),
      target_type: entry.targetType.slice(0, 40),
      target_id: entry.targetId.slice(0, 120),
      before_json: entry.before === undefined ? null : JSON.stringify(entry.before),
      after_json: entry.after === undefined ? null : JSON.stringify(entry.after),
      ip_hash: entry.ipHash ?? null,
      created_at: toIso(now),
    })
    .execute();
}

export async function listAudit(
  db: Db,
  limit = 100,
): Promise<Array<Selectable<AuditLogsTable> & { actor_login: string | null }>> {
  return db
    .selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.actor_id')
    .selectAll('a')
    .select('u.login as actor_login')
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id', 'desc')
    .limit(Math.min(Math.max(1, limit), 500))
    .execute();
}

// ---------------------------------------------------------------------------------------
// Users and sessions

/**
 * Creates or updates the account for a GitHub user. The role comes from the operator's
 * allowlist on every login, so removing someone from the allowlist takes effect at once.
 */
export async function upsertGitHubUser(
  db: Db,
  input: { githubId: number; login: string; avatarUrl: string | null; role: UserRole },
  now: Date,
): Promise<User> {
  const nowIso = toIso(now);
  const login = input.login.slice(0, 39);
  await db
    .insertInto('users')
    .values({
      id: newId(now),
      github_id: input.githubId,
      login,
      avatar_url: clip(input.avatarUrl, 300),
      role: input.role,
      created_at: nowIso,
      last_login_at: nowIso,
    })
    .onConflict((oc) =>
      oc.column('github_id').doUpdateSet({
        login,
        avatar_url: clip(input.avatarUrl, 300),
        role: input.role,
        last_login_at: nowIso,
      }),
    )
    .execute();
  return db
    .selectFrom('users')
    .selectAll()
    .where('github_id', '=', input.githubId)
    .executeTakeFirstOrThrow();
}

export const SESSION_DAYS = 7;

/** Creates a session and returns the raw token (sent only in the cookie) and its CSRF secret. */
export async function createSession(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ token: string; csrfSecret: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const csrfSecret = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db
    .insertInto('sessions')
    .values({
      id: newId(now),
      user_id: userId,
      token_hash: sha256(token),
      csrf_secret: csrfSecret,
      expires_at: toIso(expiresAt),
      created_at: toIso(now),
    })
    .execute();
  return { token, csrfSecret, expiresAt };
}

export interface SessionUser {
  sessionId: string;
  csrfSecret: string;
  user: User;
}

/** The session for a raw cookie token, or null when unknown, expired or the user is disabled. */
export async function findSession(db: Db, token: string, now: Date): Promise<SessionUser | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const row = await db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.id as session_id', 's.csrf_secret', 's.expires_at'])
    .selectAll('u')
    .where('s.token_hash', '=', sha256(token))
    .executeTakeFirst();
  if (!row || row.expires_at <= toIso(now) || Number(row.is_disabled) === 1) return null;
  const { session_id, csrf_secret, ...rest } = row;
  const user = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key !== 'expires_at'),
  ) as User;
  return { sessionId: session_id, csrfSecret: csrf_secret, user };
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.deleteFrom('sessions').where('id', '=', sessionId).execute();
}

export async function deleteExpiredSessions(db: Db, now: Date): Promise<number> {
  const result = await db
    .deleteFrom('sessions')
    .where('expires_at', '<=', toIso(now))
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

// ---------------------------------------------------------------------------------------
// Submissions

export interface SubmissionInput {
  owner: string;
  repo: string;
  note: string | null;
  submitterId: string | null;
  ipHash: string | null;
}

/**
 * Records a repository suggestion. A repository already submitted (and not rejected), or
 * already indexed, returns the existing record instead of creating a new one.
 */
export async function createSubmission(
  db: Kysely<Database>,
  input: SubmissionInput,
  now: Date,
): Promise<{ submission: Submission; created: boolean; alreadyIndexed: boolean }> {
  const fullLower = `${input.owner}/${input.repo}`.toLowerCase();
  return writeTransaction(db, async (trx) => {
    const repository = await trx
      .selectFrom('repositories')
      .select(['id', 'status'])
      .where('full_name_lower', '=', fullLower)
      .executeTakeFirst();
    const existing = await trx
      .selectFrom('submissions')
      .selectAll()
      .where('repo_full_name_lower', '=', fullLower)
      .where('status', '!=', 'rejected')
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (existing)
      return { submission: existing, created: false, alreadyIndexed: repository !== undefined };

    const id = newId(now);
    await trx
      .insertInto('submissions')
      .values({
        id,
        repo_full_name_lower: fullLower,
        repository_id: repository?.id ?? null,
        status: repository ? 'duplicate' : 'pending',
        submitter_id: input.submitterId,
        submitter_ip_hash: input.ipHash,
        note: clip(input.note, 1000),
        created_at: toIso(now),
      })
      .execute();
    const submission = await trx
      .selectFrom('submissions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { submission, created: true, alreadyIndexed: repository !== undefined };
  });
}

export async function listSubmissions(
  db: Db,
  options: { status?: Submission['status']; limit?: number } = {},
) {
  let query = db.selectFrom('submissions').selectAll();
  if (options.status) query = query.where('status', '=', options.status);
  return query
    .orderBy('created_at', 'desc')
    .limit(Math.min(Math.max(1, options.limit ?? 100), 500))
    .execute();
}

export async function getSubmission(db: Db, id: string): Promise<Submission | undefined> {
  return db.selectFrom('submissions').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function reviewSubmission(
  db: Kysely<Database>,
  input: {
    id: string;
    status: 'approved' | 'rejected';
    note: string | null;
    actorId: string;
    ipHash: string | null;
  },
  now: Date,
): Promise<Submission | null> {
  return writeTransaction(db, async (trx) => {
    const before = await trx
      .selectFrom('submissions')
      .selectAll()
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (!before) return null;
    await trx
      .updateTable('submissions')
      .set({
        status: input.status,
        review_note: clip(input.note, 1000),
        reviewed_by: input.actorId,
        reviewed_at: toIso(now),
      })
      .where('id', '=', input.id)
      .execute();
    const after = await trx
      .selectFrom('submissions')
      .selectAll()
      .where('id', '=', input.id)
      .executeTakeFirstOrThrow();
    await writeAudit(
      trx,
      {
        actorId: input.actorId,
        action: `submission.${input.status === 'approved' ? 'approve' : 'reject'}`,
        targetType: 'submission',
        targetId: input.id,
        before: { status: before.status },
        after: { status: after.status, note: after.review_note },
        ipHash: input.ipHash,
      },
      now,
    );
    return after;
  });
}

// ---------------------------------------------------------------------------------------
// Reports

export interface ReportInput {
  type: ReportType;
  skillId: string | null;
  findingId: string | null;
  body: string;
  contact: string | null;
  reporterId: string | null;
  ipHash: string | null;
}

/**
 * Records a report. The same reporter (by account or IP hash) filing the same type against
 * the same skill while an earlier report is still open gets the earlier report back.
 */
export async function createReport(
  db: Kysely<Database>,
  input: ReportInput,
  now: Date,
): Promise<{ report: Report; created: boolean } | { error: 'unknown_skill' | 'unknown_finding' }> {
  return writeTransaction(db, async (trx) => {
    let repositoryId: string | null = null;
    if (input.skillId) {
      const skill = await trx
        .selectFrom('skills')
        .select(['id', 'repository_id'])
        .where('id', '=', input.skillId)
        .executeTakeFirst();
      if (!skill) return { error: 'unknown_skill' as const };
      repositoryId = skill.repository_id;
    }
    if (input.findingId) {
      const finding = await trx
        .selectFrom('security_findings as f')
        .innerJoin('security_scans as sc', 'sc.id', 'f.scan_id')
        .select('sc.skill_id')
        .where('f.id', '=', input.findingId)
        .executeTakeFirst();
      if (!finding || (input.skillId && finding.skill_id !== input.skillId))
        return { error: 'unknown_finding' as const };
    }

    const who = input.reporterId ?? input.ipHash;
    if (who) {
      let query = trx
        .selectFrom('reports')
        .selectAll()
        .where('type', '=', input.type)
        .where('status', 'in', ['open', 'triaged'])
        .where(input.reporterId ? 'reporter_id' : 'reporter_ip_hash', '=', who);
      query = input.skillId
        ? query.where('skill_id', '=', input.skillId)
        : query.where('skill_id', 'is', null);
      query = input.findingId ? query.where('finding_id', '=', input.findingId) : query;
      const existing = await query.executeTakeFirst();
      if (existing) return { report: existing, created: false };
    }

    const id = newId(now);
    await trx
      .insertInto('reports')
      .values({
        id,
        skill_id: input.skillId,
        repository_id: repositoryId,
        finding_id: input.findingId,
        type: input.type,
        body: input.body.slice(0, 5000),
        contact: clip(input.contact, 200),
        reporter_id: input.reporterId,
        reporter_ip_hash: input.ipHash,
        created_at: toIso(now),
      })
      .execute();
    return {
      report: await trx
        .selectFrom('reports')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
      created: true,
    };
  });
}

export async function listReports(
  db: Db,
  options: { status?: Report['status']; limit?: number } = {},
) {
  let query = db
    .selectFrom('reports as r')
    .leftJoin('skills as s', 's.id', 'r.skill_id')
    .selectAll('r')
    .select(['s.slug as skill_slug']);
  if (options.status) query = query.where('r.status', '=', options.status);
  return query
    .orderBy('r.created_at', 'desc')
    .limit(Math.min(Math.max(1, options.limit ?? 100), 500))
    .execute();
}

export async function resolveReport(
  db: Kysely<Database>,
  input: {
    id: string;
    status: 'triaged' | 'resolved' | 'dismissed';
    note: string | null;
    actorId: string;
    ipHash: string | null;
  },
  now: Date,
): Promise<Report | null> {
  return writeTransaction(db, async (trx) => {
    const before = await trx
      .selectFrom('reports')
      .selectAll()
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (!before) return null;
    const finished = input.status !== 'triaged';
    await trx
      .updateTable('reports')
      .set({
        status: input.status,
        resolution_note: clip(input.note, 1000),
        resolved_by: finished ? input.actorId : null,
        resolved_at: finished ? toIso(now) : null,
      })
      .where('id', '=', input.id)
      .execute();
    const after = await trx
      .selectFrom('reports')
      .selectAll()
      .where('id', '=', input.id)
      .executeTakeFirstOrThrow();
    await writeAudit(
      trx,
      {
        actorId: input.actorId,
        action: `report.${input.status}`,
        targetType: 'report',
        targetId: input.id,
        before: { status: before.status },
        after: { status: after.status, note: after.resolution_note },
        ipHash: input.ipHash,
      },
      now,
    );
    return after;
  });
}

// ---------------------------------------------------------------------------------------
// Moderation of catalog content

/**
 * Records a reviewer's decision on a security finding. The caller queues a rescan so the
 * skill's state is recomputed under the policy; the decision follows the fingerprint.
 */
export async function reviewFinding(
  db: Kysely<Database>,
  input: {
    findingId: string;
    status: 'open' | 'false_positive' | 'accepted';
    note: string;
    actorId: string;
    ipHash: string | null;
  },
  now: Date,
): Promise<{ skillId: string; versionId: string } | null> {
  return writeTransaction(db, async (trx) => {
    const before = await trx
      .selectFrom('security_findings as f')
      .innerJoin('security_scans as sc', 'sc.id', 'f.scan_id')
      .select([
        'f.id',
        'f.status',
        'f.review_note',
        'f.fingerprint',
        'sc.skill_id',
        'sc.version_id',
      ])
      .where('f.id', '=', input.findingId)
      .executeTakeFirst();
    if (!before) return null;
    const reviewed = input.status === 'open' ? null : toIso(now);
    // The decision applies to every stored copy of this finding for the skill.
    const scanIds = trx
      .selectFrom('security_scans')
      .select('id')
      .where('skill_id', '=', before.skill_id);
    await trx
      .updateTable('security_findings')
      .set({
        status: input.status,
        review_note: input.status === 'open' ? null : input.note.slice(0, 1000),
        reviewed_by: input.status === 'open' ? null : input.actorId,
        reviewed_at: reviewed,
      })
      .where('fingerprint', '=', before.fingerprint)
      .where('scan_id', 'in', scanIds)
      .execute();
    await writeAudit(
      trx,
      {
        actorId: input.actorId,
        action: 'finding.review',
        targetType: 'finding',
        targetId: input.findingId,
        before: { status: before.status, note: before.review_note },
        after: { status: input.status, note: input.note },
        ipHash: input.ipHash,
      },
      now,
    );
    return { skillId: before.skill_id, versionId: before.version_id };
  });
}

/** Hides a skill from the catalog or shows it again. */
export async function setSkillVisibility(
  db: Kysely<Database>,
  input: { skillId: string; hidden: boolean; note: string; actorId: string; ipHash: string | null },
  now: Date,
): Promise<boolean> {
  return writeTransaction(db, async (trx) => {
    const before = await trx
      .selectFrom('skills')
      .select(['id', 'status'])
      .where('id', '=', input.skillId)
      .executeTakeFirst();
    if (!before || before.status === 'removed') return false;
    const status = input.hidden ? ('hidden' as const) : ('active' as const);
    await trx
      .updateTable('skills')
      .set({ status, updated_at: toIso(now) })
      .where('id', '=', input.skillId)
      .execute();
    await writeAudit(
      trx,
      {
        actorId: input.actorId,
        action: input.hidden ? 'skill.hide' : 'skill.unhide',
        targetType: 'skill',
        targetId: input.skillId,
        before: { status: before.status },
        after: { status, note: input.note.slice(0, 1000) },
        ipHash: input.ipHash,
      },
      now,
    );
    return true;
  });
}

/** Counts for the admin overview. */
export async function adminOverview(db: Db) {
  const count = async (
    table: 'repositories' | 'skills' | 'submissions' | 'reports' | 'sync_jobs',
    where?: [string, string],
  ) => {
    let query = db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n'));
    if (where) query = query.where(where[0] as never, '=', where[1] as never);
    return Number((await query.executeTakeFirstOrThrow()).n);
  };
  const states = await db
    .selectFrom('skills')
    .select(['verification_state', (eb) => eb.fn.countAll<number>().as('n')])
    .where('status', '=', 'active')
    .groupBy('verification_state')
    .execute();
  const openFindings = await db
    .selectFrom('security_findings as f')
    .innerJoin('security_scans as sc', 'sc.id', 'f.scan_id')
    .innerJoin('skills as s', 's.current_version_id', 'sc.version_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('f.status', '=', 'open')
    .where('f.severity', 'in', ['critical', 'high', 'medium'])
    .executeTakeFirstOrThrow();
  return {
    repositories: await count('repositories'),
    skills: await count('skills', ['status', 'active']),
    hiddenSkills: await count('skills', ['status', 'hidden']),
    pendingSubmissions: await count('submissions', ['status', 'pending']),
    openReports: await count('reports', ['status', 'open']),
    deadJobs: await count('sync_jobs', ['status', 'dead']),
    queuedJobs: await count('sync_jobs', ['status', 'queued']),
    openFindings: Number(openFindings.n),
    verification: Object.fromEntries(
      states.map((row) => [row.verification_state, Number(row.n)]),
    ) as Record<string, number>,
  };
}

/** Open medium-or-worse findings on current versions, for the admin security queue. */
export async function listOpenFindings(db: Db, limit = 200) {
  return db
    .selectFrom('security_findings as f')
    .innerJoin('security_scans as sc', 'sc.id', 'f.scan_id')
    .innerJoin('skills as s', 's.current_version_id', 'sc.version_id')
    .select([
      'f.id',
      'f.rule_id',
      'f.severity',
      'f.file_path',
      'f.line_start',
      'f.excerpt',
      'f.status',
      's.slug',
      's.id as skill_id',
    ])
    .where('f.severity', 'in', ['critical', 'high', 'medium'])
    .orderBy('f.status')
    .orderBy('s.slug')
    .limit(Math.min(Math.max(1, limit), 1000))
    .execute();
}

/** Repositories with their state and unresolved ingestion errors, for the admin view. */
export async function listRepositoriesForAdmin(db: Db, limit = 200) {
  return db
    .selectFrom('repositories as r')
    .select((eb) => [
      'r.id',
      'r.owner',
      'r.name',
      'r.status',
      'r.stars',
      'r.discovery_source',
      'r.last_synced_at',
      'r.last_sync_error',
      eb
        .selectFrom('skills as s')
        .select((sb) => sb.fn.countAll<number>().as('n'))
        .whereRef('s.repository_id', '=', 'r.id')
        .where('s.status', '=', 'active')
        .as('skills'),
      eb
        .selectFrom('ingestion_errors as e')
        .select((sb) => sb.fn.countAll<number>().as('n'))
        .whereRef('e.repository_id', '=', 'r.id')
        .where('e.resolved_at', 'is', null)
        .as('errors'),
    ])
    .orderBy('r.full_name_lower')
    .limit(Math.min(Math.max(1, limit), 1000))
    .execute();
}

/** Skills of any visibility whose slug contains `query`, for moderation. */
export async function searchSkillsForAdmin(db: Db, query: string, limit = 50) {
  let q = db
    .selectFrom('skills')
    .select(['id', 'slug', 'name', 'status', 'verification_state', 'lifecycle_state'])
    .where('status', '!=', 'removed');
  const term = query.trim().toLowerCase().slice(0, 100);
  if (term) q = q.where('slug', 'like', `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return q
    .orderBy('status', 'desc')
    .orderBy('slug')
    .limit(Math.min(Math.max(1, limit), 200))
    .execute();
}
