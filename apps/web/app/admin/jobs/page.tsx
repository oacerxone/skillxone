import { createJobQueue, listJobs } from '@skillxone/database';
import {
  AdminForm,
  AdminTitle,
  Done,
  Empty,
  StatusFilter,
  Submit,
} from '@/components/admin/admin-parts';
import { requireStaff } from '@/lib/admin';
import { getDatabase } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Jobs' };
const STATUSES = ['all', 'queued', 'running', 'succeeded', 'dead'] as const;
const RUNNABLE = [
  ['rank', 'Recompute ranking'],
  ['reindex', 'Rebuild search index'],
  ['enqueue_scans', 'Scan unassessed skills'],
  ['expire_verifications', 'Expire verifications'],
] as const;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string }>;
}) {
  const session = await requireStaff('admin');
  const query = await searchParams;
  const status = (STATUSES as readonly string[]).includes(query.status ?? '')
    ? query.status!
    : 'all';
  const { db } = await getDatabase();
  const counts = await createJobQueue(db).counts();
  const rows = await listJobs(db, { status: status === 'all' ? undefined : status, limit: 100 });
  const back = `/admin/jobs?status=${status}`;
  return (
    <>
      <AdminTitle title="Jobs">
        {Object.entries(counts)
          .map(([name, n]) => `${n} ${name}`)
          .join(', ') || 'No jobs.'}{' '}
        The worker runs these; queuing here does not run anything in the web process.
      </AdminTitle>
      <Done done={query.done} />
      <AdminForm action="/api/admin/jobs" csrf={session.csrf} back={back} className="mb-4">
        <input type="hidden" name="action" value="run" />
        {RUNNABLE.map(([type, label]) => (
          <Submit key={type} name="type" value={type}>
            {label}
          </Submit>
        ))}
      </AdminForm>
      <StatusFilter base="/admin/jobs" current={status} options={STATUSES} />
      {rows.length === 0 ? (
        <Empty>No jobs.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((job) => (
            <li key={job.id} className="panel p-3 text-[13px]">
              <p>
                <code className="font-mono">{job.type}</code> · {job.status} · attempts{' '}
                {job.attempts}/{job.maxAttempts}
                {job.schedule ? ` · ${job.schedule}` : ''}
                <span className="text-text-muted"> · {formatDate(job.createdAt)}</span>
              </p>
              {job.lastError && (
                <p className="mt-1 break-words text-text-muted">
                  {job.lastError.split('\n')[0]!.slice(0, 300)}
                </p>
              )}
              {job.status === 'dead' && (
                <AdminForm
                  action="/api/admin/jobs"
                  csrf={session.csrf}
                  back={back}
                  className="mt-2"
                >
                  <input type="hidden" name="action" value="retry" />
                  <input type="hidden" name="jobId" value={job.id} />
                  <Submit>Retry</Submit>
                </AdminForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
