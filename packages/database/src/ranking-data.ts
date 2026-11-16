import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { toIso } from '@skillxone/shared';
import type { VerificationState } from '@skillxone/shared';
import type { Database } from './types';
import { writeTransaction } from './transaction';

/**
 * Data access for the ranking job: gathers the raw facts each signal needs and stores the
 * resulting scores. The scoring itself lives in `packages/ranking` and is pure.
 */

type Db = Kysely<Database>;
const DAY_MS = 24 * 60 * 60_000;

export interface RankingFacts {
  skillId: string;
  stars: number;
  forks: number;
  starDelta7: number | null;
  starDelta30: number | null;
  historyDays: number;
  daysSincePush: number | null;
  daysSinceContentChange: number | null;
  archived: boolean;
  bodyLength: number;
  hasExamples: boolean;
  brokenReferences: number;
  specValid: boolean;
  descriptionLength: number;
  hasLicense: boolean;
  verificationState: VerificationState;
  confirmedAgents: number;
  supportedAgents: number;
  openReports: number;
}

const daysBetween = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : Math.max(0, (now.getTime() - time) / DAY_MS);
};

interface Snapshot {
  day: string;
  stars: number;
}

/**
 * Star change over `days`, from recorded snapshots only: the latest snapshot minus the most
 * recent one that is at least `days` older. Null when no snapshot is old enough. Nothing is
 * interpolated or estimated.
 */
export function starDelta(snapshots: readonly Snapshot[], days: number): number | null {
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;
  const cutoff = new Date(new Date(`${latest.day}T00:00:00.000Z`).getTime() - days * DAY_MS)
    .toISOString()
    .slice(0, 10);
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = snapshots[i]!;
    if (snapshot.day <= cutoff) return latest.stars - snapshot.stars;
  }
  return null;
}

export async function loadRankingFacts(db: Db, now: Date): Promise<RankingFacts[]> {
  const skills = await db
    .selectFrom('skills as s')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .leftJoin('skill_versions as v', 'v.id', 's.current_version_id')
    .leftJoin('skill_files as f', (join) =>
      join.onRef('f.version_id', '=', 's.current_version_id').on('f.kind', '=', 'skill_md'),
    )
    .select([
      's.id as id',
      's.repository_id as repository_id',
      's.content_updated_at as content_updated_at',
      's.spec_valid as spec_valid',
      's.license as license',
      's.verification_state as verification_state',
      'r.stars as stars',
      'r.forks as forks',
      'r.pushed_at as pushed_at',
      'r.is_archived as is_archived',
      'v.parse_errors_json as parse_errors_json',
      sql<number>`length(s.description)`.as('description_length'),
      sql<number>`coalesce(length(f.content), 0)`.as('body_length'),
      sql<number>`case when f.content like '%\`\`\`%' then 1 else 0 end`.as('has_examples'),
    ])
    .where('s.status', '=', 'active')
    .where('r.status', 'in', ['active', 'archived'])
    .execute();

  const compatibility = await db
    .selectFrom('agent_compatibility')
    .select(['skill_id', 'level'])
    .where('level', '!=', 'unsupported')
    .execute();
  const agents = new Map<string, { supported: number; confirmed: number }>();
  for (const row of compatibility) {
    const entry = agents.get(row.skill_id) ?? { supported: 0, confirmed: 0 };
    entry.supported += 1;
    if (row.level === 'declared' || row.level === 'verified') entry.confirmed += 1;
    agents.set(row.skill_id, entry);
  }

  const reports = await db
    .selectFrom('reports')
    .select(['skill_id', (eb) => eb.fn.countAll<number>().as('n')])
    // Only reports a moderator has triaged count: an untriaged report costs nothing to file,
    // so counting it would let anyone push a skill down the rankings.
    .where('status', '=', 'triaged')
    .where('skill_id', 'is not', null)
    .groupBy('skill_id')
    .execute();
  const openReports = new Map(reports.map((row) => [row.skill_id!, Number(row.n)]));

  const since = new Date(now.getTime() - 45 * DAY_MS).toISOString().slice(0, 10);
  const history = await db
    .selectFrom('github_metrics_history')
    .select(['repository_id', 'captured_on', 'stars'])
    .where('captured_on', '>=', since)
    .orderBy('repository_id')
    .orderBy('captured_on')
    .execute();
  const snapshots = new Map<string, Snapshot[]>();
  for (const row of history) {
    const list = snapshots.get(row.repository_id) ?? [];
    list.push({ day: row.captured_on, stars: row.stars });
    snapshots.set(row.repository_id, list);
  }
  const dayCounts = await db
    .selectFrom('github_metrics_history')
    .select(['repository_id', (eb) => eb.fn.countAll<number>().as('n')])
    .groupBy('repository_id')
    .execute();
  const historyDays = new Map(dayCounts.map((row) => [row.repository_id, Number(row.n)]));

  return skills.map((row) => {
    const repoSnapshots = snapshots.get(row.repository_id) ?? [];
    let brokenReferences = 0;
    try {
      const issues: unknown = JSON.parse(row.parse_errors_json ?? '[]');
      if (Array.isArray(issues)) {
        brokenReferences = issues.filter(
          (issue) => (issue as { code?: unknown } | null)?.code === 'BROKEN_REFERENCE',
        ).length;
      }
    } catch {
      brokenReferences = 0;
    }
    const agent = agents.get(row.id) ?? { supported: 0, confirmed: 0 };
    return {
      skillId: row.id,
      stars: Number(row.stars),
      forks: Number(row.forks),
      starDelta7: starDelta(repoSnapshots, 7),
      starDelta30: starDelta(repoSnapshots, 30),
      historyDays: historyDays.get(row.repository_id) ?? 0,
      daysSincePush: daysBetween(row.pushed_at, now),
      daysSinceContentChange: daysBetween(row.content_updated_at, now),
      archived: row.is_archived === 1,
      bodyLength: Number(row.body_length),
      hasExamples: Number(row.has_examples) === 1,
      brokenReferences,
      specValid: row.spec_valid === 1,
      descriptionLength: Number(row.description_length ?? 0),
      hasLicense: Boolean(row.license),
      verificationState: row.verification_state,
      confirmedAgents: agent.confirmed,
      supportedAgents: agent.supported,
      openReports: openReports.get(row.id) ?? 0,
    };
  });
}

export interface RankingScoreInput {
  skillId: string;
  quality: number;
  trending: number;
  rising: number;
  maintenance: number;
  /** Per-signal breakdown and adjustments, stored so a score can be explained. */
  detail: unknown;
  weightsVersion: string;
  historyDays: number;
}

/** Replaces the stored scores. Runs in one transaction so readers never see a partial set. */
export async function saveRankingScores(db: Db, scores: readonly RankingScoreInput[], now: Date) {
  const computedAt = toIso(now);
  await writeTransaction(db, async (trx) => {
    for (let offset = 0; offset < scores.length; offset += 200) {
      const batch = scores.slice(offset, offset + 200);
      await trx
        .insertInto('ranking_scores')
        .values(
          batch.map((score) => ({
            skill_id: score.skillId,
            quality_score: score.quality,
            trending_score: score.trending,
            rising_score: score.rising,
            maintenance_score: score.maintenance,
            signals_json: JSON.stringify(score.detail),
            weights_version: score.weightsVersion,
            history_days: score.historyDays,
            computed_at: computedAt,
          })),
        )
        .onConflict((oc) =>
          oc.column('skill_id').doUpdateSet((eb) => ({
            quality_score: eb.ref('excluded.quality_score'),
            trending_score: eb.ref('excluded.trending_score'),
            rising_score: eb.ref('excluded.rising_score'),
            maintenance_score: eb.ref('excluded.maintenance_score'),
            signals_json: eb.ref('excluded.signals_json'),
            weights_version: eb.ref('excluded.weights_version'),
            history_days: eb.ref('excluded.history_days'),
            computed_at: eb.ref('excluded.computed_at'),
          })),
        )
        .execute();
    }
  });
}

/** Largest number of recorded days for any repository; trend views need at least seven. */
export async function maxHistoryDays(db: Db): Promise<number> {
  const row = await db
    .selectFrom('ranking_scores')
    .select((eb) => eb.fn.max('history_days').as('n'))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
