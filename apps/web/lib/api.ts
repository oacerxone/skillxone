import { createRateLimiter } from './rate-limit';
import type { RateLimiter } from './rate-limit';

/**
 * Shared behaviour for the public REST API: one error shape, rate limiting, cache headers.
 *
 * Error body: `{ "error": { "code": "NOT_FOUND", "message": "..." } }`.
 * Messages are fixed strings; they never include internal details or echo raw input.
 */

const globalStore = globalThis as typeof globalThis & { __skillxoneApiLimiter?: RateLimiter };

function limiter(): RateLimiter {
  globalStore.__skillxoneApiLimiter ??= createRateLimiter({
    limit:
      Number(process.env.API_RATE_LIMIT_PER_MINUTE) > 0
        ? Number(process.env.API_RATE_LIMIT_PER_MINUTE)
        : 120,
    windowMs: 60_000,
  });
  return globalStore.__skillxoneApiLimiter;
}

/**
 * Identifies the caller for rate limiting. The forwarded address is only trusted when the
 * operator says the app is behind a reverse proxy (`TRUST_PROXY=1`); otherwise a client
 * could set the header itself to dodge the limit, so all callers share one bucket.
 */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded && forwarded.length <= 64) return forwarded;
  }
  return 'direct';
}

export function apiError(
  status: number,
  code: string,
  message: string,
  headers: HeadersInit = {},
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

export interface HandlerOptions {
  /** Seconds a shared cache may keep the response. Catalog data changes at most hourly. */
  cacheSeconds?: number;
}

/**
 * Wraps a GET handler with rate limiting, error handling and headers. The handler returns
 * plain data, or a Response when it needs to signal an error.
 */
export function apiHandler<Context>(
  handler: (request: Request, context: Context) => Promise<unknown>,
  options: HandlerOptions = {},
) {
  return async (request: Request, context: Context): Promise<Response> => {
    const limit = limiter().check(clientKey(request));
    const rateHeaders = {
      'X-RateLimit-Limit': String(limit.limit),
      'X-RateLimit-Remaining': String(limit.remaining),
    };
    if (!limit.allowed) {
      return apiError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.', {
        ...rateHeaders,
        'Retry-After': String(limit.retryAfter),
      });
    }
    try {
      const result = await handler(request, context);
      if (result instanceof Response) {
        for (const [name, value] of Object.entries(rateHeaders)) result.headers.set(name, value);
        return result;
      }
      const cache = options.cacheSeconds ?? 60;
      return Response.json(result, {
        headers: {
          ...rateHeaders,
          'Cache-Control': `public, max-age=${cache}, stale-while-revalidate=${cache * 5}`,
        },
      });
    } catch (error) {
      // Log for the operator; tell the caller nothing about internals.
      console.error('API error', request.method, new URL(request.url).pathname, error);
      return apiError(500, 'INTERNAL_ERROR', 'The request could not be completed.', rateHeaders);
    }
  };
}

export const notFound = (what: string) => apiError(404, 'NOT_FOUND', `${what} not found.`);
export const badRequest = (message: string) => apiError(400, 'INVALID_REQUEST', message);

/** Skill and repository ids are ULIDs (or fixture ids): a short, restricted alphabet. */
export const isValidId = (id: string) => /^[A-Za-z0-9_-]{1,120}$/.test(id);

export function parsePaging(params: URLSearchParams): { page: number; perPage: number } | Response {
  const read = (name: string, fallback: number, max: number) => {
    const raw = params.get(name);
    if (raw === null || raw === '') return fallback;
    if (!/^\d{1,7}$/.test(raw)) return null;
    const value = Number(raw);
    return value >= 1 && value <= max ? value : null;
  };
  const page = read('page', 1, 100_000);
  const perPage = read('per_page', 30, 100);
  if (page === null) return badRequest('"page" must be a positive integer.');
  if (perPage === null) return badRequest('"per_page" must be between 1 and 100.');
  return { page, perPage };
}
