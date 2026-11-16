import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

function setup(limit = 3, windowMs = 60_000, maxKeys?: number) {
  let time = 1_000_000;
  const limiter = createRateLimiter({ limit, windowMs, maxKeys, now: () => time });
  return { limiter, advance: (ms: number) => (time += ms) };
}

describe('rate limiter', () => {
  it('allows a burst up to the limit, then refuses', () => {
    const { limiter } = setup();
    expect(limiter.check('a')).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a')).toMatchObject({ allowed: true, remaining: 0 });
    const refused = limiter.check('a');
    expect(refused).toMatchObject({ allowed: false, remaining: 0, limit: 3 });
    expect(refused.retryAfter).toBeGreaterThanOrEqual(1);
    expect(refused.retryAfter).toBeLessThanOrEqual(20);
  });

  it('refills steadily over time', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i += 1) limiter.check('a');
    expect(limiter.check('a').allowed).toBe(false);
    advance(20_000); // one third of the window restores one request
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    advance(600_000);
    expect(limiter.check('a').remaining).toBe(2); // never above the limit
  });

  it('tracks clients independently', () => {
    const { limiter } = setup(1);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('bounds memory by dropping the least recently seen clients', () => {
    const { limiter } = setup(1, 60_000, 3);
    for (const key of ['a', 'b', 'c', 'd', 'e']) limiter.check(key);
    expect(limiter.size).toBe(3);
    // "a" was dropped, so it starts fresh rather than staying blocked forever.
    expect(limiter.check('a').allowed).toBe(true);
  });
});
