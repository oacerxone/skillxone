import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request-forgery defences shared by every mutating route. Pure functions, so they are
 * unit-tested without a server.
 */

const CSRF_CONTEXT = 'skillxone-csrf-v1';

/** The CSRF token for a session: an HMAC of a fixed context under the session's secret. */
export function csrfToken(csrfSecret: string): string {
  return createHmac('sha256', csrfSecret).update(CSRF_CONTEXT).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyCsrf(csrfSecret: string, provided: string | null | undefined): boolean {
  if (!provided || provided.length > 200) return false;
  return safeEqual(csrfToken(csrfSecret), provided);
}

/**
 * Mutating requests from a browser carry an Origin header (Fetch standard). When present it
 * must be this site's origin. When absent (non-browser clients) the CSRF token or the lack
 * of ambient credentials is what protects the request.
 */
export function originAllowed(request: Request, siteUrl: string): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  if (origin === 'null') return false;
  try {
    const allowed = new Set([new URL(siteUrl).origin, new URL(request.url).origin]);
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}
