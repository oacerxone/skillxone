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
  sort: SkillSort;
  view: 'list' | 'cards';
  page: number;
}

export const DEFAULT_FILTERS: ExploreFilters = {
  q: '',
  agent: '',
  verification: '',
  category: '',
  sort: 'popular',
  view: 'list',
  page: 1,
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
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
    sort: (SKILL_SORTS as readonly string[]).includes(sort) ? (sort as SkillSort) : 'popular',
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
  if (merged.sort !== DEFAULT_FILTERS.sort) params.set('sort', merged.sort);
  if (merged.view !== DEFAULT_FILTERS.view) params.set('view', merged.view);
  if (merged.page > 1) params.set('page', String(merged.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function toSkillQuery(filters: ExploreFilters, pageSize: number): SkillQuery {
  return {
    q: filters.q || undefined,
    agent: filters.agent || undefined,
    verification: filters.verification || undefined,
    category: filters.category || undefined,
    sort: filters.sort,
    page: filters.page,
    pageSize,
  };
}
