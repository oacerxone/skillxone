import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  buildExploreQuery,
  parseExploreParams,
  stripProFilters,
  toSkillQuery,
  usesProFilters,
} from './search-params';

describe('parseExploreParams', () => {
  it('returns defaults for an empty query', () => {
    expect(parseExploreParams({})).toEqual(DEFAULT_FILTERS);
  });

  it('accepts valid values', () => {
    expect(
      parseExploreParams({
        q: '  docker  ',
        agent: 'claude-code',
        verification: 'verified',
        category: 'devops',
        sort: 'updated',
        view: 'cards',
        page: '3',
      }),
    ).toEqual({
      q: 'docker',
      agent: 'claude-code',
      verification: 'VERIFIED',
      category: 'devops',
      sort: 'updated',
      minStars: 0,
      license: '',
      noScripts: false,
      updatedDays: 0,
      view: 'cards',
      page: 3,
    });
  });

  it('ignores malformed values instead of passing them on', () => {
    expect(
      parseExploreParams({
        agent: "x' OR 1=1",
        verification: 'trusted',
        category: '../etc',
        sort: 'stars; drop',
        view: 'grid',
        page: '-4',
      }),
    ).toEqual(DEFAULT_FILTERS);
    expect(parseExploreParams({ page: '1e9' }).page).toBe(1);
    expect(parseExploreParams({ page: 'abc' }).page).toBe(1);
  });

  it('takes the first of repeated parameters and bounds the query length', () => {
    expect(parseExploreParams({ q: ['a', 'b'] }).q).toBe('a');
    expect(parseExploreParams({ q: 'x'.repeat(500) }).q).toHaveLength(100);
  });
});

describe('buildExploreQuery', () => {
  it('omits defaults', () => {
    expect(buildExploreQuery(DEFAULT_FILTERS)).toBe('');
  });

  it('round-trips through parse', () => {
    const filters = parseExploreParams({
      q: 'sql review',
      agent: 'codex',
      verification: 'flagged',
      category: 'data',
      sort: 'name',
      view: 'cards',
      page: '2',
    });
    const query = buildExploreQuery(filters);
    expect(query).toBe(
      '?q=sql+review&agent=codex&verification=flagged&category=data&sort=name&view=cards&page=2',
    );
    const reparsed = parseExploreParams(Object.fromEntries(new URLSearchParams(query)));
    expect(reparsed).toEqual(filters);
  });

  it('applies overrides, used for pagination and view links', () => {
    expect(buildExploreQuery({ ...DEFAULT_FILTERS, q: 'a', page: 4 }, { page: 1 })).toBe('?q=a');
  });

  it('encodes special characters', () => {
    expect(buildExploreQuery({ ...DEFAULT_FILTERS, q: 'a&b=c #d' })).toBe('?q=a%26b%3Dc+%23d');
  });
});

describe('Pro filters', () => {
  it('parses only the allowed values', () => {
    const filters = parseExploreParams({
      stars: '100',
      license: 'MIT',
      scripts: 'none',
      updated: '30',
    });
    expect(filters).toMatchObject({
      minStars: 100,
      license: 'MIT',
      noScripts: true,
      updatedDays: 30,
    });
    expect(
      parseExploreParams({ stars: '7', license: "MIT' or 1=1", scripts: 'yes', updated: '2' }),
    ).toMatchObject({ minStars: 0, license: '', noScripts: false, updatedDays: 0 });
  });

  it('round-trips through the query string', () => {
    const filters = parseExploreParams({
      stars: '10',
      license: 'Apache-2.0',
      scripts: 'none',
      updated: '90',
    });
    const query = buildExploreQuery(filters);
    expect(parseExploreParams(Object.fromEntries(new URLSearchParams(query)))).toEqual(filters);
  });

  it('strips every Pro filter and sort but keeps the free ones', () => {
    const filters = parseExploreParams({
      q: 'docker',
      category: 'devops',
      verification: 'verified',
      agent: 'codex',
      sort: 'rising',
      stars: '100',
      license: 'MIT',
      scripts: 'none',
      updated: '30',
    });
    expect(usesProFilters(filters)).toBe(true);
    const free = stripProFilters(filters);
    expect(usesProFilters(free)).toBe(false);
    expect(free).toMatchObject({
      q: 'docker',
      category: 'devops',
      verification: 'VERIFIED',
      sort: '',
    });
    expect(stripProFilters(parseExploreParams({ sort: 'popular' })).sort).toBe('popular');
  });

  it('turns "updated within" into the start of a UTC day', () => {
    const query = toSkillQuery(
      parseExploreParams({ updated: '30' }),
      20,
      new Date('2026-06-15T17:45:00.000Z'),
    );
    expect(query.updatedSince).toBe('2026-05-16T00:00:00.000Z');
  });
});
