import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJobQueue, migrateToLatest, openDatabase } from '@skillxone/database';
import type { DatabaseHandle, JobQueue } from '@skillxone/database';
import { baseProcessors, drainQueue } from './runner';

let handle: DatabaseHandle;
let queue: JobQueue;
let now: number;

beforeEach(async () => {
  handle = await openDatabase('file::memory:');
  await migrateToLatest(handle.db);
  now = Date.parse('2026-01-01T00:00:00.000Z');
  queue = createJobQueue(handle.db, { clock: () => new Date(now), random: () => 0.5 });
});
afterEach(async () => {
  await handle.close();
});

describe('drainQueue', () => {
  it('runs every queued job and stores results', async () => {
    const a = await queue.enqueue('noop');
    await queue.enqueue('noop');
    const summary = await drainQueue(queue, baseProcessors, { workerId: 'w' });
    expect(summary).toEqual({ succeeded: 2, retried: 0, dead: 0, lost: 0 });
    expect((await queue.get(a.id))?.result_json).toBe('{"ok":true}');
  });

  it('passes the parsed payload to the processor', async () => {
    await queue.enqueue('echo', { n: 7 });
    let seen: unknown;
    await drainQueue(queue, { echo: async (payload) => (seen = payload) }, { workerId: 'w' });
    expect(seen).toEqual({ n: 7 });
  });

  it('records a failure and schedules a retry', async () => {
    const { id } = await queue.enqueue('boom');
    const summary = await drainQueue(
      queue,
      {
        boom: async () => {
          throw new Error('kaput');
        },
      },
      { workerId: 'w' },
    );
    expect(summary.retried).toBe(1);
    const job = await queue.get(id);
    expect(job?.status).toBe('queued');
    expect(job?.last_error).toBe('Error: kaput');
  });

  it('leaves job types it cannot run untouched', async () => {
    const { id } = await queue.enqueue('from-a-newer-release');
    const summary = await drainQueue(queue, baseProcessors, { workerId: 'w' });
    expect(summary.succeeded).toBe(0);
    const job = await queue.get(id);
    expect(job?.status).toBe('queued');
    expect(job?.attempts).toBe(0);
  });

  it('is safe to re-run after a crash mid-job (at-least-once, no duplicates of finished work)', async () => {
    const done = await queue.enqueue('noop');
    const interrupted = await queue.enqueue('noop');
    await drainQueue(queue, baseProcessors, { workerId: 'w1', maxJobs: 1 });
    // w1 claims the second job, then "crashes" without completing it.
    await queue.claim('w1', [], 60_000);

    now += 60_001;
    const summary = await drainQueue(queue, baseProcessors, { workerId: 'w2' });
    expect(summary.succeeded).toBe(1);
    expect((await queue.get(done.id))?.attempts).toBe(1);
    expect((await queue.get(interrupted.id))?.status).toBe('succeeded');
    expect((await queue.get(interrupted.id))?.attempts).toBe(2);
  });

  it('stops when the abort signal fires', async () => {
    await queue.enqueue('noop');
    const controller = new AbortController();
    controller.abort();
    const summary = await drainQueue(queue, baseProcessors, {
      workerId: 'w',
      signal: controller.signal,
    });
    expect(summary.succeeded).toBe(0);
  });
});
