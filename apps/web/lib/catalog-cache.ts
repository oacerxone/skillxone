import {
  getRepositoryStars,
  hasDevFixtures,
  listAgentIds,
  listCategories,
  listCollections,
} from '@skillxone/database';
import type { SkillPage, SkillQuery } from '@skillxone/database';
import { cached } from './cache';
import { getDatabase } from './db';
import { searchSkills } from './search';

/**
 * Cached versions of the catalog reads that almost every page makes. The worker updates the
 * catalog in the background, so a short freshness window is invisible to visitors but saves
 * every navigation from re-counting tens of thousands of rows on a small server.
 */
const MINUTE = 60_000;

export async function cachedCategories() {
  return cached('categories', 5 * MINUTE, async () => listCategories((await getDatabase()).db));
}

export async function cachedCollections() {
  return cached('collections', 5 * MINUTE, async () => listCollections((await getDatabase()).db));
}

export async function cachedAgentIds() {
  return cached('agent-ids', 10 * MINUTE, async () => listAgentIds((await getDatabase()).db));
}

export async function cachedDevFixtures(): Promise<boolean> {
  return cached('dev-fixtures', MINUTE, async () => hasDevFixtures((await getDatabase()).db));
}

export async function cachedRepositoryStars(owner: string, name: string) {
  return cached(`stars:${owner}/${name}`.toLowerCase(), 10 * MINUTE, async () =>
    getRepositoryStars((await getDatabase()).db, owner, name),
  );
}

/** Listing and search results, keyed by the full query so filters never share an entry. */
export async function cachedSearch(query: SkillQuery): Promise<SkillPage> {
  const key = `search:${JSON.stringify(query, Object.keys(query).sort())}`;
  return cached(key, MINUTE, () => searchSkills(query));
}
