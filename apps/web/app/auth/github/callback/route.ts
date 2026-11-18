import { NextResponse } from 'next/server';
import { createSession, upsertGitHubUser, writeAudit } from '@skillxone/database';
import {
  cookieOptions,
  NEXT_COOKIE,
  oauthConfig,
  safeNextPath,
  requestIpHash,
  SESSION_COOKIE,
  STATE_COOKIE,
} from '@/lib/auth';
import { getDatabase } from '@/lib/db';
import { exchangeCode, roleFor } from '@/lib/oauth';
import { safeEqual } from '@/lib/security';

export const dynamic = 'force-dynamic';

function fail(request: Request, reason: string): Response {
  const url = new URL('/auth/unavailable', request.url);
  url.searchParams.set('reason', reason);
  const response = NextResponse.redirect(url, 303);
  response.cookies.delete({ name: STATE_COOKIE, path: '/auth' });
  return response;
}

function readCookieValue(request: Request, name: string): string | undefined {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Finishes GitHub sign-in: checks state, reads the profile, starts a session. */
export async function GET(request: Request): Promise<Response> {
  const config = oauthConfig();
  if (!config) return fail(request, 'not-configured');
  const params = new URL(request.url).searchParams;
  const state = params.get('state') ?? '';
  const code = params.get('code') ?? '';
  const expected = readCookieValue(request, STATE_COOKIE);
  if (!expected || !state || !safeEqual(expected, state)) return fail(request, 'state');

  try {
    const profile = await exchangeCode(config, code);
    const now = new Date();
    const { db } = await getDatabase();
    const user = await upsertGitHubUser(
      db,
      { ...profile, role: roleFor(profile.githubId, config) },
      now,
    );
    if (Number(user.is_disabled) === 1) return fail(request, 'disabled');
    const session = await createSession(db, user.id, now);
    await writeAudit(
      db,
      {
        actorId: user.id,
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        after: { role: user.role },
        ipHash: await requestIpHash(request),
      },
      now,
    );
    const next = safeNextPath(readCookieValue(request, NEXT_COOKIE));
    const response = NextResponse.redirect(
      new URL(next ?? (user.role === 'user' ? '/' : '/admin'), request.url),
      303,
    );
    response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(7 * 86_400));
    response.cookies.delete({ name: STATE_COOKIE, path: '/auth' });
    response.cookies.delete({ name: NEXT_COOKIE, path: '/auth' });
    return response;
  } catch (error) {
    console.error(
      'GitHub sign-in failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return fail(request, 'github');
  }
}
