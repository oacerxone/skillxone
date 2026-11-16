import Link from 'next/link';
import { listReports } from '@skillxone/database';
import type { Report } from '@skillxone/database';
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

export const metadata = { title: 'Reports' };
const STATUSES = ['open', 'triaged', 'resolved', 'dismissed'] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string }>;
}) {
  const session = await requireStaff();
  const query = await searchParams;
  const status = (STATUSES as readonly string[]).includes(query.status ?? '')
    ? (query.status as Report['status'])
    : 'open';
  const { db } = await getDatabase();
  const rows = await listReports(db, { status });
  const back = `/admin/reports?status=${status}`;
  return (
    <>
      <AdminTitle title="Reports">
        Triaging a report confirms it is under review; only triaged reports lower a skill&apos;s
        ranking.
      </AdminTitle>
      <Done done={query.done} />
      <StatusFilter base="/admin/reports" current={status} options={STATUSES} />
      {rows.length === 0 ? (
        <Empty>No {status} reports.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="panel p-3 text-[13px]">
              <p>
                <span className="font-medium">{row.type.replace(/_/g, ' ')}</span>
                {row.skill_slug && (
                  <>
                    {' · '}
                    <Link
                      href={`/skills/${row.skill_slug}?tab=security`}
                      className="link font-mono"
                    >
                      {row.skill_slug}
                    </Link>
                  </>
                )}
                <span className="text-text-muted"> · {formatDate(row.created_at)}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{row.body}</p>
              {row.contact && <p className="mt-1 text-text-muted">Contact: {row.contact}</p>}
              {row.resolution_note && (
                <p className="mt-1 text-text-muted">Note: {row.resolution_note}</p>
              )}
              {(row.status === 'open' || row.status === 'triaged') && (
                <AdminForm
                  action={`/api/admin/reports/${row.id}`}
                  csrf={session.csrf}
                  back={back}
                  className="mt-2"
                >
                  <NoteField id={`note-${row.id}`} />
                  {row.status === 'open' && (
                    <Submit name="status" value="triaged">
                      Triage
                    </Submit>
                  )}
                  <Submit name="status" value="resolved">
                    Resolve
                  </Submit>
                  <Submit name="status" value="dismissed">
                    Dismiss
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
