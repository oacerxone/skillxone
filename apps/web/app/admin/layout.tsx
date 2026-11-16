import type { Metadata } from 'next';
import Link from 'next/link';
import { ADMIN_PAGES, requireStaff } from '@/lib/admin';
import { hasRole } from '@/lib/auth';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s — Admin' },
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();
  return (
    <div className="grid gap-6 py-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Admin" className="text-[13px]">
        <ul className="flex flex-wrap gap-x-4 gap-y-2 lg:flex-col">
          {ADMIN_PAGES.filter((page) => hasRole(session.user, page.role)).map((page) => (
            <li key={page.href}>
              <Link href={page.href} className="link">
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-3 text-text-muted">
          <p>
            {session.user.login} ({session.user.role})
          </p>
          <form method="post" action="/auth/logout" className="mt-2">
            <input type="hidden" name="csrf" value={session.csrf} />
            <button type="submit" className="link">
              Sign out
            </button>
          </form>
        </div>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
