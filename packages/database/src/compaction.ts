import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { skillCapForStars, toIso } from '@skillxone/shared';
import { encodeFileContent } from './file-content';
import type { Database } from './types';

/**
 * Keeps the catalog small enough for a small server. Three rules, all idempotent:
 *
 *  1. Identical copies. When several active skills have exactly the same content, one is
 *     kept: the one in a protected repository (seed list), then the most starred, then the
 *     repository indexed first, then the lowest path. The others are marked removed.
 *  2. Per-repository caps by stars (`skillCapForStars`): a repository keeps its first N
 *     skills in path order, the order the indexer finds them in.
 *  3. Removed skills are deleted with their versions and files; nothing links to them.
 *
 * The same ordering is used when a repository is synced (`hasBetterCopy`), so the rules
 * agree whichever runs first.
 */

type Db = Kysely<Database>;

export interface CompactionOptions {
  /** Repository full names (`owner/name`) that are never deduplicated away or capped. */
  protectedRepositories: readonly string[];
  /** Operator ceiling on skills per repository. */
  maxSkillsPerRepo?: number;
  now: Date;
}

const lowerNames = (names: readonly string[]) => names.map((name) => name.toLowerCase());

const protectedFlag = (names: readonly string[]) => {
  const lower = lowerNames(names);
  return lower.length === 0
    ? sql<number>`0`
    : sql<number>`case when r.full_name_lower in (${sql.join(lower)}) then 1 else 0 end`;
};

export interface CopyCandidate {
  contentHash: string;
  repositoryId: string;
  path: string;
  stars: number;
  isProtected: boolean;
  /**
   * Skill paths found in this repository's current listing. Another skill of the same
   * repository only counts as a copy if its path is still present; otherwise this is the
   * same skill after its directory was renamed.
   */
  presentPaths: readonly string[];
}

/** True when an active skill elsewhere has the same content and ranks ahead of this one. */
export async function hasBetterCopy(
  db: Db,
  candidate: CopyCandidate,
  protectedRepositories: readonly string[],
): Promise<boolean> {
  const prot = protectedFlag(protectedRepositories);
  const mine = candidate.isProtected ? 1 : 0;
  const row = await db
    .selectFrom('skills as s')
    .innerJoin('skill_versions as v', 'v.id', 's.current_version_id')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .select('s.id')
    .where('v.content_hash', '=', candidate.contentHash)
    .where('s.status', '=', 'active')
    .where('r.status', 'in', ['active', 'archived'])
    .where((eb) =>
      eb.or([
        eb('s.repository_id', '!=', candidate.repositoryId),
        eb.and([
          eb('s.path', '!=', candidate.path),
          candidate.presentPaths.length > 0
            ? eb('s.path', 'in', [...candidate.presentPaths])
            : sql<boolean>`1 = 0`,
        ]),
      ]),
    )
    .where(
      sql<boolean>`(
        ${prot} > ${mine}
        or (${prot} = ${mine} and (
          r.stars > ${candidate.stars}
          or (r.stars = ${candidate.stars} and (
            s.repository_id < ${candidate.repositoryId}
            or (s.repository_id = ${candidate.repositoryId} and s.path < ${candidate.path})
          ))
        ))
      )`,
    )
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

async function markRemoved(db: Db, ids: readonly string[], now: Date): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    await db
      .updateTable('skills')
      .set({ status: 'removed', updated_at: toIso(now) })
      .where('id', 'in', ids.slice(i, i + 500))
      .where('status', '=', 'active')
      .execute();
  }
}

export interface LimitsResult {
  duplicates: number;
  capped: number;
  repositoryIds: string[];
}

/** Applies rules 1 and 2 to the whole catalog. */
export async function enforceCatalogLimits(
  db: Db,
  options: CompactionOptions,
): Promise<LimitsResult> {
  const prot = protectedFlag(options.protectedRepositories);
  const touched = new Set<string>();

  const dupes = await sql<{ id: string; repository_id: string }>`
    select t.id, t.repository_id from (
      select s.id, s.repository_id,
        row_number() over (
          partition by v.content_hash
          order by ${prot} desc, r.stars desc, s.repository_id asc, s.path asc
        ) as rn
      from skills s
      join skill_versions v on v.id = s.current_version_id
      join repositories r on r.id = s.repository_id
      where s.status = 'active' and r.status in ('active', 'archived')
    ) t
    where t.rn > 1
  `.execute(db);
  await markRemoved(
    db,
    dupes.rows.map((row) => row.id),
    options.now,
  );
  for (const row of dupes.rows) touched.add(row.repository_id);

  const protectedSet = new Set(lowerNames(options.protectedRepositories));
  const counts = await db
    .selectFrom('skills as s')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .select(['r.id as id', 'r.stars as stars', 'r.full_name_lower as name'])
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('s.status', '=', 'active')
    .groupBy(['r.id', 'r.stars', 'r.full_name_lower'])
    .execute();
  let capped = 0;
  for (const repo of counts) {
    if (protectedSet.has(repo.name)) continue;
    const cap = skillCapForStars(Number(repo.stars), options.maxSkillsPerRepo);
    if (Number(repo.n) <= cap) continue;
    const skills = await db
      .selectFrom('skills')
      .select(['id', 'path'])
      .where('repository_id', '=', repo.id)
      .where('status', '=', 'active')
      .execute();
    // Same order as locateSkills, so the indexer keeps the same skills on its next pass.
    skills.sort((a, b) => a.path.localeCompare(b.path));
    const extra = skills.slice(cap).map((skill) => skill.id);
    await markRemoved(db, extra, options.now);
    capped += extra.length;
    touched.add(repo.id);
  }

  return { duplicates: dupes.rows.length, capped, repositoryIds: [...touched] };
}

/** Rule 3: deletes up to `limit` removed skills (cascading to versions and files). */
export async function purgeRemovedSkills(
  db: Db,
  limit = 1000,
): Promise<{ deleted: number; repositoryIds: string[] }> {
  const rows = await db
    .selectFrom('skills')
    .select(['id', 'repository_id'])
    .where('status', '=', 'removed')
    .orderBy('id')
    .limit(limit)
    .execute();
  if (rows.length === 0) return { deleted: 0, repositoryIds: [] };
  await db
    .deleteFrom('skills')
    .where(
      'id',
      'in',
      rows.map((row) => row.id),
    )
    .where('status', '=', 'removed')
    .execute();
  return {
    deleted: rows.length,
    repositoryIds: [...new Set(rows.map((row) => row.repository_id))],
  };
}

/**
 * Compresses stored files written before compression existed, in id order from `afterId`.
 * Returns the last id examined (the cursor for the next call) or null when finished.
 */
export async function compressStoredFiles(
  db: Db,
  afterId: string,
  limit = 500,
): Promise<{ compressed: number; examined: number; nextAfterId: string | null }> {
  const rows = await db
    .selectFrom('skill_files')
    .select(['id', 'kind', 'content'])
    .where('id', '>', afterId)
    .where('content_encoding', 'is', null)
    .where('content', 'is not', null)
    .where('kind', '!=', 'skill_md')
    .orderBy('id')
    .limit(limit)
    .execute();
  let compressed = 0;
  for (const row of rows) {
    const encoded = encodeFileContent(row.kind, row.content);
    if (encoded.content_encoding === null) continue;
    await db
      .updateTable('skill_files')
      .set({ content: encoded.content, content_encoding: encoded.content_encoding })
      .where('id', '=', row.id)
      .where('content_encoding', 'is', null)
      .execute();
    compressed += 1;
  }
  return {
    compressed,
    examined: rows.length,
    nextAfterId: rows.length < limit ? null : rows[rows.length - 1]!.id,
  };
}

/** Number of active skills, for the catalog-size guard. */
export async function countActiveSkills(db: Db): Promise<number> {
  const row = await db
    .selectFrom('skills')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('status', '=', 'active')
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Whether a repository currently has any active skill. */
export async function repositoryHasActiveSkills(db: Db, repositoryId: string): Promise<boolean> {
  const row = await db
    .selectFrom('skills')
    .select('id')
    .where('repository_id', '=', repositoryId)
    .where('status', '=', 'active')
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Returns freed pages to the file system (SQLite only; PostgreSQL reclaims space with its
 * own VACUUM). Needs exclusive access: stop the web app and worker first. Temporary data
 * goes to disk, not memory, because the whole database is rewritten.
 */
export async function vacuumSqlite(db: Db): Promise<void> {
  await sql`pragma wal_checkpoint(TRUNCATE)`.execute(db);
  await sql`pragma temp_store = FILE`.execute(db);
  await sql`vacuum`.execute(db);
  await sql`pragma temp_store = MEMORY`.execute(db);
}
