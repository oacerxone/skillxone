import { createHash } from 'node:crypto';
import { encodeFileContent } from './file-content';
import type { Kysely, Transaction } from 'kysely';
import { newId, toIso } from '@skillxone/shared';
import type { Database, SkillFilesTable } from './types';
import { writeTransaction } from './transaction';

/**
 * Write side of ingestion. The worker fetches and parses; this module records the result.
 * It owns the lifecycle rules: repository identity across renames and transfers, deletion
 * after repeated misses, skill versions keyed by content hash, and the rule that a changed
 * skill loses its verification until it is assessed again.
 */

type Db = Kysely<Database> | Transaction<Database>;

export interface RepositoryInput {
  githubId: number;
  owner: string;
  name: string;
  ownerGithubId: number | null;
  ownerType: 'User' | 'Organization' | null;
  description: string | null;
  homepageUrl: string | null;
  defaultBranch: string | null;
  licenseSpdx: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  isArchived: boolean;
  isFork: boolean;
  pushedAt: string | null;
  githubCreatedAt: string | null;
  etag: string | null;
}

export interface RepositoryUpsertResult {
  id: string;
  created: boolean;
  /** Previous `owner/name` when the repository was renamed or transferred. */
  renamedFrom: string | null;
  /** True when the owning account changed (a transfer), which affects verification. */
  ownerChanged: boolean;
  previousHeadSha: string | null;
}

const trim = (value: string | null, max: number) => (value === null ? null : value.slice(0, max));

/**
 * Inserts or updates a repository, keyed by GitHub's numeric id. A row that still holds the
 * incoming name but belongs to a different id is a stale record of a repository that has
 * since been renamed or deleted; its name is released so the unique index is not violated.
 */
export async function upsertRepository(
  db: Kysely<Database>,
  input: RepositoryInput,
  source: string,
  now: Date,
): Promise<RepositoryUpsertResult> {
  const nowIso = toIso(now);
  const fullNameLower = `${input.owner}/${input.name}`.toLowerCase();

  return writeTransaction(db, async (trx) => {
    const squatter = await trx
      .selectFrom('repositories')
      .select(['id', 'github_id'])
      .where('full_name_lower', '=', fullNameLower)
      .executeTakeFirst();
    if (squatter && Number(squatter.github_id) !== input.githubId) {
      await trx
        .updateTable('repositories')
        .set({
          full_name_lower: `!superseded/${squatter.id}`,
          status: 'unreachable',
          updated_at: nowIso,
        })
        .where('id', '=', squatter.id)
        .execute();
      await recordIngestionError(trx, {
        repositoryId: squatter.id,
        code: 'REPO_NAME_REUSED',
        message: `The name ${fullNameLower} now belongs to a different repository.`,
        now,
      });
    }

    const existing = await trx
      .selectFrom('repositories')
      .selectAll()
      .where('github_id', '=', input.githubId)
      .executeTakeFirst();

    const values = {
      owner: input.owner,
      name: input.name,
      full_name_lower: fullNameLower,
      owner_github_id: input.ownerGithubId,
      owner_type: input.ownerType,
      description: trim(input.description, 1000),
      homepage_url: trim(input.homepageUrl, 500),
      default_branch: trim(input.defaultBranch, 255),
      license_spdx: trim(input.licenseSpdx, 100),
      stars: input.stars,
      forks: input.forks,
      open_issues: input.openIssues,
      is_archived: input.isArchived ? (1 as const) : (0 as const),
      is_fork: input.isFork ? (1 as const) : (0 as const),
      pushed_at: input.pushedAt,
      github_created_at: input.githubCreatedAt,
      etag: input.etag,
      last_synced_at: nowIso,
      last_sync_error: null,
      missing_count: 0,
      updated_at: nowIso,
    };

    if (!existing) {
      const id = newId(now);
      await trx
        .insertInto('repositories')
        .values({
          id,
          github_id: input.githubId,
          ...values,
          status: input.isArchived ? 'archived' : 'active',
          discovery_source: source,
          created_at: nowIso,
        })
        .execute();
      return { id, created: true, renamedFrom: null, ownerChanged: false, previousHeadSha: null };
    }

    const renamed = existing.full_name_lower !== fullNameLower;
    const ownerChanged =
      existing.owner_github_id !== null &&
      input.ownerGithubId !== null &&
      Number(existing.owner_github_id) !== input.ownerGithubId;
    let previousNames: string[] = [];
    try {
      const parsed: unknown = JSON.parse(existing.previous_full_names);
      if (Array.isArray(parsed))
        previousNames = parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      previousNames = [];
    }
    if (renamed && !existing.full_name_lower.startsWith('!')) {
      previousNames = [...previousNames, existing.full_name_lower].slice(-20);
    }

    await trx
      .updateTable('repositories')
      .set({
        ...values,
        previous_full_names: JSON.stringify(previousNames),
        // A disabled repository stays disabled until an administrator re-enables it.
        status:
          existing.status === 'disabled' ? 'disabled' : input.isArchived ? 'archived' : 'active',
      })
      .where('id', '=', existing.id)
      .execute();

    if (renamed) {
      // Skill URLs include the repository name, so they follow the rename.
      const skills = await trx
        .selectFrom('skills')
        .select(['id', 'slug'])
        .where('repository_id', '=', existing.id)
        .execute();
      for (const skill of skills) {
        const last = skill.slug.slice(skill.slug.lastIndexOf('/') + 1);
        await trx
          .updateTable('skills')
          .set({ slug: `${fullNameLower}/${last}`, updated_at: nowIso })
          .where('id', '=', skill.id)
          .execute();
      }
    }

    return {
      id: existing.id,
      created: false,
      renamedFrom: renamed ? existing.full_name_lower : null,
      ownerChanged,
      previousHeadSha: existing.head_sha,
    };
  });
}

/** Records the commit that was fully indexed, so the next sync can stop early if unchanged. */
export async function setRepositoryHead(db: Db, repositoryId: string, headSha: string, now: Date) {
  await db
    .updateTable('repositories')
    .set({ head_sha: headSha, updated_at: toIso(now) })
    .where('id', '=', repositoryId)
    .execute();
}

/** Marks a successful "nothing changed" check without touching anything else. */
export async function touchRepository(db: Db, repositoryId: string, now: Date) {
  await db
    .updateTable('repositories')
    .set({ last_synced_at: toIso(now), last_sync_error: null, missing_count: 0 })
    .where('id', '=', repositoryId)
    .execute();
}

/**
 * Records that GitHub answered "not found". One miss can be a transient error or a brief
 * visibility change, so the repository is only marked deleted after two in a row. Its
 * skills are then hidden from the catalog but kept with their history.
 */
export async function recordRepositoryMissing(
  db: Kysely<Database>,
  repositoryId: string,
  now: Date,
): Promise<'missing' | 'deleted'> {
  const nowIso = toIso(now);
  return writeTransaction(db, async (trx) => {
    const repo = await trx
      .selectFrom('repositories')
      .select(['missing_count'])
      .where('id', '=', repositoryId)
      .executeTakeFirstOrThrow();
    const misses = repo.missing_count + 1;
    const deleted = misses >= 2;
    await trx
      .updateTable('repositories')
      .set({
        missing_count: misses,
        // A single miss leaves the catalog untouched; only the second one hides the repository.
        ...(deleted ? { status: 'deleted' as const } : {}),
        last_sync_error: 'NOT_FOUND',
        last_synced_at: nowIso,
        updated_at: nowIso,
      })
      .where('id', '=', repositoryId)
      .execute();
    if (deleted) {
      await trx
        .updateTable('skills')
        .set({ status: 'removed', updated_at: nowIso })
        .where('repository_id', '=', repositoryId)
        .where('status', '=', 'active')
        .execute();
    }
    return deleted ? 'deleted' : 'missing';
  });
}

/** One row per repository per day; the basis for real trend calculations (ADR-008). */
export async function recordMetricsSnapshot(
  db: Db,
  repositoryId: string,
  metrics: { stars: number; forks: number; openIssues: number; pushedAt: string | null },
  now: Date,
) {
  const day = toIso(now).slice(0, 10);
  await db
    .insertInto('github_metrics_history')
    .values({
      id: newId(now),
      repository_id: repositoryId,
      captured_on: day,
      stars: metrics.stars,
      forks: metrics.forks,
      open_issues: metrics.openIssues,
      pushed_at: metrics.pushedAt,
    })
    .onConflict((oc) =>
      oc.columns(['repository_id', 'captured_on']).doUpdateSet({
        stars: metrics.stars,
        forks: metrics.forks,
        open_issues: metrics.openIssues,
        pushed_at: metrics.pushedAt,
      }),
    )
    .execute();
}

export interface IngestionErrorInput {
  repositoryId?: string | null;
  jobId?: string | null;
  code: string;
  path?: string | null;
  message: string;
  now: Date;
}

export async function recordIngestionError(db: Db, input: IngestionErrorInput) {
  await db
    .insertInto('ingestion_errors')
    .values({
      id: newId(input.now),
      repository_id: input.repositoryId ?? null,
      job_id: input.jobId ?? null,
      code: input.code,
      path: input.path ? input.path.slice(0, 500) : null,
      message: input.message.slice(0, 2000),
      created_at: toIso(input.now),
    })
    .execute();
}

/** Marks earlier open errors for a repository as resolved after a clean sync. */
export async function resolveIngestionErrors(db: Db, repositoryId: string, now: Date) {
  await db
    .updateTable('ingestion_errors')
    .set({ resolved_at: toIso(now) })
    .where('repository_id', '=', repositoryId)
    .where('resolved_at', 'is', null)
    .execute();
}

export interface SkillFileInput {
  path: string;
  blobSha: string;
  sizeBytes: number;
  kind: SkillFilesTable['kind'];
  isExecutable: boolean;
  isBinary: boolean;
  /** Text content, or null for binary and oversized files. */
  content: string | null;
  truncated: boolean;
}

export interface SkillSnapshotInput {
  repositoryId: string;
  repositoryFullName: string;
  /** Skill directory relative to the repository root, `''` for a root skill. */
  path: string;
  directoryName: string;
  name: string;
  description: string;
  license: string | null;
  compatibilityNote: string | null;
  specValid: boolean;
  frontmatter: Record<string, unknown>;
  parseIssues: unknown[];
  dependencies: unknown[];
  commitSha: string;
  contentHash: string;
  committedAt: string | null;
  files: SkillFileInput[];
  categorySlug: string | null;
  /**
   * Every skill directory present in the repository at this commit. Used to recognise a
   * renamed directory: a skill whose old path is gone and whose content is identical.
   */
  presentPaths?: readonly string[];
  compatibility: Array<{
    agentId: string;
    level: 'declared' | 'inferred' | 'verified' | 'unsupported';
    evidence: string;
    warnings: string[];
  }>;
}

export interface SkillSnapshotResult {
  skillId: string;
  versionId: string;
  outcome: 'created' | 'updated' | 'unchanged' | 'moved' | 'restored';
  /** True when a new version was stored and a security assessment is needed. */
  needsScan: boolean;
}

/** URL-safe last segment for a skill slug. Falls back to the directory name. */
export function slugSegment(name: string, directoryName: string): string {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80);
  return clean(name) || clean(directoryName) || 'skill';
}

async function uniqueSlug(
  trx: Db,
  base: string,
  path: string,
  skillId: string | null,
): Promise<string> {
  const taken = await trx
    .selectFrom('skills')
    .select('id')
    .where('slug', '=', base)
    .executeTakeFirst();
  if (!taken || taken.id === skillId) return base;
  // Two directories in one repository can declare the same name; keep both addressable.
  return `${base}~${createHash('sha256').update(path).digest('hex').slice(0, 6)}`;
}

/**
 * Stores one skill as found at a commit. Idempotent: the same content at the same path
 * changes nothing. New content creates a version and resets verification.
 */
export async function saveSkillSnapshot(
  db: Kysely<Database>,
  input: SkillSnapshotInput,
  now: Date,
): Promise<SkillSnapshotResult> {
  const nowIso = toIso(now);

  return writeTransaction(db, async (trx) => {
    let outcome: SkillSnapshotResult['outcome'] = 'unchanged';
    let skill = await trx
      .selectFrom('skills')
      .selectAll()
      .where('repository_id', '=', input.repositoryId)
      .where('path', '=', input.path)
      .executeTakeFirst();

    if (!skill) {
      // A skill directory that was renamed keeps its identity: look for a skill in this
      // repository whose current content is identical and whose old path no longer exists.
      let candidates = trx
        .selectFrom('skills as s')
        .innerJoin('skill_versions as v', 'v.id', 's.current_version_id')
        .selectAll('s')
        .where('s.repository_id', '=', input.repositoryId)
        .where('v.content_hash', '=', input.contentHash);
      // With the full listing we know which old paths are gone; without it, only skills
      // already marked removed qualify.
      candidates =
        input.presentPaths && input.presentPaths.length > 0
          ? candidates.where('s.path', 'not in', [...input.presentPaths])
          : candidates.where('s.status', '=', 'removed');
      const moved = await candidates.orderBy('s.id').executeTakeFirst();
      if (moved) {
        skill = moved;
        outcome = 'moved';
      }
    }

    const slugBase = `${input.repositoryFullName.toLowerCase()}/${slugSegment(input.name, input.directoryName)}`;
    const shared = {
      name: input.name.slice(0, 200),
      description: input.description.slice(0, 2000),
      license: input.license,
      compatibility_note: input.compatibilityNote,
      spec_valid: input.specValid ? (1 as const) : (0 as const),
      updated_at: nowIso,
    };

    let skillId: string;
    if (!skill) {
      skillId = newId(now);
      await trx
        .insertInto('skills')
        .values({
          id: skillId,
          repository_id: input.repositoryId,
          path: input.path,
          slug: await uniqueSlug(trx, slugBase, input.path, null),
          ...shared,
          first_indexed_at: nowIso,
          created_at: nowIso,
        })
        .execute();
      outcome = 'created';
    } else {
      skillId = skill.id;
      if (skill.status !== 'active' && outcome !== 'moved') outcome = 'restored';
      await trx
        .updateTable('skills')
        .set({
          ...shared,
          path: input.path,
          slug: await uniqueSlug(trx, slugBase, input.path, skillId),
          // An administrator's "hidden" decision survives re-indexing.
          status: skill.status === 'hidden' ? 'hidden' : 'active',
        })
        .where('id', '=', skillId)
        .execute();
    }

    // Versions are unique per (skill, content hash): a revert to earlier content reuses its row.
    let version = await trx
      .selectFrom('skill_versions')
      .select(['id'])
      .where('skill_id', '=', skillId)
      .where('content_hash', '=', input.contentHash)
      .executeTakeFirst();
    const isCurrent = Boolean(skill && version && skill.current_version_id === version.id);
    let needsScan = false;

    if (!version) {
      const versionId = newId(now);
      await trx
        .insertInto('skill_versions')
        .values({
          id: versionId,
          skill_id: skillId,
          commit_sha: input.commitSha,
          content_hash: input.contentHash,
          name: shared.name,
          description: shared.description,
          frontmatter_json: JSON.stringify(input.frontmatter).slice(0, 100_000),
          parse_errors_json: JSON.stringify(input.parseIssues),
          dependencies_json: JSON.stringify(input.dependencies),
          file_count: input.files.length,
          total_bytes: input.files.reduce((sum, f) => sum + f.sizeBytes, 0),
          has_scripts: input.files.some((f) => f.kind === 'script' || f.isExecutable) ? 1 : 0,
          has_binaries: input.files.some((f) => f.isBinary) ? 1 : 0,
          committed_at: input.committedAt,
          indexed_at: nowIso,
        })
        .execute();
      if (input.files.length > 0) {
        await trx
          .insertInto('skill_files')
          .values(
            input.files.map((file) => ({
              id: newId(now),
              version_id: versionId,
              path: file.path.slice(0, 500),
              blob_sha: file.blobSha,
              size_bytes: file.sizeBytes,
              kind: file.kind,
              is_executable: file.isExecutable ? (1 as const) : (0 as const),
              is_binary: file.isBinary ? (1 as const) : (0 as const),
              ...encodeFileContent(file.kind, file.content),
              truncated: file.truncated ? (1 as const) : (0 as const),
            })),
          )
          .execute();
      }
      version = { id: versionId };
      needsScan = true;
    }

    if (!isCurrent) {
      // The content the catalog points at has changed: whatever was verified before no
      // longer describes it. Close the current record and start the new version unverified.
      await trx
        .updateTable('verification_records')
        .set({ superseded_at: nowIso })
        .where('skill_id', '=', skillId)
        .where('superseded_at', 'is', null)
        .execute();
      await trx
        .insertInto('verification_records')
        .values({
          id: newId(now),
          skill_id: skillId,
          version_id: version.id,
          state: 'UNVERIFIED',
          reason: skill?.current_version_id ? 'CONTENT_CHANGED' : 'NEW_SKILL',
          policy_version: 'none',
          decided_by: 'system',
          valid_from: nowIso,
        })
        .execute();
      await trx
        .updateTable('skills')
        .set({
          current_version_id: version.id,
          verification_state: 'UNVERIFIED',
          lifecycle_state: 'PENDING',
          content_updated_at: input.committedAt ?? nowIso,
        })
        .where('id', '=', skillId)
        .execute();
      needsScan = true;
      if (outcome === 'unchanged') outcome = 'updated';
    }

    // Derived metadata is refreshed on every sync; curated category choices are kept.
    await trx.deleteFrom('agent_compatibility').where('skill_id', '=', skillId).execute();
    if (input.compatibility.length > 0) {
      await trx
        .insertInto('agent_compatibility')
        .values(
          input.compatibility.map((entry) => ({
            skill_id: skillId,
            agent_id: entry.agentId,
            level: entry.level,
            evidence: entry.evidence.slice(0, 500),
            warnings_json: JSON.stringify(entry.warnings),
            updated_at: nowIso,
          })),
        )
        .execute();
    }

    const curated = await trx
      .selectFrom('skill_categories')
      .select('skill_id')
      .where('skill_id', '=', skillId)
      .where('source', '=', 'curated')
      .executeTakeFirst();
    if (!curated && input.categorySlug) {
      const category = await trx
        .selectFrom('categories')
        .select('id')
        .where('slug', '=', input.categorySlug)
        .executeTakeFirst();
      await trx.deleteFrom('skill_categories').where('skill_id', '=', skillId).execute();
      if (category) {
        await trx
          .insertInto('skill_categories')
          .values({ skill_id: skillId, category_id: category.id, source: 'auto' })
          .execute();
      }
    }

    return { skillId, versionId: version.id, outcome, needsScan };
  });
}

/**
 * Marks active skills whose directory was not found in the latest complete listing as
 * removed. They stay in the database with their history. Returns how many were marked.
 */
export async function markSkillsRemoved(
  db: Db,
  repositoryId: string,
  presentPaths: readonly string[],
  now: Date,
): Promise<number> {
  let query = db
    .updateTable('skills')
    .set({ status: 'removed', updated_at: toIso(now) })
    .where('repository_id', '=', repositoryId)
    .where('status', '=', 'active');
  if (presentPaths.length > 0) query = query.where('path', 'not in', [...presentPaths]);
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Repositories due for a recrawl: least recently synced first. */
export async function listRepositoriesToRecrawl(
  db: Db,
  options: { olderThan: Date; limit: number },
): Promise<Array<{ id: string; owner: string; name: string; githubId: number }>> {
  const rows = await db
    .selectFrom('repositories')
    .select(['id', 'owner', 'name', 'github_id'])
    .where('status', 'in', ['active', 'archived', 'unreachable'])
    .where('github_id', '>', 0) // development fixtures use negative ids and are never synced
    .where((eb) =>
      eb.or([
        eb('last_synced_at', 'is', null),
        eb('last_synced_at', '<', toIso(options.olderThan)),
      ]),
    )
    .orderBy('last_synced_at', 'asc')
    .limit(options.limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    owner: r.owner,
    name: r.name,
    githubId: Number(r.github_id),
  }));
}

export async function findRepositoryByFullName(db: Db, fullName: string) {
  return db
    .selectFrom('repositories')
    .selectAll()
    .where('full_name_lower', '=', fullName.toLowerCase())
    .executeTakeFirst();
}

/**
 * Withdraws verification from every skill of a repository, for events that change who
 * controls the content (an ownership transfer). The skills become Unverified and are
 * queued for reassessment by the caller. Returns the affected skills.
 */
export async function revokeRepositoryVerifications(
  db: Kysely<Database>,
  repositoryId: string,
  reason: string,
  now: Date,
): Promise<Array<{ skillId: string; versionId: string }>> {
  const nowIso = toIso(now);
  return writeTransaction(db, async (trx) => {
    const skills = await trx
      .selectFrom('skills')
      .select(['id', 'current_version_id'])
      .where('repository_id', '=', repositoryId)
      .where('current_version_id', 'is not', null)
      .where('verification_state', '!=', 'UNVERIFIED')
      .execute();
    for (const skill of skills) {
      await trx
        .updateTable('verification_records')
        .set({ superseded_at: nowIso })
        .where('skill_id', '=', skill.id)
        .where('superseded_at', 'is', null)
        .execute();
      await trx
        .insertInto('verification_records')
        .values({
          id: newId(now),
          skill_id: skill.id,
          version_id: skill.current_version_id!,
          state: 'UNVERIFIED',
          reason,
          policy_version: 'none',
          decided_by: 'system',
          valid_from: nowIso,
        })
        .execute();
      await trx
        .updateTable('skills')
        .set({ verification_state: 'UNVERIFIED', lifecycle_state: 'PENDING', updated_at: nowIso })
        .where('id', '=', skill.id)
        .execute();
    }
    return skills.map((s) => ({ skillId: s.id, versionId: s.current_version_id! }));
  });
}
