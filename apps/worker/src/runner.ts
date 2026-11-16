import type { Job, JobQueue } from '@skillxone/database';

/**
 * A processor handles one job type. It must be idempotent: delivery is at-least-once,
 * so the same job can run again after a crash or a lost lease.
 */
export type Processor = (payload: unknown, context: ProcessorContext) => Promise<unknown>;

export interface ProcessorContext {
  job: Job;
  /** Aborted when the worker is asked to stop; long processors should check it. */
  signal: AbortSignal;
}

export type ProcessorRegistry = Readonly<Record<string, Processor>>;

/** Placeholder processor used to exercise the queue until real jobs exist (Phase 3). */
export const baseProcessors: ProcessorRegistry = {
  noop: async () => ({ ok: true }),
};

export interface DrainOptions {
  workerId: string;
  leaseMs?: number;
  /** Stop after this many jobs. Default: run until the queue is empty. */
  maxJobs?: number;
  signal?: AbortSignal;
  onEvent?: (event: DrainEvent) => void;
}

export type DrainEvent =
  | { kind: 'succeeded'; job: Job }
  | { kind: 'retry' | 'dead' | 'lost' | 'deferred'; job: Job; error: string };

export interface DrainSummary {
  succeeded: number;
  retried: number;
  dead: number;
  lost: number;
  deferred: number;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Claims and runs jobs one at a time until none are runnable. */
export async function drainQueue(
  queue: JobQueue,
  processors: ProcessorRegistry,
  options: DrainOptions,
): Promise<DrainSummary> {
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const signal = options.signal ?? new AbortController().signal;
  const summary: DrainSummary = { succeeded: 0, retried: 0, dead: 0, lost: 0, deferred: 0 };
  let processed = 0;

  while (!signal.aborted && (options.maxJobs === undefined || processed < options.maxJobs)) {
    // Only claim types this worker can run, so an older worker never burns the
    // attempts of a job type introduced by a newer release.
    const job = await queue.claim(options.workerId, Object.keys(processors), leaseMs);
    if (!job) break;
    processed += 1;

    // Keep the lease while a long job runs, so another worker does not reclaim it.
    const heartbeat = setInterval(
      () => void queue.heartbeat(job.id, options.workerId, leaseMs).catch(() => undefined),
      Math.max(1000, Math.floor(leaseMs / 3)),
    );
    heartbeat.unref?.();
    try {
      const processor = processors[job.type];
      if (!processor) throw new Error(`No processor registered for job type "${job.type}"`);
      const result = await processor(JSON.parse(job.payload_json), { job, signal });
      if (await queue.complete(job.id, options.workerId, result)) {
        summary.succeeded += 1;
        options.onEvent?.({ kind: 'succeeded', job });
      } else {
        summary.lost += 1;
        options.onEvent?.({ kind: 'lost', job, error: 'Lease lost before completion' });
      }
    } catch (error) {
      const message = describeError(error);
      // An error carrying `resetAt` (a rate limit) is not a failure of the job: park it
      // until then without using up an attempt.
      const resetAt = (error as { resetAt?: unknown } | null)?.resetAt;
      if (resetAt instanceof Date) {
        const parked = await queue.defer(job.id, options.workerId, resetAt, message);
        summary.deferred += parked ? 1 : 0;
        if (!parked) summary.lost += 1;
        options.onEvent?.({ kind: parked ? 'deferred' : 'lost', job, error: message });
        // Every other job of this kind would hit the same limit, so stop this run.
        break;
      }
      const outcome = await queue.fail(job.id, options.workerId, message);
      if (outcome === 'retry') summary.retried += 1;
      else if (outcome === 'dead') summary.dead += 1;
      else summary.lost += 1;
      options.onEvent?.({ kind: outcome, job, error: message });
    } finally {
      clearInterval(heartbeat);
    }
  }

  return summary;
}
