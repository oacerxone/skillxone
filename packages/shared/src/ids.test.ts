import { describe, expect, it } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('produces 26-character ids', () => {
    expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('sorts in creation order even within one millisecond', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    const ids = Array.from({ length: 500 }, () => newId(at));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
