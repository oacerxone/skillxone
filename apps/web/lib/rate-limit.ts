/**
 * In-memory token bucket rate limiter. One process, no Redis: this is enough for a single
 * web server, which is the supported topology. Behind several web servers each one limits
 * independently, so put the limit in the reverse proxy instead.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until at least one request is available again. */
  retryAfter: number;
}

export interface RateLimiterOptions {
  /** Requests allowed per window, and the burst size. */
  limit: number;
  windowMs: number;
  /** Maximum number of clients tracked; the least recently seen are dropped beyond it. */
  maxKeys?: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const refillPerMs = options.limit / options.windowMs;
  // Map preserves insertion order; re-inserting on use keeps the oldest entries first.
  const buckets = new Map<string, Bucket>();

  return {
    check(key: string): RateLimitResult {
      const time = now();
      const existing = buckets.get(key);
      const tokens = existing
        ? Math.min(options.limit, existing.tokens + (time - existing.updated) * refillPerMs)
        : options.limit;
      const allowed = tokens >= 1;
      const next = allowed ? tokens - 1 : tokens;
      buckets.delete(key);
      buckets.set(key, { tokens: next, updated: time });
      if (buckets.size > maxKeys) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      return {
        allowed,
        limit: options.limit,
        remaining: Math.max(0, Math.floor(next)),
        retryAfter: allowed ? 0 : Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)),
      };
    },
    get size() {
      return buckets.size;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
