import { resolveReport } from '@skillxone/database';
import { apiError } from '@/lib/api';
import { adminAction, formText, isId } from '@/lib/admin-action';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUSES = ['triaged', 'resolved', 'dismissed'] as const;

/** Triage, resolve or dismiss a report. Only triaged reports count against ranking. */
export const POST = adminAction<{ params: Promise<{ id: string }> }>(
  'moderator',
  async ({ form, session, ipHash, context }) => {
    const id = (await context.params).id;
    const status = formText(form, 'status') as (typeof STATUSES)[number];
    if (!isId(id) || !STATUSES.includes(status))
      return apiError(400, 'INVALID_REQUEST', 'Choose triage, resolve or dismiss.');
    const { db } = await getDatabase();
    const updated = await resolveReport(
      db,
      { id, status, note: formText(form, 'note') || null, actorId: session.user.id, ipHash },
      new Date(),
    );
    if (!updated) return apiError(404, 'NOT_FOUND', 'Report not found.');
    return `report-${status}`;
  },
);
