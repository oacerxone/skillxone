import { NextResponse } from 'next/server';
import { deleteSession, writeAudit } from '@skillxone/database';
import { apiError } from '@/lib/api';
import { providedCsrf, sessionFromRequest, SESSION_COOKIE, siteEnv } from '@/lib/auth';
import { getDatabase } from '@/lib/db';
import { originAllowed, verifyCsrf } from '@/lib/security';

export const dynamic = 'force-dynamic';

/** Ends the session. POST with the CSRF token, so another site cannot sign you out. */
export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request, siteEnv().SITE_URL))
    return apiError(403, 'FORBIDDEN', 'Cross-site request refused.');
  const form = await request.formData().catch(() => null);
  const session = await sessionFromRequest(request);
  if (session) {
    if (!verifyCsrf(session.csrfSecret, providedCsrf(request, form))) {
      return apiError(403, 'CSRF_FAILED', 'The form expired. Reload and try again.');
    }
    const { db } = await getDatabase();
    await deleteSession(db, session.sessionId);
    await writeAudit(
      db,
      {
        actorId: session.user.id,
        action: 'auth.logout',
        targetType: 'user',
        targetId: session.user.id,
      },
      new Date(),
    );
  }
  const response = NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
