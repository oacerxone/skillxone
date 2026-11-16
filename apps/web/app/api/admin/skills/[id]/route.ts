import { setSkillVisibility } from '@skillxone/database';
import { apiError } from '@/lib/api';
import { adminAction, formText, isId } from '@/lib/admin-action';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Hide a skill from the catalog (for example after a takedown), or show it again. */
export const POST = adminAction<{ params: Promise<{ id: string }> }>(
  'moderator',
  async ({ form, session, ipHash, context }) => {
    const id = (await context.params).id;
    const visibility = formText(form, 'visibility');
    const note = formText(form, 'note');
    if (!isId(id) || (visibility !== 'hidden' && visibility !== 'active'))
      return apiError(400, 'INVALID_REQUEST', 'Choose hide or show.');
    if (note.length < 5)
      return apiError(400, 'INVALID_REQUEST', 'A reason of at least 5 characters is required.');
    const { db } = await getDatabase();
    const changed = await setSkillVisibility(
      db,
      { skillId: id, hidden: visibility === 'hidden', note, actorId: session.user.id, ipHash },
      new Date(),
    );
    if (!changed) return apiError(404, 'NOT_FOUND', 'Skill not found.');
    return `skill-${visibility}`;
  },
);
