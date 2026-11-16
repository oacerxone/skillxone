import { getSkillBySlug, getSkillSlugById } from '@skillxone/database';
import type { SkillDetail } from '@skillxone/database';
import { isValidId, notFound } from './api';
import { getDatabase } from './db';

/** Loads a skill for an id-based API route, or returns the 404 response to send. */
export async function loadSkillById(id: string): Promise<SkillDetail | Response> {
  if (!isValidId(id)) return notFound('Skill');
  const { db } = await getDatabase();
  const slug = await getSkillSlugById(db, id);
  const skill = slug ? await getSkillBySlug(db, slug) : undefined;
  return skill ?? notFound('Skill');
}
