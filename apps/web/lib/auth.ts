import { cookies } from 'next/headers';
import { findSession, hashIp, ipHashSecret } from '@skillxone/database';
import type { SessionUser, UserRole } from '@skillxone/database';
import { loadRootEnvFile, parseEnv } from '@skillxone/shared';
import { apiError, clientKey } from './api';
import { getDatabase } from './db';
import { roleFor } from './oauth';
import type { OAuthConfig } from './oauth';
import { csrfToken, originAllowed, verifyCsrf } from './security';

/**
 * Sessions for the web app. The cookie holds a random token; the database holds its hash.
 * Cookie: HttpOnly, SameSite=Lax, Secure when the site is served over HTTPS.
 */

export const SESSION_COOKIE = 'sx_session';
export const STATE_COOKIE = 'sx_oauth_state';
/** Where to return after sign-in. Only the fixed pages below are accepted. */
export const NEXT_COOKIE = 'sx_oauth_next';
const NEXT_PATHS = new Set(['/pricing', '/account']);
export const safeNextPath = (value: string | null | undefined): string | null =>
  value && NEXT_PATHS.has(value) ? value : null;

const RANK: Record<UserRole, number> = { user: 0, moderator: 1, admin: 2 };
export const hasRole = (user: { role: UserRole }, role: UserRole) => RANK[user.role] >= RANK[role];

export function siteEnv() {
  loadRootEnvFile();
  return parseEnv();
}

export function oauthConfig(): OAuthConfig | null {
  const env = siteEnv();
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) return null;
  return {
    clientId: env.GITHUB_OAUTH_CLIENT_ID,
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
    siteUrl: env.SITE_URL,
    adminIds: env.ADMIN_GITHUB_IDS,
    moderatorIds: env.MODERATOR_GITHUB_IDS,
  };
}

export function cookieOptions(maxAgeSeconds: number, path = '/') {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: siteEnv().SITE_URL.startsWith('https://'),
    path,
    maxAge: maxAgeSeconds,
  };
}

/**
 * The operator's allowlist decides roles on every request, not only at sign-in, so removing
 * someone from ADMIN_GITHUB_IDS or MODERATOR_GITHUB_IDS takes effect immediately for sessions
 * that already exist.
 */
function withCurrentRole(session: SessionUser | null): SessionUser | null {
  if (!session) return null;
  const env = siteEnv();
  const role = roleFor(Number(session.user.github_id), {
    adminIds: env.ADMIN_GITHUB_IDS,
    moderatorIds: env.MODERATOR_GITHUB_IDS,
  });
  return { ...session, user: { ...session.user, role } };
}

/** The signed-in user for a page or server component, or null. */
export async function currentSession(): Promise<(SessionUser & { csrf: string }) | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { db } = await getDatabase();
  const session = withCurrentRole(await findSession(db, token, new Date()));
  return session ? { ...session, csrf: csrfToken(session.csrfSecret) } : null;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function sessionFromRequest(request: Request): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const { db } = await getDatabase();
  return withCurrentRole(await findSession(db, token, new Date()));
}

/** Keyed hash of the caller's address, or null when the address is not known. */
export async function requestIpHash(request: Request): Promise<string | null> {
  const key = clientKey(request);
  if (key === 'direct') return null;
  const { db } = await getDatabase();
  return hashIp(key, await ipHashSecret(db, new Date()));
}

/** The CSRF token sent with a request: `X-CSRF-Token` header, or a `csrf` form field. */
export function providedCsrf(request: Request, form: FormData | null): string | null {
  return request.headers.get('x-csrf-token') ?? (form?.get('csrf') as string | null) ?? null;
}

/**
 * Guards a mutating admin route: same-site origin, a valid session with the role, and a CSRF
 * token. Returns the session, or the response to send.
 */
export async function requireAdminMutation(
  request: Request,
  role: UserRole,
  form: FormData | null,
): Promise<SessionUser | Response> {
  if (!originAllowed(request, siteEnv().SITE_URL))
    return apiError(403, 'FORBIDDEN', 'Cross-site request refused.');
  const session = await sessionFromRequest(request);
  if (!session) return apiError(401, 'UNAUTHENTICATED', 'Sign in first.');
  if (!hasRole(session.user, role))
    return apiError(403, 'FORBIDDEN', 'Your account does not have permission for this.');
  if (!verifyCsrf(session.csrfSecret, providedCsrf(request, form))) {
    return apiError(
      403,
      'CSRF_FAILED',
      'The form expired or did not come from this site. Reload and try again.',
    );
  }
  return session;
}
