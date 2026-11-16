import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backoffDelayMs, createJobQueue, migrateToLatest, openDatabase } from './index';
import type { DatabaseHandle, JobQueue } from './index';

const START = new Date('2026-01-01T00:00:00.000Z');
const LEASE = 60_000;

/** Controllable clock shared by every queue in a test. */
function fakeClock() {
  let current = START.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

let handle: DatabaseHandle;
let clock: ReturnType<typeof fakeClock>;
let queue: JobQueue;

beforeEach(async () => {
  handle = await openDatabase('file::memory:');
  await migrateToLatest(handle.db);
  clock = fakeClock();
  // random = 0.5 makes the jitter factor exactly 1.
  queue = createJobQueue(handle.db, { clock: clock.now, random: () => 0.5, backoffBaseMs: 1000 });
});
afterEach(async () => {
  await handle.close();
});

describe('enqueue and claim', () => {
  it('claims a queued job, marks it running and counts the attempt', async () => {
    const { id } = await queue.enqueue('noop', { a: 1 });
    const job = await queue.claim('w1', [], LEASE);
    expect(job?.id).toBe(id);
    expect(job?.status).toBe('running');
    expect(job?.attempts).toBe(1);
    expect(job?.locked_by).toBe('w1');
    expect(JSON.parse(job!.payload_json)).toEqual({ a: 1 });
  });

  it('returns null when nothing is runnable', async () => {
    expect(await queue.claim('w1', [], LEASE)).toBeNull();
  });

  it('does not hand the same job to a second claimer', async () => {
    await queue.enqueue('noop');
    expect(await queue.claim('w1', [], LEASE)).not.toBeNull();
    expect(await queue.claim('w2', [], LEASE)).toBeNull();
  });

  it('respects run_after', async () => {
    await queue.enqueue('noop', {}, { runAfter: new Date(START.getTime() + 5000) });
    expect(await queue.claim('w1', [], LEASE)).toBeNull();
    clock.advance(5000);
    expect(await queue.claim('w1', [], LEASE)).not.toBeNull();
  });

  it('orders by priority, then by age', async () => {
    const low = await queue.enqueue('noop', {}, { priority: 0 });
    clock.advance(10);
    const high = await queue.enqueue('noop', {}, { priority: 5 });
    expect((await queue.claim('w1', [], LEASE))?.id).toBe(high.id);
    expect((await queue.claim('w1', [], LEASE))?.id).toBe(low.id);
  });

  it('filters by job type', async () => {
    await queue.enqueue('scan');
    const sync = await queue.enqueue('sync');
    expect((await queue.claim('w1', ['sync'], LEASE))?.id).toBe(sync.id);
    expect(await queue.claim('w1', ['sync'], LEASE)).toBeNull();
  });
});

describe('deduplication', () => {
  it('returns the active job instead of creating a duplicate', async () => {
    const first = await queue.enqueue('sync', {}, { dedupeKey: 'repo:1' });
    const second = await queue.enqueue('sync', {}, { dedupeKey: 'repo:1' });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
  });

  it('still deduplicates while the job is running', async () => {
    const first = await queue.enqueue('sync', {}, { dedupeKey: 'repo:1' });
    await queue.claim('w1', [], LEASE);
    expect((await queue.enqueue('sync', {}, { dedupeKey: 'repo:1' })).id).toBe(first.id);
  });

  it('allows a new job once the previous one has finished', async () => {
    const first = await queue.enqueue('sync', {}, { dedupeKey: 'repo:1' });
    await queue.claim('w1', [], LEASE);
    await queue.complete(first.id, 'w1');
    const next = await queue.enqueue('sync', {}, { dedupeKey: 'repo:1' });
    expect(next.created).toBe(true);
    expect(next.id).not.toBe(first.id);
  });

  it('is enforced by the database, not only by the lookup', async () => {
    await queue.enqueue('sync', {}, { dedupeKey: 'repo:1' });
    await expect(
      handle.db
        .insertInto('sync_jobs')
        .values({
          id: 'manual',
          type: 'sync',
          dedupe_key: 'repo:1',
          run_after: START.toISOString(),
          created_at: START.toISOString(),
        })
        .execute(),
    ).rejects.toThrow(/UNIQUE/i);
  });
});

describe('completion, failure and retry', () => {
  it('stores the result on completion', async () => {
    const { id } = await queue.enqueue('noop');
    await queue.claim('w1', [], LEASE);
    expect(await queue.complete(id, 'w1', { ok: true })).toBe(true);
    const job = await queue.get(id);
    expect(job?.status).toBe('succeeded');
    expect(job?.result_json).toBe('{"ok":true}');
    expect(job?.locked_by).toBeNull();
  });

  it('retries with exponential backoff', async () => {
    const { id } = await queue.enqueue('noop', {}, { maxAttempts: 4 });

    await queue.claim('w1', [], LEASE);
    expect(await queue.fail(id, 'w1', 'boom')).toBe('retry');
    expect((await queue.get(id))?.last_error).toBe('boom');
    expect(await queue.claim('w1', [], LEASE)).toBeNull(); // backoff 1000 ms not elapsed
    clock.advance(1000);

    expect((await queue.claim('w1', [], LEASE))?.attempts).toBe(2);
    await queue.fail(id, 'w1', 'boom');
    clock.advance(1999);
    expect(await queue.claim('w1', [], LEASE)).toBeNull(); // second backoff is 2000 ms
    clock.advance(1);
    expect((await queue.claim('w1', [], LEASE))?.attempts).toBe(3);
  });

  it('marks a job dead after the final attempt', async () => {
    const { id } = await queue.enqueue('noop', {}, { maxAttempts: 2 });
    await queue.claim('w1', [], LEASE);
    expect(await queue.fail(id, 'w1', 'first')).toBe('retry');
    clock.advance(60_000);
    await queue.claim('w1', [], LEASE);
    expect(await queue.fail(id, 'w1', 'second')).toBe('dead');

    const job = await queue.get(id);
    expect(job?.status).toBe('dead');
    expect(job?.last_error).toBe('second');
    clock.advance(24 * 60 * 60_000);
    expect(await queue.claim('w1', [], LEASE)).toBeNull();
  });

  it('computes capped backoff with bounded jitter', () => {
    expect(backoffDelayMs(1, 1000, 60_000, () => 0.5)).toBe(1000);
    expect(backoffDelayMs(3, 1000, 60_000, () => 0.5)).toBe(4000);
    expect(backoffDelayMs(30, 1000, 60_000, () => 0.999)).toBe(60_000);
    expect(backoffDelayMs(1, 1000, 60_000, () => 0)).toBe(800);
    expect(backoffDelayMs(1, 1000, 60_000, () => 0.999)).toBeLessThanOrEqual(1200);
  });
});

describe('leases and crash recovery', () => {
  it('lets another worker reclaim a job whose lease expired', async () => {
    const { id } = await queue.enqueue('noop');
    await queue.claim('crashed', [], LEASE);

    clock.advance(LEASE - 1);
    expect(await queue.claim('w2', [], LEASE)).toBeNull();

    clock.advance(2);
    const reclaimed = await queue.claim('w2', [], LEASE);
    expect(reclaimed?.id).toBe(id);
    expect(reclaimed?.locked_by).toBe('w2');
    expect(reclaimed?.attempts).toBe(2);
  });

  it('ignores completion and failure from a worker that lost its lease', async () => {
    const { id } = await queue.enqueue('noop');
    await queue.claim('slow', [], LEASE);
    clock.advance(LEASE + 1);
    await queue.claim('w2', [], LEASE);

    expect(await queue.complete(id, 'slow', { stale: true })).toBe(false);
    expect(await queue.fail(id, 'slow', 'stale')).toBe('lost');
    expect(await queue.heartbeat(id, 'slow', LEASE)).toBe(false);

    const job = await queue.get(id);
    expect(job?.status).toBe('running');
    expect(job?.locked_by).toBe('w2');
  });

  it('keeps a job with a heartbeat', async () => {
    const { id } = await queue.enqueue('noop');
    await queue.claim('w1', [], LEASE);
    clock.advance(LEASE - 1000);
    expect(await queue.heartbeat(id, 'w1', LEASE)).toBe(true);
    clock.advance(LEASE - 1000);
    expect(await queue.claim('w2', [], LEASE)).toBeNull();
  });

  it('marks a job dead when its lease expires on the final attempt', async () => {
    const { id } = await queue.enqueue('noop', {}, { maxAttempts: 1 });
    await queue.claim('crashed', [], LEASE);
    clock.advance(LEASE + 1);
    expect(await queue.claim('w2', [], LEASE)).toBeNull();
    expect((await queue.get(id))?.status).toBe('dead');
  });
});

describe('two workers on one database file', () => {
  let dir: string;
  let a: DatabaseHandle;
  let b: DatabaseHandle;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'skillxone-jobs-'));
    const url = `file:${join(dir, 'queue.db')}`;
    a = await openDatabase(url);
    b = await openDatabase(url);
    await migrateToLatest(a.db);
  });
  afterEach(async () => {
    await a.close();
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never processes a job twice', async () => {
    const queueA = createJobQueue(a.db);
    const queueB = createJobQueue(b.db);
    const total = 200;
    for (let i = 0; i < total; i += 1) await queueA.enqueue('noop', { i });

    const drain = async (q: JobQueue, workerId: string) => {
      const claimed: string[] = [];
      for (;;) {
        const job = await q.claim(workerId, [], LEASE);
        if (!job) return claimed;
        claimed.push(job.id);
        await q.complete(job.id, workerId);
      }
    };

    const [fromA, fromB] = await Promise.all([drain(queueA, 'a'), drain(queueB, 'b')]);
    const all = [...fromA, ...fromB];
    expect(all).toHaveLength(total);
    expect(new Set(all).size).toBe(total);
    expect(await queueA.counts()).toEqual({ succeeded: total });
  });
});
