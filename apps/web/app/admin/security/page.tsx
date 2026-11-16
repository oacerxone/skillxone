import Link from 'next/link';
import { listOpenFindings } from '@skillxone/database';
import {
  AdminForm,
  AdminTitle,
  Done,
  Empty,
  NoteField,
  Submit,
} from '@/components/admin/admin-parts';
import { requireStaff } from '@/lib/admin';
import { getDatabase } from '@/lib/db';

export const metadata = { title: 'Security' };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const session = await requireStaff();
  const query = await searchParams;
  const { db } = await getDatabase();
  const rows = await listOpenFindings(db);
  return (
    <>
      <AdminTitle title="Security findings">
        Medium-or-worse findings on current versions. A decision needs a public note, follows the
        finding across rescans, and queues a rescan so the skill&apos;s state is recomputed.
      </AdminTitle>
      <Done done={query.done} />
      {rows.length === 0 ? (
        <Empty>No findings to review.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="panel p-3 text-[13px]">
              <p>
                <span className="font-medium uppercase">{row.severity}</span>{' '}
                <code className="font-mono">{row.rule_id}</code> ·{' '}
                <Link href={`/skills/${row.slug}?tab=security`} className="link font-mono">
                  {row.slug}
                </Link>
                {row.file_path && (
                  <span className="text-text-muted">
                    {' '}
                    · {row.file_path}
                    {row.line_start ? `:${row.line_start}` : ''}
                  </span>
                )}
                <span className="text-text-muted"> · {row.status.replace('_', ' ')}</span>
              </p>
              {row.excerpt && (
                <pre className="code-block mt-2" tabIndex={0}>
                  <code>{row.excerpt}</code>
                </pre>
              )}
              <AdminForm
                action={`/api/admin/findings/${row.id}`}
                csrf={session.csrf}
                back="/admin/security"
                className="mt-2"
              >
                {row.status === 'open' ? (
                  <>
                    <NoteField id={`note-${row.id}`} required />
                    <Submit name="status" value="false_positive">
                      False positive
                    </Submit>
                    <Submit name="status" value="accepted">
                      Accept risk
                    </Submit>
                  </>
                ) : (
                  <Submit name="status" value="open">
                    Reopen
                  </Submit>
                )}
              </AdminForm>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
