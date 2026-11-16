import { createJobQueue, reviewFinding } from '@skillxone/database';
import { apiError } from '@/lib/api';
import { adminAction, formText, isId } from '@/lib/admin-action';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'false_positive', 'accepted'] as const;

/**
 * Mark a finding as a false positive or accepted (a public note is required), or reopen it.
 * A rescan is queued so the skill's state is recomputed under the published policy.
 */
export const POST = adminAction<{ params: Promise<{ id: string }> }>(
  'moderator',
  async ({ form, session, ipHash, context }) => {
    const id = (await context.params).id;
    const status = formText(form, 'status') as (typeof STATUSES)[number];
    const note = formText(form, 'note');
    if (!isId(id) || !STATUSES.includes(status))
      return apiError(400, 'INVALID_REQUEST', 'Choose a review decision.');
    if (status !== 'open' && note.length < 5)
      return apiError(
        400,
        'INVALID_REQUEST',
        'A public note of at least 5 characters is required.',
      );
    const { db } = await getDatabase();
    const target = await reviewFinding(
      db,
      { findingId: id, status, note, actorId: session.user.id, ipHash },
      new Date(),
    );
    if (!target) return apiError(404, 'NOT_FOUND', 'Finding not found.');
    await createJobQueue(db).enqueue(
      'scan_skill',
      { ...target, force: true },
      { dedupeKey: `rescan:${target.versionId}`, priority: 10 },
    );
    return `finding-${status}`;
  },
);
