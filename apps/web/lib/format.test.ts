import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatDate, highlightSegments, relativeTime } from './format';

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [950, '950'],
    [1000, '1k'],
    [1240, '1.2k'],
    [9999, '9.9k'],
    [12_500, '12k'],
    [2_340_000, '2.3M'],
  ])('%d -> %s', (input, expected) => {
    expect(formatCount(input)).toBe(expected);
  });
});

describe('dates', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  it('formats relative times', () => {
    expect(relativeTime('2026-06-10T11:59:50.000Z', now)).toBe('just now');
    expect(relativeTime('2026-06-10T11:00:00.000Z', now)).toBe('1 hour ago');
    expect(relativeTime('2026-06-07T12:00:00.000Z', now)).toBe('3 days ago');
    expect(relativeTime('2026-03-10T12:00:00.000Z', now)).toBe('3 months ago');
    expect(relativeTime('2024-06-10T12:00:00.000Z', now)).toBe('2 years ago');
  });
  it('handles missing and invalid input', () => {
    expect(relativeTime(null, now)).toBe('unknown');
    expect(relativeTime('nonsense', now)).toBe('unknown');
    expect(formatDate(undefined)).toBe('unknown');
    expect(formatDate('2026-06-01T23:59:59.000Z')).toBe('2026-06-01');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('highlightSegments', () => {
  it('marks case-insensitive matches', () => {
    expect(highlightSegments('SQL query reviewer', ['sql', 'REVIEW'])).toEqual([
      { text: 'SQL', match: true },
      { text: ' query ', match: false },
      { text: 'review', match: true },
      { text: 'er', match: false },
    ]);
  });
  it('merges overlapping matches', () => {
    expect(highlightSegments('abcdef', ['abc', 'bcd'])).toEqual([
      { text: 'abcd', match: true },
      { text: 'ef', match: false },
    ]);
  });
  it('returns the text unchanged without terms', () => {
    expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('abc', ['  '])).toEqual([{ text: 'abc', match: false }]);
  });
  it('treats regular-expression characters literally', () => {
    expect(highlightSegments('a.c abc', ['a.c'])).toEqual([
      { text: 'a.c', match: true },
      { text: ' abc', match: false },
    ]);
  });
});
