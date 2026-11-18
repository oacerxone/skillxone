// Client components import this module, so it must not pull in the database package
// (only its types) or any Node-only code.
import type { SkillQuery } from '@skillxone/database';
import { SKILL_SORTS, VERIFICATION_STATES } from '@skillxone/shared/constants';
import type { SkillSort, VerificationState } from '@skillxone/shared/constants';

/**
 * The Explore page keeps all of its state in the URL. These helpers convert between the
 * query string and a validated filter object. Unknown or malformed values are ignored
 * rather than passed through, so a crafted URL cannot reach the database layer unchecked.
 */

export interface ExploreFilters {
  q: string;
  agent: string;
  verification: VerificationState | '';
  category: string;
  /** Empty means the default: best match when searching, recommended otherwise. */
  sort: SkillSort | '';
  /** Pro: minimum repository stars (0 = any). */
  minStars: number;
  /** Pro: exact licence. */
  license: string;
  /** Pro: only skills without scripts. */
  noScripts: boolean;
  /** Pro: content changed within this many days (0 = any time). */
  updatedDays: number;
  view: 'list' | 'cards';
  page: number;
}

export const STAR_OPTIONS = [0, 10, 100, 1000] as const;
export const UPDATED_OPTIONS = [0, 30, 90, 365] as const;
/** Sorts reserved for Pro when billing is enabled. */
export const PRO_SORTS: readonly SkillSort[] = ['rising', 'maintained'];

export const DEFAULT_FILTERS: ExploreFilters = {
  q: '',
  agent: '',
  verification: '',
  category: '',
  sort: '',
  minStars: 0,
  license: '',
  noScripts: false,
  updatedDays: 0,
  view: 'list',
  page: 1,
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,39}$/;
const oneOf = (allowed: readonly number[], raw: string) => {
  const value = Number.parseInt(raw, 10);
  return allowed.includes(value) ? value : 0;
};
const MAX_QUERY_LENGTH = 100;

export function parseExploreParams(raw: RawParams): ExploreFilters {
  const verification = first(raw.verification).toUpperCase();
  const sort = first(raw.sort);
  const page = Number.parseInt(first(raw.page), 10);
  const agent = first(raw.agent);
  const category = first(raw.category);
  return {
    q: first(raw.q).trim().slice(0, MAX_QUERY_LENGTH),
    agent: SLUG.test(agent) ? agent : '',
    verification: (VERIFICATION_STATES as readonly string[]).includes(verification)
      ? (verification as VerificationState)
      : '',
    category: SLUG.test(category) ? category : '',
    sort: (SKILL_SORTS as readonly string[]).includes(sort) ? (sort as SkillSort) : '',
    minStars: oneOf(STAR_OPTIONS, first(raw.stars)),
    license: LICENSE.test(first(raw.license)) ? first(raw.license) : '',
    noScripts: first(raw.scripts) === 'none',
    updatedDays: oneOf(UPDATED_OPTIONS, first(raw.updated)),
    view: first(raw.view) === 'cards' ? 'cards' : 'list',
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}

/** Builds a canonical query string; default values are omitted so URLs stay short. */
export function buildExploreQuery(
  filters: ExploreFilters,
  overrides: Partial<ExploreFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set('q', merged.q);
  if (merged.agent) params.set('agent', merged.agent);
  if (merged.verification) params.set('verification', merged.verification.toLowerCase());
  if (merged.category) params.set('category', merged.category);
  if (merged.sort) params.set('sort', merged.sort);
  if (merged.minStars) params.set('stars', String(merged.minStars));
  if (merged.license) params.set('license', merged.license);
  if (merged.noScripts) params.set('scripts', 'none');
  if (merged.updatedDays) params.set('updated', String(merged.updatedDays));
  if (merged.view !== DEFAULT_FILTERS.view) params.set('view', merged.view);
  if (merged.page > 1) params.set('page', String(merged.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** True when any Pro-only filter or sort is set. */
export function usesProFilters(filters: ExploreFilters): boolean {
  return Boolean(
    filters.agent ||
    filters.minStars ||
    filters.license ||
    filters.noScripts ||
    filters.updatedDays ||
    (filters.sort && PRO_SORTS.includes(filters.sort)),
  );
}

/**
 * Removes Pro-only filters. Applied before the query runs (and before the cache), so a
 * viewer without Pro can never receive results narrowed by them.
 */
export function stripProFilters(filters: ExploreFilters): ExploreFilters {
  return {
    ...filters,
    agent: '',
    minStars: 0,
    license: '',
    noScripts: false,
    updatedDays: 0,
    sort: filters.sort && PRO_SORTS.includes(filters.sort) ? '' : filters.sort,
  };
}

/** Start of the UTC day `days` ago, so equal filters share a cache entry for the whole day. */
function sinceDays(days: number, now: Date): string {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(start - days * 86_400_000).toISOString();
}

export function toSkillQuery(
  filters: ExploreFilters,
  pageSize: number,
  now: Date = new Date(),
): SkillQuery {
  return {
    minStars: filters.minStars || undefined,
    license: filters.license || undefined,
    noScripts: filters.noScripts || undefined,
    updatedSince: filters.updatedDays ? sinceDays(filters.updatedDays, now) : undefined,
    q: filters.q || undefined,
    agent: filters.agent || undefined,
    verification: filters.verification || undefined,
    category: filters.category || undefined,
    sort: filters.sort || undefined,
    page: filters.page,
    pageSize,
  };
}
