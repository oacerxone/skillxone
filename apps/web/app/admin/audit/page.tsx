import { listAudit } from '@skillxone/database';
import { AdminTitle, Empty } from '@/components/admin/admin-parts';
import { requireStaff } from '@/lib/admin';
import { getDatabase } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Audit log' };

export default async function AuditPage() {
  await requireStaff('admin');
  const { db } = await getDatabase();
  const rows = await listAudit(db, 200);
  return (
    <>
      <AdminTitle title="Audit log">
        Every sign-in and moderation action, newest first. IP addresses are stored only as keyed
        hashes.
      </AdminTitle>
      {rows.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-1 text-[13px]">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-border py-1">
              <span className="text-text-muted">{formatDate(row.created_at)}</span> ·{' '}
              {row.actor_login ?? 'system'} · <code className="font-mono">{row.action}</code> ·{' '}
              {row.target_type} <code className="font-mono">{row.target_id}</code>
              {row.after_json && (
                <span className="break-all text-text-muted"> · {row.after_json.slice(0, 200)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
