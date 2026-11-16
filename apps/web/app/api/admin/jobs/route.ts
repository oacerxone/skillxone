import { createJobQueue, requeueJob, writeAudit } from '@skillxone/database';
import { apiError } from '@/lib/api';
import { adminAction, formText, isId } from '@/lib/admin-action';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Jobs an admin may start from the dashboard. Payload-free, so nothing else can be injected. */
const RUNNABLE = ['rank', 'reindex', 'enqueue_scans', 'expire_verifications'] as const;

/** Retry a dead job, or queue one of the maintenance jobs above. */
export const POST = adminAction('admin', async ({ form, session, ipHash }) => {
  const action = formText(form, 'action');
  const { db } = await getDatabase();
  const now = new Date();
  if (action === 'retry') {
    const jobId = formText(form, 'jobId');
    if (!isId(jobId)) return apiError(400, 'INVALID_REQUEST', 'Missing job id.');
    if (!(await requeueJob(db, jobId, now)))
      return apiError(409, 'CONFLICT', 'Only dead or failed jobs can be retried.');
    await writeAudit(
      db,
      { actorId: session.user.id, action: 'job.retry', targetType: 'job', targetId: jobId, ipHash },
      now,
    );
    return 'job-retried';
  }
  if (action === 'run') {
    const type = formText(form, 'type') as (typeof RUNNABLE)[number];
    if (!RUNNABLE.includes(type))
      return apiError(400, 'INVALID_REQUEST', 'That job cannot be started from here.');
    const result = await createJobQueue(db).enqueue(type, {}, { dedupeKey: type, priority: 5 });
    await writeAudit(
      db,
      {
        actorId: session.user.id,
        action: 'job.run',
        targetType: 'job',
        targetId: result.id,
        after: { type },
        ipHash,
      },
      now,
    );
    return result.created ? 'job-queued' : 'job-already-queued';
  }
  return apiError(400, 'INVALID_REQUEST', 'Unknown action.');
});
