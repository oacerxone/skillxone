import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJobQueue, migrateToLatest, openDatabase, seedCategories } from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { GitHubClient } from '@skillxone/github';
import { createDefaultScanners } from '@skillxone/security';
import { createProcessors } from './processors';
import { drainQueue } from './runner';
import type { ProcessorRegistry } from './runner';
import { enqueueDueSchedules, SCHEDULES, scheduleIntervals, scheduleStatus } from './schedules';
import type { SyncDeps } from './sync';
import { FakeGitHub, skillMd } from './test-support';

const OFFLINE_SCAN = { scanners: createDefaultScanners({ osv: null, gitleaksBinary: null }) };
const seeds = { repositories: ['octo/skills'], collections: [], searchQueries: [] };

describe('a worker killed mid-job', () => {
  let handle: DatabaseHandle;
  let now: Date;
  beforeEach(async () => {
    handle = await openDatabase('file::memory:');
    await migrateToLatest(handle.db);
    await seedCategories(handle.db);
    now = new Date('2026-06-01T00:00:00.000Z');
  });
  afterEach(() => handle.close());

  it('is reclaimed after its lease expires and finishes without duplicates', async () => {
    const github = new FakeGitHub();
    github.repos.push({
      id: 3001,
      owner: 'octo',
      ownerId: 1,
      name: 'skills',
      stars: 10,
      files: { 'skills/a/SKILL.md': skillMd('a'), 'skills/b/SKILL.md': skillMd('b') },
    });
    const queue = createJobQueue(handle.db, { clock: () => now });
    const deps: SyncDeps = {
      db: handle.db,
      client: new GitHubClient({
        fetch: github.fetch,
        sleep: async () => undefined,
        maxRetries: 0,
      }),
      queue,
      now: () => now,
    };
    const { id } = await queue.enqueue('sync_repo', {
      owner: 'octo',
      repo: 'skills',
      source: 'seed',
    });
    const processors = createProcessors({ ...deps, scan: OFFLINE_SCAN }, seeds);

    // The first worker claims the job, does the work, then "dies" before reporting back.
    const job = await queue.claim('worker-that-dies', ['sync_repo'], 60_000);
    expect(job?.id).toBe(id);
    await processors.sync_repo!(JSON.parse(job!.payload_json), {
      job: job!,
      signal: new AbortController().signal,
    });

    // Before the lease expires nobody else can take it.
    expect(await queue.claim('second-worker', ['sync_repo'], 60_000)).toBeNull();

    now = new Date(now.getTime() + 61_000);
    const summary = await drainQueue(queue, processors, {
      workerId: 'second-worker',
      leaseMs: 60_000,
    });
    expect(summary.dead).toBe(0);
    const finished = await queue.get(id);
    expect(finished).toMatchObject({ status: 'succeeded', attempts: 2, locked_by: null });
    // The dead worker's late report is rejected.
    expect(await queue.complete(id, 'worker-that-dies')).toBe(false);

    const skills = await handle.db.selectFrom('skills').select('name').orderBy('name').execute();
    expect(skills.map((s) => s.name)).toEqual(['a', 'b']);
    const versions = await handle.db.selectFrom('skill_versions').select('id').execute();
    expect(versions).toHaveLength(2);
    const scans = await handle.db.selectFrom('security_scans').select('version_id').execute();
    expect(new Set(scans.map((s) => s.version_id)).size).toBe(scans.length);
  });

  it('keeps the lease of a long job alive with heartbeats', async () => {
    const queue = createJobQueue(handle.db);
    const { id } = await queue.enqueue('slow');
    const processors: ProcessorRegistry = {
      slow: () => new Promise((resolve) => setTimeout(() => resolve('done'), 2600)),
    };
    const worker = drainQueue(queue, processors, { workerId: 'a', leaseMs: 1500 });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    // Past the original lease, but the heartbeat has extended it.
    expect(await queue.claim('b', ['slow'], 1500)).toBeNull();
    expect((await worker).succeeded).toBe(1);
    expect((await queue.get(id))?.status).toBe('succeeded');
  }, 10_000);
});

describe('two workers on one database file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skillxone-workers-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('never run the same job twice', async () => {
    const url = `file:${join(dir, 'w.db')}`;
    const a = await openDatabase(url);
    const b = await openDatabase(url);
    try {
      await migrateToLatest(a.db);
      const queueA = createJobQueue(a.db);
      const queueB = createJobQueue(b.db);
      for (let i = 0; i < 60; i += 1) await queueA.enqueue('work', { i });
      const ran: number[] = [];
      const processors: ProcessorRegistry = {
        async work(payload) {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
          ran.push((payload as { i: number }).i);
          return null;
        },
      };
      const [sa, sb] = await Promise.all([
        drainQueue(queueA, processors, { workerId: 'a' }),
        drainQueue(queueB, processors, { workerId: 'b' }),
      ]);
      expect(sa.succeeded + sb.succeeded).toBe(60);
      expect(ran).toHaveLength(60);
      expect(new Set(ran).size).toBe(60);
      expect(sa.succeeded).toBeGreaterThan(0);
      expect(sb.succeeded).toBeGreaterThan(0);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe('lock contention', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skillxone-locks-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lets a web write wait for, then follow, a worker write in progress', async () => {
    const path = join(dir, 'lock.db');
    const web = await openDatabase(`file:${path}`);
    try {
      await migrateToLatest(web.db);
      // The "worker" runs in another thread so it can hold the write lock while this
      // thread's synchronous driver waits on SQLite's busy timeout.
      const script = join(dir, 'writer.cjs');
      const driver = createRequire(import.meta.url).resolve('better-sqlite3', {
        paths: [join(import.meta.dirname, '../../../packages/database')],
      });
      writeFileSync(
        script,
        `const Database = require(${JSON.stringify(driver)});
         const { parentPort, workerData } = require('node:worker_threads');
         const db = new Database(workerData.path);
         db.pragma('journal_mode = WAL');
         db.prepare('BEGIN IMMEDIATE').run();
         const insert = db.prepare("insert into sync_jobs (id, type, payload_json, status, attempts, max_attempts, priority, run_after, created_at) values (?, 'noop', '{}', 'queued', 0, 3, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
         for (let i = 0; i < 2000; i += 1) insert.run('w' + String(i).padStart(6, '0'));
         parentPort.postMessage('locked');
         const until = Date.now() + 400;
         while (Date.now() < until) {}
         db.prepare('COMMIT').run();
         db.close();
         parentPort.postMessage('committed');`,
      );
      const worker = new Worker(script, { workerData: { path } });
      const events: string[] = [];
      const committed = new Promise<void>((resolve, reject) => {
        worker.on('message', (message: string) => {
          events.push(message);
          if (message === 'committed') resolve();
        });
        worker.on('error', reject);
      });
      await new Promise<void>((resolve) => worker.once('message', () => resolve()));

      const started = Date.now();
      await createJobQueue(web.db).enqueue('from-web', { ok: true });
      const waited = Date.now() - started;
      events.push('web-wrote');
      await committed;
      await worker.terminate();

      expect(events.indexOf('web-wrote')).toBeGreaterThan(events.indexOf('locked'));
      expect(waited).toBeGreaterThan(100);
      const counts = await createJobQueue(web.db).counts();
      expect(counts.queued).toBe(2001);
    } finally {
      await web.close();
    }
  });
});

describe('schedules', () => {
  let handle: DatabaseHandle;
  let now: Date;
  beforeEach(async () => {
    handle = await openDatabase('file::memory:');
    await migrateToLatest(handle.db);
    now = new Date('2026-06-01T00:00:00.000Z');
  });
  afterEach(() => handle.close());

  it('reads intervals from the environment, with 0 turning a schedule off', () => {
    const intervals = scheduleIntervals({
      SCHEDULE_TRENDING_MINUTES: '30',
      SCHEDULE_FULL_MINUTES: '0',
      SCHEDULE_RANKING_MINUTES: 'soon',
    });
    expect(intervals.get('trending')).toBe(30);
    expect(intervals.get('full')).toBe(0);
    expect(intervals.get('ranking')).toBe(24 * 60);
    expect(intervals.get('verification')).toBe(60);
  });

  it('queue each schedule once per interval', async () => {
    const queue = createJobQueue(handle.db, { clock: () => now });
    const deps = { db: handle.db, queue, now: () => now };
    const intervals = scheduleIntervals({ SCHEDULE_FULL_MINUTES: '0' });

    const first = await enqueueDueSchedules(deps, intervals);
    expect(first.map((r) => r.id).sort()).toEqual(
      SCHEDULES.map((s) => s.id)
        .filter((id) => id !== 'full')
        .sort(),
    );
    expect(await enqueueDueSchedules(deps, intervals)).toEqual([]);

    now = new Date(now.getTime() + 61 * 60_000);
    const later = await enqueueDueSchedules(deps, intervals);
    expect(later.map((r) => r.id)).toEqual(['verification']);
    // The previous run's jobs are still queued, so nothing is duplicated.
    expect(later[0]!.enqueued).toBe(0);

    const status = await scheduleStatus(handle.db, now, intervals);
    expect(status.find((s) => s.id === 'full')).toMatchObject({
      intervalMinutes: 0,
      due: false,
      nextRun: null,
    });
    expect(status.find((s) => s.id === 'ranking')).toMatchObject({
      due: false,
      nextRun: '2026-06-02T00:00:00.000Z',
    });
  });

  it('can run one schedule on demand', async () => {
    const queue = createJobQueue(handle.db, { clock: () => now });
    const ran = await enqueueDueSchedules(
      { db: handle.db, queue, now: () => now },
      scheduleIntervals({}),
      'ranking',
    );
    expect(ran).toEqual([{ id: 'ranking', enqueued: 1 }]);
    const jobs = await handle.db.selectFrom('sync_jobs').select(['type', 'schedule']).execute();
    expect(jobs).toEqual([{ type: 'rank', schedule: 'ranking' }]);
  });

  it('prunes old finished jobs', async () => {
    const queue = createJobQueue(handle.db, { clock: () => now });
    const { id } = await queue.enqueue('noop');
    const job = await queue.claim('w', [], 60_000);
    await queue.complete(job!.id, 'w');
    now = new Date(now.getTime() + 31 * 86_400_000);
    const processors = createProcessors(
      {
        db: handle.db,
        client: new GitHubClient({ fetch: new FakeGitHub().fetch }),
        queue,
        now: () => now,
        scan: OFFLINE_SCAN,
      },
      seeds,
    );
    expect(await processors.prune_jobs!({ olderThanDays: 30 }, {} as never)).toEqual({
      deleted: 1,
    });
    expect(await queue.get(id)).toBeUndefined();
  });
});
