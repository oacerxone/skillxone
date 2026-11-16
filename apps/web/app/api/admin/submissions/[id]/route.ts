import { createJobQueue, reviewSubmission } from '@skillxone/database';
import { parseRepoRef } from '@skillxone/github';
import { apiError } from '@/lib/api';
import { adminAction, formText, isId } from '@/lib/admin-action';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Approve (queues indexing) or reject a submission. */
export const POST = adminAction<{ params: Promise<{ id: string }> }>(
  'moderator',
  async ({ form, session, ipHash, context }) => {
    const id = (await context.params).id;
    const status = formText(form, 'status');
    if (!isId(id) || (status !== 'approved' && status !== 'rejected'))
      return apiError(400, 'INVALID_REQUEST', 'Choose approve or reject.');
    const { db } = await getDatabase();
    const now = new Date();
    const updated = await reviewSubmission(
      db,
      { id, status, note: formText(form, 'note') || null, actorId: session.user.id, ipHash },
      now,
    );
    if (!updated) return apiError(404, 'NOT_FOUND', 'Submission not found.');
    if (status === 'approved') {
      const ref = parseRepoRef(updated.repo_full_name_lower);
      if (ref) {
        await createJobQueue(db).enqueue(
          'sync_repo',
          { owner: ref.owner, repo: ref.repo, source: 'submission' },
          { dedupeKey: `sync:${ref.owner}/${ref.repo}`.toLowerCase() },
        );
      }
    }
    return `submission-${status}`;
  },
);
