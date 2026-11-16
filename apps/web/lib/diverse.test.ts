import { describe, expect, it } from 'vitest';
import type { SkillListItem } from '@skillxone/database';
import { onePerSource } from './diverse';

const skill = (id: string, owner: string, repo: string) =>
  ({ id, owner, repo }) as unknown as SkillListItem;

describe('onePerSource', () => {
  it('keeps order and at most one skill per repository (case-insensitive)', () => {
    const items = [
      skill('a', 'Big', 'repo'),
      skill('b', 'big', 'REPO'),
      skill('c', 'other', 'x'),
      skill('d', 'big', 'repo'),
      skill('e', 'third', 'y'),
    ];
    expect(onePerSource(items, 10).map((s) => s.id)).toEqual(['a', 'c', 'e']);
    expect(onePerSource(items, 2).map((s) => s.id)).toEqual(['a', 'c']);
    expect(onePerSource(items, 10, 2).map((s) => s.id)).toEqual(['a', 'b', 'c', 'e']);
  });
});
