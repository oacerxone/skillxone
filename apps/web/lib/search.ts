import { listSkills } from '@skillxone/database';
import type { SkillPage, SkillQuery } from '@skillxone/database';
import { createSearchBackend } from '@skillxone/search';
import type { SearchBackend } from '@skillxone/search';
import { getDatabase } from './db';

const globalStore = globalThis as typeof globalThis & {
  __skillxoneSearch?: Promise<SearchBackend>;
};

/** The search backend for this process. The index structure is created on first use. */
export function getSearch(): Promise<SearchBackend> {
  if (!globalStore.__skillxoneSearch) {
    const creating = getDatabase().then(async (handle) => {
      const backend = createSearchBackend(handle);
      await backend.ensure();
      return backend;
    });
    creating.catch(() => {
      globalStore.__skillxoneSearch = undefined;
    });
    globalStore.__skillxoneSearch = creating;
  }
  return globalStore.__skillxoneSearch;
}

/**
 * Lists skills, using ranked full-text search when there is a query. If the index returns
 * nothing (for example it has not been built yet, or the term is a fragment inside a word),
 * the plain substring match is used so a search never silently comes back empty.
 */
export async function searchSkills(query: SkillQuery): Promise<SkillPage> {
  const { db } = await getDatabase();
  if (!query.q) return listSkills(db, query);
  let ids: string[];
  try {
    ids = await (await getSearch()).search(query.q);
  } catch {
    ids = []; // a damaged index must not take search down; the fallback below still works
  }
  if (ids.length === 0) return listSkills(db, query);
  return listSkills(db, { ...query, restrictToIds: ids, textMatched: true });
}
