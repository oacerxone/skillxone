import type { SessionUser } from '@skillxone/database';
import { apiError } from './api';
import { providedCsrf, sessionFromRequest, siteEnv } from './auth';
import { checkWriteLimit, readJsonBody } from './community-api';
import { originAllowed, verifyCsrf } from './security';

/**
 * Common checks for the public write endpoints: same-site origin, rate limit, JSON body, and
 * a CSRF token whenever a session cookie is attached (the cookie would otherwise attribute a
 * forged request to its owner). Anonymous API clients need no token.
 */
export async function publicWrite(
  request: Request,
): Promise<
  { ok: true; data: unknown; session: SessionUser | null } | { ok: false; response: Response }
> {
  if (!originAllowed(request, siteEnv().SITE_URL)) {
    return { ok: false, response: apiError(403, 'FORBIDDEN', 'Cross-site request refused.') };
  }
  const limited = checkWriteLimit(request);
  if (limited) return { ok: false, response: limited };
  const session = await sessionFromRequest(request);
  if (request.headers.get('cookie')?.includes('sx_session=') && !session) {
    return {
      ok: false,
      response: apiError(
        401,
        'UNAUTHENTICATED',
        'Your session has expired. Sign in again or clear the cookie.',
      ),
    };
  }
  if (session && !verifyCsrf(session.csrfSecret, providedCsrf(request, null))) {
    return {
      ok: false,
      response: apiError(403, 'CSRF_FAILED', 'Missing or invalid X-CSRF-Token header.'),
    };
  }
  const body = await readJsonBody(request);
  if (!body.ok) return body;
  return { ok: true, data: body.data, session };
}
