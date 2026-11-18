import {
  countActiveSkills,
  findRepositoryByFullName,
  hasBetterCopy,
  markSkillsRemoved,
  recordIngestionError,
  recordMetricsSnapshot,
  recordRepositoryMissing,
  repositoryHasActiveSkills,
  resolveIngestionErrors,
  revokeRepositoryVerifications,
  saveSkillSnapshot,
  setRepositoryHead,
  touchRepository,
  upsertRepository,
} from '@skillxone/database';
import type { DatabaseHandle, JobQueue, SkillFileInput } from '@skillxone/database';
import { GitHubError, NotFoundError, RateLimitError } from '@skillxone/github';
import type { GitHubClient, GitTreeItem, RepoRef } from '@skillxone/github';
import {
  computeContentHash,
  detectDependencyManifests,
  extractReferences,
  guessCategory,
  inferAgentCompatibility,
  locateSkills,
  parseSkillMd,
} from '@skillxone/skill-parser';
import type { SkillLocation, TreeEntry } from '@skillxone/skill-parser';
import { skillCapForStars } from '@skillxone/shared';

/**
 * Synchronises one repository: metadata, file listing, skills, versions.
 *
 * Cost model (API requests): unchanged metadata = 1 conditional request; changed metadata
 * but same commit = 2; new commit = 3 plus file downloads from the raw host, which do not
 * use the API quota. Nothing from the repository is executed; files are only read as data.
 */

export interface SyncLimits {
  maxFileBytes: number;
  maxSkillBytes: number;
  maxSkillsPerRepo: number;
  maxFilesPerSkill: number;
  downloadConcurrency: number;
  /**
   * New repositories are not indexed once the catalog holds this many active skills, so it
   * cannot outgrow the server. Repositories already in the catalog keep updating.
   */
  maxCatalogSkills: number;
}

export const DEFAULT_SYNC_LIMITS: SyncLimits = {
  maxFileBytes: 512 * 1024,
  maxSkillBytes: 5 * 1024 * 1024,
  maxSkillsPerRepo: 500,
  maxFilesPerSkill: 200,
  downloadConcurrency: 4,
  maxCatalogSkills: 60_000,
};

export interface SyncDeps {
  db: DatabaseHandle['db'];
  client: GitHubClient;
  queue: JobQueue;
  now: () => Date;
  limits?: Partial<SyncLimits>;
  /** Repository search lists only repositories with at least this many stars. */
  discoveryMinStars?: number;
  /** Repositories (`owner/name`) exempt from copy removal and caps: the curated seed list. */
  protectedRepositories?: readonly string[];
}

export interface SyncTarget extends RepoRef {
  source: string;
}

export type SyncStatus =
  'not_modified' | 'unchanged' | 'synced' | 'not_found' | 'missing' | 'deleted' | 'skipped';

export interface SyncSummary {
  repository: string;
  status: SyncStatus;
  detail?: string;
  skillsFound: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  errors: number;
  /** Skills not indexed because a more established copy is already in the catalog. */
  duplicates?: number;
  /** Skills beyond this repository's cap (see skillCapForStars). */
  overCap?: number;
}

const emptySummary = (repository: string, status: SyncStatus, detail?: string): SyncSummary => ({
  repository,
  status,
  detail,
  skillsFound: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  removed: 0,
  errors: 0,
});

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const toEntries = (items: readonly GitTreeItem[], prefix = ''): TreeEntry[] =>
  items
    .filter((item) => item.type === 'blob')
    .map((item) => ({
      path: `${prefix}${item.path}`,
      sha: item.sha,
      size: item.size ?? 0,
      mode: item.mode,
    }));

/**
 * Lists every file of a commit. GitHub truncates very large recursive listings; in that
 * case the top-level directories are listed one by one. `complete` is false if any part is
 * still truncated, and callers must then not treat an absent skill as deleted.
 */
async function listFiles(
  client: GitHubClient,
  ref: RepoRef,
  commitSha: string,
): Promise<{ entries: TreeEntry[]; complete: boolean }> {
  const tree = await client.getTree(ref, commitSha, true);
  if (!tree.truncated) return { entries: toEntries(tree.tree), complete: true };

  const root = await client.getTree(ref, commitSha, false);
  const entries = toEntries(root.tree);
  let complete = !root.truncated;
  const directories = root.tree.filter((item) => item.type === 'tree');
  const MAX_SUBTREES = 40;
  if (directories.length > MAX_SUBTREES) complete = false;
  for (const directory of directories.slice(0, MAX_SUBTREES)) {
    const subtree = await client.getTree(ref, directory.sha, true);
    if (subtree.truncated) complete = false;
    entries.push(...toEntries(subtree.tree, `${directory.path}/`));
  }
  return { entries, complete };
}

interface LoadedSkill {
  files: SkillFileInput[];
  skillMd: string | null;
  contentHash: string;
  hashLockCompatible: boolean;
  problems: Array<{ code: string; path: string; message: string }>;
}

/** Downloads a skill's files at the commit, within the size limits. */
async function loadSkillFiles(
  client: GitHubClient,
  ref: RepoRef,
  commitSha: string,
  location: SkillLocation,
  limits: SyncLimits,
): Promise<LoadedSkill> {
  const problems: LoadedSkill['problems'] = [];
  let budget = limits.maxSkillBytes;
  let hashLockCompatible = !location.truncated;

  const loaded = await mapLimit(location.files, limits.downloadConcurrency, async (file) => {
    const repoPath = location.directory
      ? `${location.directory}/${file.relativePath}`
      : file.relativePath;
    const base = {
      path: file.relativePath,
      blobSha: file.sha,
      sizeBytes: file.size,
      kind: file.kind,
      isExecutable: file.isExecutable,
      isBinary: file.isBinary,
    };
    // Symlinks are not followed, and files beyond the limits are not downloaded. Their Git
    // blob id still feeds the hash below, so any change to them is detected.
    const tooLarge = file.size > limits.maxFileBytes || file.size > budget;
    if (file.isSymlink || tooLarge) {
      return { input: { ...base, content: null, truncated: tooLarge }, bytes: null };
    }
    budget -= file.size;
    try {
      const { content, truncated } = await client.fetchRawFile(
        ref,
        commitSha,
        repoPath,
        limits.maxFileBytes,
      );
      const binary = file.isBinary || content.includes(0);
      return {
        input: {
          ...base,
          isBinary: binary,
          kind: binary && file.kind !== 'skill_md' ? ('binary' as const) : file.kind,
          content: binary ? null : new TextDecoder('utf-8').decode(content),
          truncated,
        },
        bytes: truncated ? null : content,
      };
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      const code = error instanceof GitHubError ? error.code : 'DOWNLOAD_FAILED';
      problems.push({
        code: 'FILE_DOWNLOAD_FAILED',
        path: repoPath,
        message: `Could not download file (${code}).`,
      });
      return { input: { ...base, content: null, truncated: true }, bytes: null };
    }
  });

  // Hash the exact bytes where we have them. Where we do not (symlink, oversized, failed),
  // substitute the Git blob id so the hash still changes when the file does, and record that
  // this hash cannot be compared with a skills-lock.json entry.
  const hashable = loaded.map(({ input, bytes }) => {
    if (bytes) return { path: input.path, content: bytes };
    hashLockCompatible = false;
    return { path: input.path, content: new TextEncoder().encode(`git-blob:${input.blobSha}`) };
  });

  const skillMd = loaded.find(({ input }) => input.kind === 'skill_md')?.input.content ?? null;
  return {
    files: loaded.map(({ input }) => input),
    skillMd,
    contentHash: computeContentHash(hashable),
    hashLockCompatible,
    problems,
  };
}

export async function syncRepository(
  deps: SyncDeps,
  target: SyncTarget,
  jobId?: string,
): Promise<SyncSummary> {
  const { db, client, queue } = deps;
  const limits: SyncLimits = { ...DEFAULT_SYNC_LIMITS, ...deps.limits };
  const requested = `${target.owner}/${target.repo}`;
  const existing = await findRepositoryByFullName(db, requested);

  if (existing?.status === 'disabled') {
    return emptySummary(requested, 'skipped', 'Repository is disabled by an administrator.');
  }

  // 1. Metadata, conditionally.
  let meta;
  try {
    meta = await client.getRepo(target, existing?.etag);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    const now = deps.now();
    if (!existing) {
      await recordIngestionError(db, {
        jobId,
        code: 'NOT_FOUND',
        path: requested,
        message: `Repository ${requested} was not found.`,
        now,
      });
      return emptySummary(requested, 'not_found');
    }
    const state = await recordRepositoryMissing(db, existing.id, now);
    await recordIngestionError(db, {
      repositoryId: existing.id,
      jobId,
      code: 'NOT_FOUND',
      message:
        state === 'deleted'
          ? 'Repository not found twice in a row; marked deleted.'
          : 'Repository not found; will retry once before marking it deleted.',
      now,
    });
    return emptySummary(requested, state);
  }

  if (!meta.modified || !meta.data) {
    if (existing) await touchRepository(db, existing.id, deps.now());
    return emptySummary(requested, 'not_modified');
  }
  const data = meta.data;
  if (data.private) {
    await recordIngestionError(db, {
      repositoryId: existing?.id,
      jobId,
      code: 'PRIVATE',
      path: requested,
      message: 'Repository is private and is not indexed.',
      now: deps.now(),
    });
    return emptySummary(requested, 'skipped', 'private');
  }

  // GitHub follows renames and transfers by redirect, so use the names it returned.
  const ref: RepoRef = { owner: data.owner.login, repo: data.name };
  const fullName = `${ref.owner}/${ref.repo}`;
  const now = deps.now();
  const repo = await upsertRepository(
    db,
    {
      githubId: data.id,
      owner: ref.owner,
      name: ref.repo,
      ownerGithubId: data.owner.id,
      ownerType:
        data.owner.type === 'Organization'
          ? 'Organization'
          : data.owner.type === 'User'
            ? 'User'
            : null,
      description: data.description,
      homepageUrl: data.homepage,
      defaultBranch: data.default_branch,
      licenseSpdx:
        data.license?.spdx_id && data.license.spdx_id !== 'NOASSERTION'
          ? data.license.spdx_id
          : null,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      isArchived: data.archived,
      isFork: data.fork,
      pushedAt: data.pushed_at,
      githubCreatedAt: data.created_at,
      etag: meta.etag,
    },
    target.source,
    now,
  );
  await recordMetricsSnapshot(
    db,
    repo.id,
    {
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      pushedAt: data.pushed_at,
    },
    now,
  );

  const enqueueScan = (skillId: string, versionId: string) =>
    queue.enqueue('scan_skill', { skillId, versionId }, { dedupeKey: `scan:${versionId}` });

  if (repo.ownerChanged) {
    // A new owner controls the content now: earlier verification no longer stands.
    const revoked = await revokeRepositoryVerifications(db, repo.id, 'OWNER_CHANGED', now);
    for (const item of revoked) await enqueueScan(item.skillId, item.versionId);
    await recordIngestionError(db, {
      repositoryId: repo.id,
      jobId,
      code: 'OWNER_CHANGED',
      message: `Repository ownership changed (was ${repo.renamedFrom ?? 'unknown'}). Verification was withdrawn pending reassessment.`,
      now,
    });
  }

  // 2. Has the code changed?
  let head: string;
  try {
    head = await client.getBranchHead(ref, data.default_branch);
  } catch (error) {
    if (
      error instanceof GitHubError &&
      (error.code === 'EMPTY_REPOSITORY' || error.code === 'NOT_FOUND')
    ) {
      const removed = await markSkillsRemoved(db, repo.id, [], now);
      return {
        ...emptySummary(fullName, 'synced', 'Repository has no commits on its default branch.'),
        removed,
      };
    }
    throw error;
  }
  if (head === repo.previousHeadSha) return emptySummary(fullName, 'unchanged');

  // Catalog size guard: a repository with no skills yet waits while the catalog is full.
  if (
    !(await repositoryHasActiveSkills(db, repo.id)) &&
    (await countActiveSkills(db)) >= limits.maxCatalogSkills
  ) {
    await recordIngestionError(db, {
      repositoryId: repo.id,
      jobId,
      code: 'CATALOG_FULL',
      message: `The catalog holds ${limits.maxCatalogSkills} skills, its configured maximum; new repositories wait.`,
      now,
    });
    return emptySummary(fullName, 'skipped', 'catalog full');
  }

  // 3. List files and find skills.
  const { entries, complete } = await listFiles(client, ref, head);
  const summary = emptySummary(fullName, 'synced');
  if (!complete) {
    summary.errors += 1;
    await recordIngestionError(db, {
      repositoryId: repo.id,
      jobId,
      code: 'TREE_TRUNCATED',
      message:
        'The file listing is too large and was truncated by GitHub; some skills may be missing.',
      now,
    });
  }
  const locations = locateSkills(entries, {
    repositoryName: ref.repo,
    maxSkills: limits.maxSkillsPerRepo,
    maxFilesPerSkill: limits.maxFilesPerSkill,
  });
  summary.skillsFound = locations.length;

  const protectedNames = (deps.protectedRepositories ?? []).map((name) => name.toLowerCase());
  const isProtected = protectedNames.includes(fullName.toLowerCase());
  const cap = isProtected
    ? limits.maxSkillsPerRepo
    : skillCapForStars(data.stargazers_count, limits.maxSkillsPerRepo);
  // Paths kept in the catalog; anything else that was active is marked removed below.
  const presentPaths: string[] = [];
  const locatedPaths = locations.map((location) => location.directory);
  for (const [index, location] of locations.entries()) {
    if (presentPaths.length >= cap) {
      summary.overCap = locations.length - index;
      break;
    }
    const loaded = await loadSkillFiles(client, ref, head, location, limits);
    for (const problem of loaded.problems) {
      summary.errors += 1;
      await recordIngestionError(db, { repositoryId: repo.id, jobId, ...problem, now });
    }
    if (loaded.skillMd === null) {
      summary.errors += 1;
      await recordIngestionError(db, {
        repositoryId: repo.id,
        jobId,
        code: 'SKILL_MD_UNREADABLE',
        path: location.directory || '.',
        message: 'SKILL.md could not be read as text; the skill was not updated.',
        now,
      });
      presentPaths.push(location.directory);
      continue;
    }

    // An identical copy that ranks ahead (protected, more stars, indexed first) wins.
    if (
      !isProtected &&
      (await hasBetterCopy(
        db,
        {
          contentHash: loaded.contentHash,
          repositoryId: repo.id,
          path: location.directory,
          stars: data.stargazers_count,
          isProtected,
          presentPaths: locatedPaths,
        },
        deps.protectedRepositories ?? [],
      ))
    ) {
      summary.duplicates = (summary.duplicates ?? 0) + 1;
      continue;
    }
    presentPaths.push(location.directory);

    const parsed = parseSkillMd(loaded.skillMd, location.directoryName);
    const issues: unknown[] = [...parsed.issues];
    if (!loaded.hashLockCompatible) {
      issues.push({
        code: 'HASH_NOT_LOCK_COMPATIBLE',
        level: 'warning',
        message:
          'Some files were not downloaded, so the content hash cannot be compared with a skills-lock.json entry.',
      });
    }
    if (location.truncated) {
      issues.push({
        code: 'FILE_LIST_TRUNCATED',
        level: 'warning',
        message: `Only the first ${limits.maxFilesPerSkill} files were indexed.`,
      });
    }
    for (const reference of extractReferences(parsed.body, location.files)) {
      if (!reference.exists)
        issues.push({
          code: 'BROKEN_REFERENCE',
          level: 'warning',
          message: `SKILL.md links to "${reference.path.slice(0, 200)}", which is not in the skill directory.`,
        });
    }
    const result = await saveSkillSnapshot(
      db,
      {
        repositoryId: repo.id,
        repositoryFullName: fullName,
        path: location.directory,
        directoryName: location.directoryName,
        name: parsed.name,
        description: parsed.description,
        license:
          parsed.license ??
          (data.license?.spdx_id && data.license.spdx_id !== 'NOASSERTION'
            ? data.license.spdx_id
            : null),
        compatibilityNote: parsed.compatibility,
        specValid: parsed.specValid,
        frontmatter: parsed.frontmatter,
        parseIssues: issues,
        dependencies: detectDependencyManifests(location.files),
        commitSha: head,
        contentHash: loaded.contentHash,
        // The exact commit time of a skill's files is not fetched (it would cost a request
        // per skill). The repository's last push is the latest moment it could have changed.
        committedAt: data.pushed_at,
        files: loaded.files,
        categorySlug: guessCategory(parsed.name, parsed.description),
        // Every located path, not only those kept so far: used to recognise renames.
        presentPaths: complete ? locatedPaths : undefined,
        compatibility: inferAgentCompatibility(location.directory, parsed, location.files),
      },
      now,
    );
    if (result.outcome === 'created') summary.created += 1;
    else if (result.outcome === 'unchanged') summary.unchanged += 1;
    else summary.updated += 1;
    if (result.needsScan) await enqueueScan(result.skillId, result.versionId);
  }

  // 4. Skills that disappeared. Only trusted when the listing was complete.
  if (complete) summary.removed = await markSkillsRemoved(db, repo.id, presentPaths, now);

  // Search and ranking are derived from what was just stored; refresh them in the background.
  if (summary.created + summary.updated + summary.removed > 0 || repo.renamedFrom) {
    await queue.enqueue('index_repo', { repositoryId: repo.id }, { dedupeKey: `index:${repo.id}` });
    await queue.enqueue('rank', {}, { dedupeKey: 'rank' });
  }

  // Remember the commit only after a clean pass, so a partial failure is retried next time.
  if (summary.errors === 0) {
    await setRepositoryHead(db, repo.id, head, now);
    await resolveIngestionErrors(db, repo.id, now);
  }
  return summary;
}
