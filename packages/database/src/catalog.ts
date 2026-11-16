import { sql } from 'kysely';
import type { Kysely, Selectable } from 'kysely';
import { DEV_FIXTURE_SOURCE } from '@skillxone/shared';
import type { LifecycleState, SkillSort, VerificationState } from '@skillxone/shared';
import type {
  Database,
  SecurityFindingsTable,
  SecurityScansTable,
  SkillFilesTable,
  VerificationRecordsTable,
} from './types';

/**
 * Read queries for the public catalog. The web app and the static build both go through
 * this module, so pages never contain SQL.
 *
 * Text matching here is a simple case-insensitive substring match over name, description
 * and repository. Ranked full-text search replaces it in Phase 4 (`packages/search`).
 */

type Db = Kysely<Database>;

export type { SkillSort };

export interface SkillQuery {
  q?: string;
  agent?: string;
  verification?: VerificationState;
  category?: string;
  sort?: SkillSort;
  /**
   * Restrict results to these skill ids. With `sort: 'relevance'` the order of this list
   * is the result order (it comes from the search backend, best match first).
   */
  restrictToIds?: readonly string[];
  /** Skip the built-in substring match on `q` (the search backend already matched it). */
  textMatched?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SkillListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  stars: number;
  license: string | null;
  updatedAt: string | null;
  firstIndexedAt: string;
  verificationState: VerificationState;
  lifecycleState: LifecycleState;
  repositoryArchived: boolean;
  /** Agent ids the skill is compatible with, sorted. */
  agents: string[];
  /** Quality score 0..1, or null before the first ranking run. */
  quality: number | null;
}

export interface SkillPage {
  items: SkillListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 30;
const MAX_QUERY_TERMS = 8;

/** Splits a search string into lowercase terms, bounded so a query cannot grow unreasonably. */
export function searchTerms(q: string | undefined): string[] {
  if (!q) return [];
  return q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_QUERY_TERMS);
}

/** Escapes LIKE wildcards so user input always matches literally. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function baseQuery(db: Db, query: SkillQuery) {
  let qb = db
    .selectFrom('skills as s')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .leftJoin('ranking_scores as rs', 'rs.skill_id', 's.id')
    .where('s.status', '=', 'active')
    .where('r.status', 'in', ['active', 'archived']);

  if (query.restrictToIds) {
    // An empty list must match nothing; `in ()` is not valid SQL.
    qb =
      query.restrictToIds.length > 0
        ? qb.where('s.id', 'in', [...query.restrictToIds])
        : qb.where(sql<boolean>`1 = 0`);
  }

  if (query.verification) qb = qb.where('s.verification_state', '=', query.verification);

  if (query.category) {
    const category = query.category;
    qb = qb.where((eb) =>
      eb.exists(
        eb
          .selectFrom('skill_categories as sc')
          .innerJoin('categories as c', 'c.id', 'sc.category_id')
          .select('sc.skill_id')
          .whereRef('sc.skill_id', '=', 's.id')
          .where('c.slug', '=', category),
      ),
    );
  }

  if (query.agent) {
    const agent = query.agent;
    qb = qb.where((eb) =>
      eb.exists(
        eb
          .selectFrom('agent_compatibility as ac')
          .select('ac.skill_id')
          .whereRef('ac.skill_id', '=', 's.id')
          .where('ac.agent_id', '=', agent)
          .where('ac.level', '!=', 'unsupported'),
      ),
    );
  }

  for (const term of query.textMatched ? [] : searchTerms(query.q)) {
    const pattern = likePattern(term);
    // Every term must match at least one field. Values are bound parameters.
    qb = qb.where(
      sql<boolean>`(lower(s.name) like ${pattern} escape '\\' or lower(s.description) like ${pattern} escape '\\' or r.full_name_lower like ${pattern} escape '\\')`,
    );
  }

  return qb;
}

const itemColumns = [
  's.id as id',
  's.slug as slug',
  's.name as name',
  's.description as description',
  's.curated_description as curated_description',
  's.license as license',
  's.content_updated_at as content_updated_at',
  's.first_indexed_at as first_indexed_at',
  's.verification_state as verification_state',
  's.lifecycle_state as lifecycle_state',
  'r.owner as owner',
  'r.name as repo',
  'r.stars as stars',
  'r.is_archived as is_archived',
  'rs.quality_score as quality_score',
] as const;

interface ItemRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  curated_description: string | null;
  license: string | null;
  content_updated_at: string | null;
  first_indexed_at: string;
  verification_state: VerificationState;
  lifecycle_state: LifecycleState;
  owner: string;
  repo: string;
  stars: number;
  is_archived: number;
  quality_score: number | null;
}

async function agentsBySkill(db: Db, skillIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (skillIds.length === 0) return map;
  const rows = await db
    .selectFrom('agent_compatibility')
    .select(['skill_id', 'agent_id'])
    .where('skill_id', 'in', skillIds)
    .where('level', '!=', 'unsupported')
    .orderBy('agent_id')
    .execute();
  for (const row of rows) {
    const list = map.get(row.skill_id) ?? [];
    list.push(row.agent_id);
    map.set(row.skill_id, list);
  }
  return map;
}

async function toItems(db: Db, rows: ItemRow[]): Promise<SkillListItem[]> {
  const agents = await agentsBySkill(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.curated_description ?? row.description,
    owner: row.owner,
    repo: row.repo,
    stars: Number(row.stars),
    license: row.license,
    updatedAt: row.content_updated_at,
    firstIndexedAt: row.first_indexed_at,
    verificationState: row.verification_state,
    lifecycleState: row.lifecycle_state,
    repositoryArchived: row.is_archived === 1,
    agents: agents.get(row.id) ?? [],
    quality: row.quality_score === null ? null : Number(row.quality_score),
  }));
}

export async function listSkills(db: Db, query: SkillQuery = {}): Promise<SkillPage> {
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const requestedPage = Math.max(1, Math.trunc(query.page ?? 1));
  const sort: SkillSort = query.sort ?? (query.restrictToIds ? 'relevance' : 'recommended');

  if (sort === 'relevance' && query.restrictToIds) {
    // The search backend supplied the order. Apply the filters in SQL, keep that order here.
    const matching = await baseQuery(db, query).select('s.id as id').execute();
    const allowed = new Set(matching.map((row) => row.id));
    const ordered = query.restrictToIds.filter((id) => allowed.has(id));
    const total = ordered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const pageIds = ordered.slice((page - 1) * pageSize, page * pageSize);
    const items = await listSkillsByIds(db, pageIds);
    return { items, total, page, pageSize, pageCount };
  }

  const countRow = await baseQuery(db, query)
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  const total = Number(countRow.n);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);

  let qb = baseQuery(db, query).select(itemColumns);
  // Skills without a ranking row yet sort after ranked ones (coalesce to -1).
  const ranked = (
    column: 'quality_score' | 'trending_score' | 'rising_score' | 'maintenance_score',
  ) => sql<number>`coalesce(${sql.ref(`rs.${column}`)}, -1)`;
  switch (sort) {
    case 'popular':
      qb = qb.orderBy('r.stars', 'desc');
      break;
    case 'trending':
      qb = qb.orderBy(ranked('trending_score'), 'desc').orderBy(ranked('quality_score'), 'desc');
      break;
    case 'rising':
      qb = qb.orderBy(ranked('rising_score'), 'desc').orderBy(ranked('quality_score'), 'desc');
      break;
    case 'maintained':
      qb = qb.orderBy(ranked('maintenance_score'), 'desc').orderBy(ranked('quality_score'), 'desc');
      break;
    case 'updated':
      qb = qb.orderBy('s.content_updated_at', 'desc');
      break;
    case 'newest':
      qb = qb.orderBy('s.first_indexed_at', 'desc');
      break;
    case 'name':
      qb = qb.orderBy('s.name', 'asc');
      break;
    default:
      // 'recommended', and 'relevance' without a search: quality first, stars as a tie-break.
      qb = qb.orderBy(ranked('quality_score'), 'desc').orderBy('r.stars', 'desc');
  }
  // The id tie-break keeps pagination stable when sort values are equal.
  const rows = await qb
    .orderBy('s.id', 'asc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();

  return { items: await toItems(db, rows), total, page, pageSize, pageCount };
}

/** Skills by id, returned in the order of `ids`. Unknown or inactive ids are skipped. */
export async function listSkillsByIds(db: Db, ids: readonly string[]): Promise<SkillListItem[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom('skills as s')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .leftJoin('ranking_scores as rs', 'rs.skill_id', 's.id')
    .select(itemColumns)
    .where('s.status', '=', 'active')
    .where('s.id', 'in', [...ids])
    .execute();
  const byId = new Map((await toItems(db, rows)).map((item) => [item.id, item]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export interface CategorySummary {
  slug: string;
  name: string;
  description: string | null;
  skillCount: number;
}

export async function listCategories(db: Db): Promise<CategorySummary[]> {
  const rows = await db
    .selectFrom('categories as c')
    .select((eb) => [
      'c.slug',
      'c.name',
      'c.description',
      eb
        .selectFrom('skill_categories as sc')
        .innerJoin('skills as s', 's.id', 'sc.skill_id')
        .select((sub) => sub.fn.countAll<number>().as('n'))
        .whereRef('sc.category_id', '=', 'c.id')
        .where('s.status', '=', 'active')
        .as('skill_count'),
    ])
    .orderBy('c.sort_order')
    .execute();
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    skillCount: Number(row.skill_count ?? 0),
  }));
}

export async function getCategory(db: Db, slug: string): Promise<CategorySummary | undefined> {
  return (await listCategories(db)).find((c) => c.slug === slug);
}

export interface CollectionSummary {
  slug: string;
  title: string;
  description: string | null;
  skillCount: number;
}

export async function listCollections(db: Db): Promise<CollectionSummary[]> {
  const rows = await db
    .selectFrom('collections as c')
    .select((eb) => [
      'c.slug',
      'c.title',
      'c.description',
      eb
        .selectFrom('collection_skills as cs')
        .innerJoin('skills as s', 's.id', 'cs.skill_id')
        .select((sub) => sub.fn.countAll<number>().as('n'))
        .whereRef('cs.collection_id', '=', 'c.id')
        .where('s.status', '=', 'active')
        .as('skill_count'),
    ])
    .where('c.is_published', '=', 1)
    .orderBy('c.title')
    .execute();
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    description: row.description,
    skillCount: Number(row.skill_count ?? 0),
  }));
}

export interface CollectionDetail extends CollectionSummary {
  skills: Array<SkillListItem & { note: string | null }>;
}

export async function getCollection(db: Db, slug: string): Promise<CollectionDetail | undefined> {
  const summary = (await listCollections(db)).find((c) => c.slug === slug);
  if (!summary) return undefined;
  const rows = await db
    .selectFrom('collection_skills as cs')
    .innerJoin('collections as c', 'c.id', 'cs.collection_id')
    .innerJoin('skills as s', 's.id', 'cs.skill_id')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .leftJoin('ranking_scores as rs', 'rs.skill_id', 's.id')
    .select([...itemColumns, 'cs.note as note'])
    .where('c.slug', '=', slug)
    .where('s.status', '=', 'active')
    .orderBy('cs.position')
    .execute();
  const items = await toItems(db, rows);
  return {
    ...summary,
    skills: items.map((item, index) => ({ ...item, note: rows[index]?.note ?? null })),
  };
}

export type SkillFileSummary = Pick<
  Selectable<SkillFilesTable>,
  'path' | 'kind' | 'size_bytes' | 'is_executable' | 'is_binary' | 'truncated'
>;

export interface SkillVersionSummary {
  id: string;
  commitSha: string;
  contentHash: string;
  indexedAt: string;
  committedAt: string | null;
  fileCount: number;
  totalBytes: number;
  isCurrent: boolean;
}

export interface SecurityReport {
  scan: Selectable<SecurityScansTable>;
  findings: Array<Selectable<SecurityFindingsTable>>;
  checksRun: Array<{ scanner: string; version?: string }>;
  checksSkipped: Array<{ scanner: string; reason: string }>;
}

export interface SkillDetail extends SkillListItem {
  path: string;
  repository: {
    id: string;
    fullName: string;
    description: string | null;
    defaultBranch: string | null;
    forks: number;
    openIssues: number;
    pushedAt: string | null;
    license: string | null;
    isFixture: boolean;
  };
  categories: Array<{ slug: string; name: string }>;
  compatibility: Array<{ agentId: string; level: string; evidence: string | null }>;
  currentVersion: SkillVersionSummary | null;
  versions: SkillVersionSummary[];
  files: SkillFileSummary[];
  /** Raw SKILL.md text of the current version. Untrusted: sanitise before rendering. */
  skillMarkdown: string | null;
  dependencies: unknown[];
  report: SecurityReport | null;
  verification: Selectable<VerificationRecordsTable> | null;
  verificationHistory: Array<Selectable<VerificationRecordsTable>>;
  /** Per-signal ranking breakdown, or null before the first ranking run. */
  ranking: {
    computedAt: string | null;
    signals: Record<string, { value: number; weight: number; explanation: string }>;
    adjustments: string[];
  } | null;
}

function parseJsonArray<T>(text: string | null | undefined): T[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function parseRanking(json: string | null, computedAt: string | null): SkillDetail['ranking'] {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { signals?: unknown; adjustments?: unknown };
    if (!parsed.signals || typeof parsed.signals !== 'object') return null;
    return {
      computedAt,
      signals: parsed.signals as NonNullable<SkillDetail['ranking']>['signals'],
      adjustments: Array.isArray(parsed.adjustments)
        ? parsed.adjustments.filter((a): a is string => typeof a === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

export async function getSkillBySlug(db: Db, slug: string): Promise<SkillDetail | undefined> {
  const row = await db
    .selectFrom('skills as s')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .leftJoin('ranking_scores as rs', 'rs.skill_id', 's.id')
    .select([
      ...itemColumns,
      's.path as path',
      's.repository_id as repository_id',
      'rs.signals_json as signals_json',
      'rs.computed_at as ranking_computed_at',
      's.current_version_id as current_version_id',
      'r.description as repo_description',
      'r.default_branch as default_branch',
      'r.forks as forks',
      'r.open_issues as open_issues',
      'r.pushed_at as pushed_at',
      'r.license_spdx as license_spdx',
      'r.discovery_source as discovery_source',
    ])
    .where('s.slug', '=', slug)
    .where('s.status', '=', 'active')
    .executeTakeFirst();
  if (!row) return undefined;

  const [item] = await toItems(db, [row]);
  if (!item) return undefined;

  const versionRows = await db
    .selectFrom('skill_versions')
    .selectAll()
    .where('skill_id', '=', row.id)
    .orderBy('indexed_at', 'desc')
    .execute();
  const versions: SkillVersionSummary[] = versionRows.map((v) => ({
    id: v.id,
    commitSha: v.commit_sha,
    contentHash: v.content_hash,
    indexedAt: v.indexed_at,
    committedAt: v.committed_at,
    fileCount: v.file_count,
    totalBytes: v.total_bytes,
    isCurrent: v.id === row.current_version_id,
  }));
  const currentRow = versionRows.find((v) => v.id === row.current_version_id);
  const currentVersion = versions.find((v) => v.isCurrent) ?? null;

  let files: SkillFileSummary[] = [];
  let skillMarkdown: string | null = null;
  let report: SecurityReport | null = null;
  if (currentRow) {
    files = await db
      .selectFrom('skill_files')
      .select(['path', 'kind', 'size_bytes', 'is_executable', 'is_binary', 'truncated'])
      .where('version_id', '=', currentRow.id)
      .orderBy('path')
      .execute();
    const md = await db
      .selectFrom('skill_files')
      .select('content')
      .where('version_id', '=', currentRow.id)
      .where('kind', '=', 'skill_md')
      .executeTakeFirst();
    skillMarkdown = md?.content ?? null;

    const scan = await db
      .selectFrom('security_scans')
      .selectAll()
      .where('version_id', '=', currentRow.id)
      .where('status', '=', 'COMPLETE')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (scan) {
      const findings = await db
        .selectFrom('security_findings')
        .selectAll()
        .where('scan_id', '=', scan.id)
        .execute();
      report = {
        scan,
        findings,
        checksRun: parseJsonArray(scan.checks_run_json),
        checksSkipped: parseJsonArray(scan.checks_skipped_json),
      };
    }
  }

  const categories = await db
    .selectFrom('skill_categories as sc')
    .innerJoin('categories as c', 'c.id', 'sc.category_id')
    .select(['c.slug', 'c.name'])
    .where('sc.skill_id', '=', row.id)
    .orderBy('c.sort_order')
    .execute();

  const compatibility = await db
    .selectFrom('agent_compatibility')
    .select(['agent_id', 'level', 'evidence'])
    .where('skill_id', '=', row.id)
    .orderBy('agent_id')
    .execute();

  const verificationHistory = await db
    .selectFrom('verification_records')
    .selectAll()
    .where('skill_id', '=', row.id)
    .orderBy('valid_from', 'desc')
    .execute();

  return {
    ...item,
    path: row.path,
    repository: {
      id: row.repository_id,
      fullName: `${row.owner}/${row.repo}`,
      description: row.repo_description,
      defaultBranch: row.default_branch,
      forks: Number(row.forks),
      openIssues: Number(row.open_issues),
      pushedAt: row.pushed_at,
      license: row.license_spdx,
      isFixture: row.discovery_source === DEV_FIXTURE_SOURCE,
    },
    categories,
    compatibility: compatibility.map((c) => ({
      agentId: c.agent_id,
      level: c.level,
      evidence: c.evidence,
    })),
    currentVersion,
    versions,
    files,
    skillMarkdown,
    dependencies: parseJsonArray(currentRow?.dependencies_json),
    report,
    verification: verificationHistory.find((v) => v.superseded_at === null) ?? null,
    verificationHistory,
    ranking: parseRanking(row.signals_json, row.ranking_computed_at),
  };
}

/** Text content of one file of the skill's current version, or undefined if not stored. */
export async function getSkillFile(
  db: Db,
  slug: string,
  path: string,
): Promise<{ path: string; content: string | null; kind: string; sizeBytes: number } | undefined> {
  const row = await db
    .selectFrom('skill_files as f')
    .innerJoin('skills as s', 's.current_version_id', 'f.version_id')
    .select(['f.path', 'f.content', 'f.kind', 'f.size_bytes'])
    .where('s.slug', '=', slug)
    .where('s.status', '=', 'active')
    .where('f.path', '=', path)
    .executeTakeFirst();
  if (!row) return undefined;
  return { path: row.path, content: row.content, kind: row.kind, sizeBytes: row.size_bytes };
}

/** Other active skills in the same categories, most starred first. Flagged skills are excluded. */
export async function listRelatedSkills(
  db: Db,
  skillId: string,
  limit = 4,
): Promise<SkillListItem[]> {
  const rows = await db
    .selectFrom('skills as s')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .leftJoin('ranking_scores as rs', 'rs.skill_id', 's.id')
    .select(itemColumns)
    .where('s.status', '=', 'active')
    .where('s.id', '!=', skillId)
    .where('s.verification_state', '!=', 'FLAGGED')
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('skill_categories as mine')
          .innerJoin('skill_categories as theirs', 'theirs.category_id', 'mine.category_id')
          .select('mine.skill_id')
          .where('mine.skill_id', '=', skillId)
          .whereRef('theirs.skill_id', '=', 's.id'),
      ),
    )
    .orderBy('r.stars', 'desc')
    .orderBy('s.id')
    .limit(limit)
    .execute();
  return toItems(db, rows);
}

/** Distinct agent ids present in the catalog, for filter controls. */
export async function listAgentIds(db: Db): Promise<string[]> {
  const rows = await db
    .selectFrom('agent_compatibility')
    .select('agent_id')
    .distinct()
    .where('level', '!=', 'unsupported')
    .orderBy('agent_id')
    .execute();
  return rows.map((r) => r.agent_id);
}

/**
 * Number of distinct days of stored metrics. Trend views need real history
 * (ADR-008); until enough exists they show a labelled fallback ordering.
 */
export async function metricsHistoryDays(db: Db): Promise<number> {
  const row = await db
    .selectFrom('github_metrics_history')
    .select((eb) => eb.fn.count<number>('captured_on').distinct().as('n'))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Slug of an active skill by its id, for id-based API routes. */
export async function getSkillSlugById(db: Db, id: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('skills')
    .select('slug')
    .where('id', '=', id)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return row?.slug;
}

export interface RepositorySummary {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  homepageUrl: string | null;
  defaultBranch: string | null;
  license: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  archived: boolean;
  pushedAt: string | null;
  lastSyncedAt: string | null;
  skillCount: number;
}

/** Public facts about an indexed repository. Internal fields (etag, errors) are not exposed. */
export async function getRepositorySummary(
  db: Db,
  id: string,
): Promise<RepositorySummary | undefined> {
  const row = await db
    .selectFrom('repositories as r')
    .select((eb) => [
      'r.id',
      'r.owner',
      'r.name',
      'r.description',
      'r.homepage_url',
      'r.default_branch',
      'r.license_spdx',
      'r.stars',
      'r.forks',
      'r.open_issues',
      'r.is_archived',
      'r.pushed_at',
      'r.last_synced_at',
      eb
        .selectFrom('skills as s')
        .select((sub) => sub.fn.countAll<number>().as('n'))
        .whereRef('s.repository_id', '=', 'r.id')
        .where('s.status', '=', 'active')
        .as('skill_count'),
    ])
    .where('r.id', '=', id)
    .where('r.status', 'in', ['active', 'archived'])
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    id: row.id,
    fullName: `${row.owner}/${row.name}`,
    owner: row.owner,
    name: row.name,
    description: row.description,
    homepageUrl: row.homepage_url,
    defaultBranch: row.default_branch,
    license: row.license_spdx,
    stars: Number(row.stars),
    forks: Number(row.forks),
    openIssues: Number(row.open_issues),
    archived: row.is_archived === 1,
    pushedAt: row.pushed_at,
    lastSyncedAt: row.last_synced_at,
    skillCount: Number(row.skill_count ?? 0),
  };
}
