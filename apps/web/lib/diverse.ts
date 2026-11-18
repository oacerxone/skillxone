import { listSkillsPerRepository } from '@skillxone/database';
import type { SkillListItem, SkillQuery } from '@skillxone/database';

type Db = Parameters<typeof listSkillsPerRepository>[0];

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
 * repository, so one large repository cannot fill the section. Totals count every skill.
 */
export async function listDiverseSkills(
  db: Db,
  query: SkillQuery,
  limit: number,
  { perSource = 1 } = {},
): Promise<{ items: SkillListItem[]; total: number }> {
  return listSkillsPerRepository(db, query, limit, perSource);
}
