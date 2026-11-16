import { forbidden, unauthorized } from 'next/navigation';
import type { UserRole } from '@skillxone/database';
import { currentSession, hasRole } from './auth';

/**
 * Every admin page calls this before reading data: layouts do not re-run on client-side
 * navigation, so a check in the layout alone is not enough.
 */
export async function requireStaff(role: UserRole = 'moderator') {
  const session = await currentSession();
  if (!session) unauthorized();
  if (!hasRole(session.user, role)) forbidden();
  return session;
}

/** Admin pages a test must cover; keep in step with app/admin. */
export const ADMIN_PAGES = [
  { href: '/admin', label: 'Overview', role: 'moderator' },
  { href: '/admin/submissions', label: 'Submissions', role: 'moderator' },
  { href: '/admin/reports', label: 'Reports', role: 'moderator' },
  { href: '/admin/security', label: 'Security', role: 'moderator' },
  { href: '/admin/skills', label: 'Skills', role: 'moderator' },
  { href: '/admin/repositories', label: 'Repositories', role: 'moderator' },
  { href: '/admin/jobs', label: 'Jobs', role: 'admin' },
  { href: '/admin/audit', label: 'Audit log', role: 'admin' },
  { href: '/admin/settings', label: 'Settings', role: 'admin' },
] as const;
