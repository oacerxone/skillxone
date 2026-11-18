import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cached, clearCache } from './cache';

describe('cached', () => {
  beforeEach(() => clearCache());

  it('loads once and serves the stored value while fresh', async () => {
    const load = vi.fn(async () => 1);
    let t = 0;
    expect(await cached('k', 100, load, () => t)).toBe(1);
    t = 50;
    expect(await cached('k', 100, load, () => t)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one load between concurrent misses', async () => {
    const load = vi.fn(async () => 'v');
    const results = await Promise.all([cached('k', 100, load), cached('k', 100, load)]);
    expect(results).toEqual(['v', 'v']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves a stale value at once and refreshes it in the background', async () => {
    let value = 1;
    const load = vi.fn(async () => value);
    let t = 0;
    await cached('k', 100, load, () => t);
    value = 2;
    t = 150;
    expect(await cached('k', 100, load, () => t)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await cached('k', 100, load, () => t)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed load', async () => {
    const load = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(3);
    await expect(cached('k', 100, load)).rejects.toThrow('down');
    expect(await cached('k', 100, load)).toBe(3);
  });

  it('keeps the stale value when a background refresh fails', async () => {
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockRejectedValue(new Error('down'));
    let t = 0;
    await cached('k', 100, load, () => t);
    t = 200;
    expect(await cached('k', 100, load, () => t)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await cached('k', 100, load, () => t)).toBe(1);
  });
});
