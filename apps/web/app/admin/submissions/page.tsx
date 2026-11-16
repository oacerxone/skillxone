import { listSubmissions } from '@skillxone/database';
import type { Submission } from '@skillxone/database';
import {
  AdminForm,
  AdminTitle,
  Done,
  Empty,
  NoteField,
  StatusFilter,
  Submit,
} from '@/components/admin/admin-parts';
import { requireStaff } from '@/lib/admin';
import { getDatabase } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Submissions' };
const STATUSES = ['pending', 'approved', 'rejected', 'duplicate', 'requires_review'] as const;

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string }>;
}) {
  const session = await requireStaff();
  const query = await searchParams;
  const status = (STATUSES as readonly string[]).includes(query.status ?? '')
    ? (query.status as Submission['status'])
    : 'pending';
  const { db } = await getDatabase();
  const rows = await listSubmissions(db, { status });
  const back = `/admin/submissions?status=${status}`;
  return (
    <>
      <AdminTitle title="Submissions">
        Approving queues the repository for indexing; nothing is fetched until the worker runs.
      </AdminTitle>
      <Done done={query.done} />
      <StatusFilter base="/admin/submissions" current={status} options={STATUSES} />
      {rows.length === 0 ? (
        <Empty>No {status} submissions.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="panel p-3 text-[13px]">
              <p className="font-mono">
                <a
                  href={`https://github.com/${row.repo_full_name_lower}`}
                  className="link"
                  rel="noopener noreferrer"
                >
                  {row.repo_full_name_lower}
                </a>
              </p>
              <p className="text-text-muted">
                {formatDate(row.created_at)} · {row.status}
                {row.note ? ` · “${row.note}”` : ''}
              </p>
              {row.status === 'pending' && (
                <AdminForm
                  action={`/api/admin/submissions/${row.id}`}
                  csrf={session.csrf}
                  back={back}
                  className="mt-2"
                >
                  <NoteField id={`note-${row.id}`} />
                  <Submit name="status" value="approved">
                    Approve
                  </Submit>
                  <Submit name="status" value="rejected">
                    Reject
                  </Submit>
                </AdminForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
