import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getCategory,
  getCollection,
  getRepositoryStars,
  getSkillBySlug,
  getSkillFile,
  likePattern,
  listAgentIds,
  listCategories,
  listCollections,
  listRelatedSkills,
  listSkills,
  metricsHistoryDays,
  migrateToLatest,
  openDatabase,
  searchTerms,
  seedCategories,
  seedDevFixtures,
} from './index';
import type { DatabaseHandle } from './index';

let handle: DatabaseHandle;
const NOW = new Date('2026-06-01T12:00:00.000Z');

beforeAll(async () => {
  handle = await openDatabase('file::memory:');
  await migrateToLatest(handle.db);
  await seedCategories(handle.db);
  await seedDevFixtures(handle.db, () => NOW);
});
afterAll(async () => {
  await handle.close();
});

describe('search helpers', () => {
  it('splits and bounds terms', () => {
    expect(searchTerms('  SQL   Review ')).toEqual(['sql', 'review']);
    expect(searchTerms(undefined)).toEqual([]);
    expect(searchTerms(Array.from({ length: 50 }, (_, i) => `t${i}`).join(' '))).toHaveLength(8);
  });

  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('listSkills', () => {
  it('returns every active skill with pagination metadata', async () => {
    const page = await listSkills(handle.db, { pageSize: 10 });
    expect(page.total).toBe(25);
    expect(page.items).toHaveLength(10);
    expect(page.pageCount).toBe(3);
    expect(page.page).toBe(1);
  });

  it('sorts by stars by default and paginates without overlap', async () => {
    const first = await listSkills(handle.db, { pageSize: 10, page: 1 });
    const second = await listSkills(handle.db, { pageSize: 10, page: 2 });
    const third = await listSkills(handle.db, { pageSize: 10, page: 3 });
    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all.map((s) => s.id)).size).toBe(25);
    const stars = all.map((s) => s.stars);
    expect([...stars].sort((a, b) => b - a)).toEqual(stars);
  });

  it('clamps out-of-range pages and page sizes', async () => {
    const page = await listSkills(handle.db, { page: 999, pageSize: 100000 });
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(100);
  });

  it('matches text case-insensitively across name, description and repository', async () => {
    expect((await listSkills(handle.db, { q: 'DOCKERFILE' })).items.map((s) => s.name)).toEqual([
      'dockerfile-reviewer',
    ]);
    expect((await listSkills(handle.db, { q: 'ops-skills' })).total).toBe(4);
    expect((await listSkills(handle.db, { q: 'terraform risky' })).total).toBe(1);
    expect((await listSkills(handle.db, { q: 'terraform nonsense' })).total).toBe(0);
  });

  it('treats wildcard and quote characters in a query literally', async () => {
    expect((await listSkills(handle.db, { q: '%' })).total).toBe(0);
    expect((await listSkills(handle.db, { q: '_' })).total).toBe(0);
    expect((await listSkills(handle.db, { q: "'; DROP TABLE skills; --" })).total).toBe(0);
    expect((await listSkills(handle.db)).total).toBe(25);
  });

  it('filters by verification state, category and agent, alone and combined', async () => {
    const flagged = await listSkills(handle.db, { verification: 'FLAGGED' });
    expect(flagged.items.map((s) => s.name).sort()).toEqual([
      'env-collector',
      'remote-setup-helper',
    ]);

    expect((await listSkills(handle.db, { category: 'devops' })).total).toBe(4);
    const codex = await listSkills(handle.db, { agent: 'codex', pageSize: 100 });
    expect(codex.items.every((s) => s.agents.includes('codex'))).toBe(true);
    expect(codex.total).toBe(21);

    const combined = await listSkills(handle.db, {
      category: 'devops',
      verification: 'VERIFIED',
      agent: 'claude-code',
    });
    expect(combined.items.map((s) => s.name)).toEqual(['dockerfile-reviewer']);
  });

  it('sorts by most recently updated', async () => {
    const page = await listSkills(handle.db, { sort: 'updated', pageSize: 3 });
    expect(page.items[0]?.name).toBe('sql-query-reviewer');
  });
});

describe('categories and collections', () => {
  it('counts skills per category', async () => {
    const categories = await listCategories(handle.db);
    expect(categories.find((c) => c.slug === 'devops')?.skillCount).toBe(4);
    expect(categories.find((c) => c.slug === 'other')?.skillCount).toBe(0);
    expect(await getCategory(handle.db, 'nope')).toBeUndefined();
  });

  it('lists published collections with ordered skills', async () => {
    const collections = await listCollections(handle.db);
    expect(collections.map((c) => c.slug)).toEqual(['getting-started', 'release-checklist']);
    const detail = await getCollection(handle.db, 'getting-started');
    expect(detail?.skills.map((s) => s.name)).toEqual([
      'commit-message-writer',
      'readme-writer',
      'unit-test-planner',
      'pull-request-reviewer',
    ]);
    expect(await getCollection(handle.db, 'missing')).toBeUndefined();
  });
});

describe('getSkillBySlug', () => {
  it('returns a verified skill with version, files, report and compatibility', async () => {
    const skill = await getSkillBySlug(
      handle.db,
      'example-fixture/starter-skills/commit-message-writer',
    );
    expect(skill).toBeDefined();
    expect(skill!.repository.isFixture).toBe(true);
    expect(skill!.currentVersion?.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(skill!.files.map((f) => f.path)).toEqual(['SKILL.md', 'references/guide.md']);
    expect(skill!.skillMarkdown).toContain('name: commit-message-writer');
    expect(skill!.report?.scan.outcome).toBe('PASS');
    expect(skill!.report?.checksRun).toHaveLength(6);
    expect(skill!.report?.checksSkipped[0]?.scanner).toBe('dependencies');
    expect(skill!.verification?.state).toBe('VERIFIED');
    expect(skill!.categories).toEqual([{ slug: 'development', name: 'Development' }]);
    expect(skill!.agents).toEqual(['claude-code', 'codex']);
  });

  it('returns documented findings for a flagged skill', async () => {
    const skill = await getSkillBySlug(handle.db, 'example-fixture/ops-skills/remote-setup-helper');
    expect(skill!.verificationState).toBe('FLAGGED');
    expect(skill!.report?.findings.map((f) => f.severity).sort()).toEqual(['high', 'medium']);
    expect(skill!.report?.findings[0]?.file_path).toBe('scripts/setup.sh');
  });

  it('has no report for an unverified skill', async () => {
    const skill = await getSkillBySlug(
      handle.db,
      'example-fixture/starter-skills/changelog-updater',
    );
    expect(skill!.verificationState).toBe('UNVERIFIED');
    expect(skill!.report).toBeNull();
    expect(skill!.verification).toBeNull();
  });

  it('returns undefined for an unknown slug', async () => {
    expect(await getSkillBySlug(handle.db, 'a/b/c')).toBeUndefined();
  });

  it('keeps current_version_id consistent with skill_versions', async () => {
    const orphans = await handle.db
      .selectFrom('skills as s')
      .leftJoin('skill_versions as v', 'v.id', 's.current_version_id')
      .select('s.id')
      .where('s.current_version_id', 'is not', null)
      .where('v.id', 'is', null)
      .execute();
    expect(orphans).toEqual([]);
  });
});

describe('files, related skills and agents', () => {
  it('reads a stored file and rejects unknown paths', async () => {
    const slug = 'example-fixture/ops-skills/remote-setup-helper';
    expect((await getSkillFile(handle.db, slug, 'scripts/setup.sh'))?.content).toContain('curl');
    expect(await getSkillFile(handle.db, slug, '../../etc/passwd')).toBeUndefined();
  });

  it('suggests related skills from the same category, never flagged ones', async () => {
    const related = await listRelatedSkills(handle.db, 'fixture_skill_dockerfile-reviewer');
    expect(related.length).toBeGreaterThan(0);
    expect(related.map((s) => s.name)).not.toContain('dockerfile-reviewer');
    expect(related.every((s) => s.verificationState !== 'FLAGGED')).toBe(true);
  });

  it('lists agents and reports no metrics history for fixtures', async () => {
    expect(await listAgentIds(handle.db)).toEqual(['claude-code', 'codex']);
    expect(await metricsHistoryDays(handle.db)).toBe(0);
  });
});

describe('getRepositoryStars', () => {
  it('returns stored stars case-insensitively, or null when not indexed', async () => {
    expect(await getRepositoryStars(handle.db, 'Example-Fixture', 'OPS-skills')).toBe(312);
    expect(await getRepositoryStars(handle.db, 'nobody', 'nothing')).toBeNull();
  });
});
