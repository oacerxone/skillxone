import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookieOptions, NEXT_COOKIE, oauthConfig, safeNextPath, STATE_COOKIE } from '@/lib/auth';
import { authorizeUrl } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/** Starts GitHub sign-in. The random state is kept in a short-lived HttpOnly cookie. */
export function GET(request: Request): Response {
  const config = oauthConfig();
  if (!config) {
    return NextResponse.redirect(new URL('/auth/unavailable', request.url), 303);
  }
  const state = randomBytes(24).toString('base64url');
  const response = NextResponse.redirect(authorizeUrl(config, state), 303);
  response.cookies.set(STATE_COOKIE, state, cookieOptions(600, '/auth'));
  const next = safeNextPath(new URL(request.url).searchParams.get('next'));
  if (next) response.cookies.set(NEXT_COOKIE, next, cookieOptions(600, '/auth'));
  return response;
}
