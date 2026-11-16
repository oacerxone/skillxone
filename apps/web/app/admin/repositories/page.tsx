import { listRepositoriesForAdmin } from '@skillxone/database';
import { AdminTitle, Empty } from '@/components/admin/admin-parts';
import { requireStaff } from '@/lib/admin';
import { getDatabase } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Repositories' };

export default async function AdminRepositoriesPage() {
  await requireStaff();
  const { db } = await getDatabase();
  const rows = await listRepositoriesForAdmin(db);
  return (
    <>
      <AdminTitle title="Repositories">
        Indexed repositories with their state. Run `pnpm worker sync owner/repo` to refresh one now.
      </AdminTitle>
      {rows.length === 0 ? (
        <Empty>No repositories yet.</Empty>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Repositories">
          <table className="w-full text-left text-[13px]">
            <thead className="text-text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Repository</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Skills</th>
                <th className="py-1 pr-3 font-medium">Errors</th>
                <th className="py-1 pr-3 font-medium">Last synced</th>
                <th className="py-1 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono">
                    {row.owner}/{row.name}
                  </td>
                  <td className="py-1 pr-3">{row.status}</td>
                  <td className="py-1 pr-3">{Number(row.skills)}</td>
                  <td className="py-1 pr-3" title={row.last_sync_error ?? undefined}>
                    {Number(row.errors)}
                  </td>
                  <td className="py-1 pr-3">
                    {row.last_synced_at ? formatDate(row.last_synced_at) : 'never'}
                  </td>
                  <td className="py-1">{row.discovery_source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
