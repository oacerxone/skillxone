import { listSkills } from '@skillxone/database';
import type { SkillListItem, SkillQuery } from '@skillxone/database';

type Db = Parameters<typeof listSkills>[0];

/** Keeps at most `perSource` skills from each repository, preserving order. */
export function onePerSource(
  items: readonly SkillListItem[],
  limit: number,
  perSource = 1,
): SkillListItem[] {
  const seen = new Map<string, number>();
  const picked: SkillListItem[] = [];
  for (const item of items) {
    const key = `${item.owner}/${item.repo}`.toLowerCase();
    const count = seen.get(key) ?? 0;
    if (count >= perSource) continue;
    seen.set(key, count + 1);
    picked.push(item);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * A listing for showcase sections: the query's order, but at most `perSource` skills per
 * repository, so one large repository cannot fill the section. Reads up to `maxPages` pages.
 */
export async function listDiverseSkills(
  db: Db,
  query: SkillQuery,
  limit: number,
  { perSource = 1, maxPages = 5 } = {},
): Promise<{ items: SkillListItem[]; total: number }> {
  const collected: SkillListItem[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listSkills(db, { ...query, page, pageSize: 100 });
    total = result.total;
    collected.push(...result.items);
    if (onePerSource(collected, limit, perSource).length >= limit || page >= result.pageCount)
      break;
  }
  return { items: onePerSource(collected, limit, perSource), total };
}
