import type { ExpressionBuilder, Kysely } from 'kysely';
import { addMs, newId, systemClock, toIso } from '@skillxone/shared';
import type { Clock } from '@skillxone/shared';
import type { Database, Job } from './types';

/**
 * Database-backed job queue (ADR-003).
 *
 * Delivery is at-least-once: a worker that crashes or stalls loses its lease and the job
 * is claimed again, so every processor must be idempotent. A job is owned by whoever
 * holds an unexpired lease; `complete`, `fail` and `heartbeat` are no-ops for anyone else.
 */

export interface EnqueueOptions {
  /** At most one queued or running job may exist per key. */
  dedupeKey?: string;
  runAfter?: Date;
  priority?: number;
  maxAttempts?: number;
  /** Name of the schedule that created the job, for the admin view. */
  schedule?: string;
}

export interface EnqueueResult {
  id: string;
  /** False when an active job with the same dedupe key already existed. */
  created: boolean;
}

export interface JobQueueOptions {
  clock?: Clock;
  /** Returns a number in [0, 1); injected so backoff jitter is testable. */
  random?: () => number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export interface JobQueue {
  enqueue(type: string, payload?: unknown, options?: EnqueueOptions): Promise<EnqueueResult>;
  /** Claims the next runnable job of the given types (any type when empty). */
  claim(workerId: string, types: readonly string[], leaseMs: number): Promise<Job | null>;
  /** Extends the lease. Returns false if the lease was already lost. */
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  complete(jobId: string, workerId: string, result?: unknown): Promise<boolean>;
  /** Records a failure and schedules a retry, or marks the job dead after the last attempt. */
  fail(jobId: string, workerId: string, error: string): Promise<'retry' | 'dead' | 'lost'>;
  /**
   * Returns a running job to the queue to run at `runAfter`, without counting the attempt.
   * Used when the work could not start for an external reason such as a rate limit.
   */
  defer(jobId: string, workerId: string, runAfter: Date, note: string): Promise<boolean>;
  get(jobId: string): Promise<Job | undefined>;
  counts(): Promise<Record<string, number>>;
}

const ERROR_MAX_LENGTH = 4000;

/** Delay before retry number `attempts + 1`: exponential with +/-20% jitter, capped. */
export function backoffDelayMs(
  attempts: number,
  baseMs: number,
  maxMs: number,
  random: () => number,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
  const jitter = 0.8 + random() * 0.4;
  return Math.round(Math.min(maxMs, exponential * jitter));
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' || // better-sqlite3
    code === '23505' // PostgreSQL unique_violation
  );
}

export function createJobQueue(db: Kysely<Database>, options: JobQueueOptions = {}): JobQueue {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;
  const backoffBaseMs = options.backoffBaseMs ?? 30_000;
  const backoffMaxMs = options.backoffMaxMs ?? 60 * 60_000;

  const findActiveByKey = (key: string) =>
    db
      .selectFrom('sync_jobs')
      .select('id')
      .where('dedupe_key', '=', key)
      .where('status', 'in', ['queued', 'running'])
      .executeTakeFirst();

  return {
    async enqueue(type, payload = {}, opts = {}) {
      if (opts.dedupeKey) {
        const existing = await findActiveByKey(opts.dedupeKey);
        if (existing) return { id: existing.id, created: false };
      }
      const now = clock();
      const id = newId(now);
      try {
        await db
          .insertInto('sync_jobs')
          .values({
            id,
            type,
            payload_json: JSON.stringify(payload),
            dedupe_key: opts.dedupeKey ?? null,
            priority: opts.priority ?? 0,
            max_attempts: opts.maxAttempts ?? 5,
            run_after: toIso(opts.runAfter ?? now),
            schedule: opts.schedule ?? null,
            created_at: toIso(now),
          })
          .execute();
        return { id, created: true };
      } catch (error) {
        // Lost a race with another enqueuer: the partial unique index rejected the insert.
        if (opts.dedupeKey && isUniqueViolation(error)) {
          const existing = await findActiveByKey(opts.dedupeKey);
          if (existing) return { id: existing.id, created: false };
        }
        throw error;
      }
    },

    async claim(workerId, types, leaseMs) {
      const now = clock();
      const nowIso = toIso(now);

      // A job whose lease expired on its final attempt will never be retried: mark it dead.
      await db
        .updateTable('sync_jobs')
        .set({
          status: 'dead',
          finished_at: nowIso,
          last_error: 'Lease expired on the final attempt (worker crashed or timed out).',
          locked_by: null,
          locked_until: null,
        })
        .where('status', '=', 'running')
        .where('locked_until', '<', nowIso)
        .whereRef('attempts', '>=', 'max_attempts')
        .execute();

      const claimable = (eb: ExpressionBuilder<Database, 'sync_jobs'>) =>
        eb.or([
          eb.and([eb('status', '=', 'queued'), eb('run_after', '<=', nowIso)]),
          eb.and([eb('status', '=', 'running'), eb('locked_until', '<', nowIso)]),
        ]);

      // One atomic statement. The outer `claimable` re-check makes a concurrent claimer
      // that selected the same row match nothing once the first claim has committed.
      const row = await db
        .updateTable('sync_jobs')
        .set((eb) => ({
          status: 'running',
          locked_by: workerId,
          locked_until: toIso(addMs(now, leaseMs)),
          attempts: eb('attempts', '+', 1),
          started_at: nowIso,
          finished_at: null,
        }))
        .where('id', '=', (eb) => {
          let candidate = eb.selectFrom('sync_jobs').select('id').where(claimable);
          if (types.length > 0) candidate = candidate.where('type', 'in', [...types]);
          return candidate
            .orderBy('priority', 'desc')
            .orderBy('run_after', 'asc')
            .orderBy('id', 'asc')
            .limit(1);
        })
        .where(claimable)
        .returningAll()
        .executeTakeFirst();

      return row ?? null;
    },

    async heartbeat(jobId, workerId, leaseMs) {
      const now = clock();
      const result = await db
        .updateTable('sync_jobs')
        .set({ locked_until: toIso(addMs(now, leaseMs)) })
        .where('id', '=', jobId)
        .where('status', '=', 'running')
        .where('locked_by', '=', workerId)
        .where('locked_until', '>=', toIso(now))
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async complete(jobId, workerId, result) {
      const nowIso = toIso(clock());
      const updated = await db
        .updateTable('sync_jobs')
        .set({
          status: 'succeeded',
          finished_at: nowIso,
          result_json: result === undefined ? null : JSON.stringify(result),
          last_error: null,
          locked_by: null,
          locked_until: null,
        })
        .where('id', '=', jobId)
        .where('status', '=', 'running')
        .where('locked_by', '=', workerId)
        .executeTakeFirst();
      return Number(updated.numUpdatedRows) > 0;
    },

    async fail(jobId, workerId, error) {
      const now = clock();
      const job = await db
        .selectFrom('sync_jobs')
        .select(['attempts', 'max_attempts'])
        .where('id', '=', jobId)
        .where('status', '=', 'running')
        .where('locked_by', '=', workerId)
        .executeTakeFirst();
      if (!job) return 'lost';

      const exhausted = job.attempts >= job.max_attempts;
      const updated = await db
        .updateTable('sync_jobs')
        .set({
          status: exhausted ? 'dead' : 'queued',
          run_after: exhausted
            ? toIso(now)
            : toIso(addMs(now, backoffDelayMs(job.attempts, backoffBaseMs, backoffMaxMs, random))),
          finished_at: exhausted ? toIso(now) : null,
          last_error: error.slice(0, ERROR_MAX_LENGTH),
          locked_by: null,
          locked_until: null,
        })
        .where('id', '=', jobId)
        .where('status', '=', 'running')
        .where('locked_by', '=', workerId)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 0) return 'lost';
      return exhausted ? 'dead' : 'retry';
    },

    async defer(jobId, workerId, runAfter, note) {
      const updated = await db
        .updateTable('sync_jobs')
        .set((eb) => ({
          status: 'queued',
          run_after: toIso(runAfter),
          attempts: eb('attempts', '-', 1),
          last_error: note.slice(0, ERROR_MAX_LENGTH),
          locked_by: null,
          locked_until: null,
        }))
        .where('id', '=', jobId)
        .where('status', '=', 'running')
        .where('locked_by', '=', workerId)
        .executeTakeFirst();
      return Number(updated.numUpdatedRows) > 0;
    },

    get(jobId) {
      return db.selectFrom('sync_jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
    },

    async counts() {
      const rows = await db
        .selectFrom('sync_jobs')
        .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
        .groupBy('status')
        .execute();
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    },
  };
}
