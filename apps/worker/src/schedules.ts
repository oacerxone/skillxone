import type { DatabaseHandle, JobQueue } from '@skillxone/database';

/**
 * Recurring work. A schedule is due when no job it created exists newer than its interval;
 * `enqueueDueSchedules` is safe to run as often as you like (from cron every few minutes, or
 * from `worker serve`), because due-ness and dedupe keys prevent duplicate work.
 *
 * Intervals are configurable with SCHEDULE_<ID>_MINUTES (0 turns a schedule off).
 */

export interface ScheduledJob {
  type: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface Schedule {
  id: string;
  envVar: string;
  defaultMinutes: number;
  description: string;
  jobs: ScheduledJob[];
}

const discover = (provider: string, extra: Record<string, unknown> = {}): ScheduledJob => ({
  type: 'discover',
  payload: { provider, ...extra },
  dedupeKey: `discover:${provider}`,
});

export const SCHEDULES: readonly Schedule[] = [
  {
    id: 'trending',
    envVar: 'SCHEDULE_TRENDING_MINUTES',
    defaultMinutes: 6 * 60,
    description: 'Search GitHub for active skill repositories and refresh their metrics.',
    jobs: [discover('repo-search')],
  },
  {
    id: 'recent',
    envVar: 'SCHEDULE_RECENT_MINUTES',
    defaultMinutes: 24 * 60,
    description: 'Seeds, curated collections, code search, and repositories not checked for a day.',
    jobs: [
      discover('seed'),
      discover('collection'),
      discover('code-search'),
      discover('recrawl', { olderThanHours: 20 }),
    ],
  },
  {
    id: 'full',
    envVar: 'SCHEDULE_FULL_MINUTES',
    defaultMinutes: 7 * 24 * 60,
    description:
      'Re-check every indexed repository, list every topic repository above the star floor, and rebuild the search index.',
    jobs: [
      {
        type: 'discover',
        payload: { provider: 'recrawl', olderThanHours: 1 },
        dedupeKey: 'discover:recrawl-full',
      },
      discover('repo-search-full'),
      { type: 'reindex', payload: {}, dedupeKey: 'reindex' },
    ],
  },
  {
    id: 'ranking',
    envVar: 'SCHEDULE_RANKING_MINUTES',
    defaultMinutes: 24 * 60,
    description: 'Recompute quality and trend scores.',
    jobs: [{ type: 'rank', payload: {}, dedupeKey: 'rank' }],
  },
  {
    id: 'verification',
    envVar: 'SCHEDULE_VERIFICATION_MINUTES',
    defaultMinutes: 60,
    description: 'End expired verifications and queue scans for anything not yet assessed.',
    jobs: [
      { type: 'expire_verifications', payload: {}, dedupeKey: 'expire_verifications' },
      { type: 'enqueue_scans', payload: {}, dedupeKey: 'enqueue_scans' },
    ],
  },
  {
    id: 'maintenance',
    envVar: 'SCHEDULE_MAINTENANCE_MINUTES',
    defaultMinutes: 24 * 60,
    description:
      'Delete finished jobs older than 30 days; remove copies and over-cap skills, compress stored files.',
    jobs: [
      { type: 'prune_jobs', payload: { olderThanDays: 30 }, dedupeKey: 'prune_jobs' },
      { type: 'compact_catalog', payload: {}, dedupeKey: 'compact_catalog' },
    ],
  },
];

/** Interval for each schedule, from the environment; invalid values fall back to the default. */
export function scheduleIntervals(
  env: Record<string, string | undefined> = process.env,
): Map<string, number> {
  const intervals = new Map<string, number>();
  for (const schedule of SCHEDULES) {
    const raw = env[schedule.envVar];
    const value = raw === undefined || raw === '' ? Number.NaN : Number(raw);
    intervals.set(
      schedule.id,
      Number.isInteger(value) && value >= 0 && value <= 525_600 ? value : schedule.defaultMinutes,
    );
  }
  return intervals;
}

export interface ScheduleStatus {
  id: string;
  description: string;
  intervalMinutes: number;
  lastRun: string | null;
  nextRun: string | null;
  due: boolean;
}

export async function scheduleStatus(
  db: DatabaseHandle['db'],
  now: Date,
  intervals: Map<string, number> = scheduleIntervals(),
): Promise<ScheduleStatus[]> {
  const rows = await db
    .selectFrom('sync_jobs')
    .select(['schedule', (eb) => eb.fn.max('created_at').as('last')])
    .where('schedule', 'is not', null)
    .groupBy('schedule')
    .execute();
  const last = new Map(rows.map((row) => [row.schedule as string, row.last as string | null]));
  return SCHEDULES.map((schedule) => {
    const interval = intervals.get(schedule.id) ?? schedule.defaultMinutes;
    const lastRun = last.get(schedule.id) ?? null;
    if (interval === 0) {
      return {
        id: schedule.id,
        description: schedule.description,
        intervalMinutes: 0,
        lastRun,
        nextRun: null,
        due: false,
      };
    }
    const next = lastRun ? new Date(new Date(lastRun).getTime() + interval * 60_000) : now;
    return {
      id: schedule.id,
      description: schedule.description,
      intervalMinutes: interval,
      lastRun,
      nextRun: next.toISOString(),
      due: next.getTime() <= now.getTime(),
    };
  });
}

/** Queues the jobs of every due schedule. Returns the schedules that ran. */
export async function enqueueDueSchedules(
  deps: { db: DatabaseHandle['db']; queue: JobQueue; now: () => Date },
  intervals: Map<string, number> = scheduleIntervals(),
  only?: string,
): Promise<Array<{ id: string; enqueued: number }>> {
  const now = deps.now();
  const ran: Array<{ id: string; enqueued: number }> = [];
  for (const status of await scheduleStatus(deps.db, now, intervals)) {
    if (only ? status.id !== only : !status.due) continue;
    const schedule = SCHEDULES.find((s) => s.id === status.id)!;
    let enqueued = 0;
    for (const job of schedule.jobs) {
      const result = await deps.queue.enqueue(job.type, job.payload, {
        dedupeKey: job.dedupeKey,
        schedule: schedule.id,
      });
      if (result.created) enqueued += 1;
    }
    ran.push({ id: schedule.id, enqueued });
  }
  return ran;
}
