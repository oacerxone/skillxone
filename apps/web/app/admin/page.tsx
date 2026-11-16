import Link from 'next/link';
import { adminOverview } from '@skillxone/database';
import { AdminTitle } from '@/components/admin/admin-parts';
import { requireStaff } from '@/lib/admin';
import { getDatabase } from '@/lib/db';

export default async function AdminOverview() {
  await requireStaff();
  const { db } = await getDatabase();
  const o = await adminOverview(db);
  const tiles: Array<[string, number, string]> = [
    ['Pending submissions', o.pendingSubmissions, '/admin/submissions'],
    ['Open reports', o.openReports, '/admin/reports'],
    ['Open findings (medium or worse)', o.openFindings, '/admin/security'],
    ['Dead jobs', o.deadJobs, '/admin/jobs?status=dead'],
    ['Queued jobs', o.queuedJobs, '/admin/jobs?status=queued'],
    ['Repositories', o.repositories, '/admin/repositories'],
    ['Active skills', o.skills, '/admin/skills'],
    ['Hidden skills', o.hiddenSkills, '/admin/skills'],
  ];
  return (
    <>
      <AdminTitle title="Overview">
        Verification: {o.verification.VERIFIED ?? 0} verified, {o.verification.UNVERIFIED ?? 0}{' '}
        unverified, {o.verification.FLAGGED ?? 0} flagged.
      </AdminTitle>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(([label, value, href]) => (
          <li key={label} className="panel p-3">
            <Link href={href} className="block">
              <span className="block text-[24px] font-semibold leading-8">{value}</span>
              <span className="text-[13px] text-text-muted">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
