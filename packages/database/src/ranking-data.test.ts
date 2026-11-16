import { describe, expect, it } from 'vitest';
import { starDelta } from './ranking-data';

const snaps = (...pairs: Array<[string, number]>) => pairs.map(([day, stars]) => ({ day, stars }));

describe('starDelta', () => {
  it('is null without snapshots or without one old enough', () => {
    expect(starDelta([], 7)).toBeNull();
    expect(starDelta(snaps(['2026-06-10', 100]), 7)).toBeNull();
    expect(starDelta(snaps(['2026-06-05', 90], ['2026-06-10', 100]), 7)).toBeNull();
  });

  it('subtracts the snapshot from exactly N days earlier', () => {
    expect(starDelta(snaps(['2026-06-03', 80], ['2026-06-10', 100]), 7)).toBe(20);
  });

  it('uses the most recent snapshot that is at least N days old when days are missing', () => {
    const history = snaps(
      ['2026-05-20', 50],
      ['2026-06-01', 70],
      ['2026-06-08', 95],
      ['2026-06-10', 100],
    );
    expect(starDelta(history, 7)).toBe(30); // against 2026-06-01, not the older or newer one
    expect(starDelta(history, 30)).toBeNull(); // nothing is 30 days old; no estimate is made
  });

  it('reports a loss as a negative number', () => {
    expect(starDelta(snaps(['2026-06-01', 100], ['2026-06-10', 90]), 7)).toBe(-10);
  });

  it('handles month and year boundaries', () => {
    expect(starDelta(snaps(['2025-12-28', 10], ['2026-01-04', 15]), 7)).toBe(5);
  });
});
