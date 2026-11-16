import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminOverview,
  createReport,
  createSession,
  createSubmission,
  deleteSession,
  findSession,
  hashIp,
  ipHashSecret,
  listAudit,
  loadRankingFacts,
  migrateToLatest,
  openDatabase,
  resolveReport,
  reviewFinding,
  reviewSubmission,
  seedCategories,
  seedDevFixtures,
  setSkillVisibility,
  upsertGitHubUser,
} from './index';
import type { DatabaseHandle } from './index';

let handle: DatabaseHandle;
const NOW = new Date('2026-06-01T00:00:00.000Z');

beforeEach(async () => {
  handle = await openDatabase('file::memory:');
  await migrateToLatest(handle.db);
  await seedCategories(handle.db);
  await seedDevFixtures(handle.db);
});
afterEach(() => handle.close());

const admin = () =>
  upsertGitHubUser(
    handle.db,
    { githubId: 42, login: 'octo-admin', avatarUrl: null, role: 'admin' },
    NOW,
  );
const skillId = async (name: string) =>
  (
    await handle.db
      .selectFrom('skills')
      .select('id')
      .where('name', '=', name)
      .executeTakeFirstOrThrow()
  ).id;

describe('sessions', () => {
  it('store only a hash of the token and expire', async () => {
    const user = await admin();
    const { token, csrfSecret } = await createSession(handle.db, user.id, NOW);
    const stored = await handle.db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
    expect(stored.token_hash).not.toContain(token);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const found = await findSession(handle.db, token, NOW);
    expect(found).toMatchObject({ csrfSecret, user: { login: 'octo-admin', role: 'admin' } });
    expect(
      await findSession(handle.db, token, new Date(NOW.getTime() + 8 * 86_400_000)),
    ).toBeNull();
    expect(await findSession(handle.db, 'not a token', NOW)).toBeNull();
    expect(await findSession(handle.db, 'x'.repeat(43), NOW)).toBeNull();

    await deleteSession(handle.db, found!.sessionId);
    expect(await findSession(handle.db, token, NOW)).toBeNull();
  });

  it('refuse a disabled user and follow role changes on next login', async () => {
    const user = await admin();
    const { token } = await createSession(handle.db, user.id, NOW);
    const demoted = await upsertGitHubUser(
      handle.db,
      { githubId: 42, login: 'octo-admin', avatarUrl: null, role: 'user' },
      NOW,
    );
    expect(demoted.id).toBe(user.id);
    expect((await findSession(handle.db, token, NOW))?.user.role).toBe('user');
    await handle.db
      .updateTable('users')
      .set({ is_disabled: 1 })
      .where('id', '=', user.id)
      .execute();
    expect(await findSession(handle.db, token, NOW)).toBeNull();
  });
});

describe('submissions', () => {
  it('return the existing record for a duplicate, case-insensitively', async () => {
    const first = await createSubmission(
      handle.db,
      { owner: 'Some-Org', repo: 'Skills', note: 'Useful', submitterId: null, ipHash: 'h1' },
      NOW,
    );
    expect(first).toMatchObject({
      created: true,
      alreadyIndexed: false,
      submission: { status: 'pending', repo_full_name_lower: 'some-org/skills' },
    });
    const again = await createSubmission(
      handle.db,
      { owner: 'some-org', repo: 'skills', note: null, submitterId: null, ipHash: 'h2' },
      NOW,
    );
    expect(again).toMatchObject({ created: false });
    expect(again.submission.id).toBe(first.submission.id);
  });

  it('mark an already indexed repository as a duplicate', async () => {
    const result = await createSubmission(
      handle.db,
      { owner: 'example-fixture', repo: 'ops-skills', note: null, submitterId: null, ipHash: null },
      NOW,
    );
    expect(result).toMatchObject({
      created: true,
      alreadyIndexed: true,
      submission: { status: 'duplicate' },
    });
    expect(result.submission.repository_id).not.toBeNull();
  });

  it('allow resubmitting after a rejection, and audit every review', async () => {
    const user = await admin();
    const { submission } = await createSubmission(
      handle.db,
      { owner: 'a', repo: 'b', note: null, submitterId: null, ipHash: null },
      NOW,
    );
    await reviewSubmission(
      handle.db,
      { id: submission.id, status: 'rejected', note: 'Not skills', actorId: user.id, ipHash: null },
      NOW,
    );
    const second = await createSubmission(
      handle.db,
      { owner: 'a', repo: 'b', note: null, submitterId: null, ipHash: null },
      NOW,
    );
    expect(second.created).toBe(true);
    const audit = await listAudit(handle.db);
    expect(audit[0]).toMatchObject({
      action: 'submission.reject',
      target_id: submission.id,
      actor_login: 'octo-admin',
    });
    expect(JSON.parse(audit[0]!.after_json!)).toEqual({ status: 'rejected', note: 'Not skills' });
  });
});

describe('reports', () => {
  it('validate the skill and finding, and de-duplicate per reporter', async () => {
    const id = await skillId('remote-setup-helper');
    const finding = await handle.db
      .selectFrom('security_findings as f')
      .innerJoin('security_scans as sc', 'sc.id', 'f.scan_id')
      .select('f.id')
      .where('sc.skill_id', '=', id)
      .executeTakeFirstOrThrow();
    const base = {
      type: 'false_positive' as const,
      skillId: id,
      findingId: finding.id,
      body: 'This is the official installer.',
      contact: null,
      reporterId: null,
      ipHash: 'h1',
    };

    const first = await createReport(handle.db, base, NOW);
    expect(first).toMatchObject({ created: true });
    expect(await createReport(handle.db, base, NOW)).toMatchObject({ created: false });
    expect(await createReport(handle.db, { ...base, ipHash: 'h2' }, NOW)).toMatchObject({
      created: true,
    });
    expect(await createReport(handle.db, { ...base, skillId: 'nope' }, NOW)).toEqual({
      error: 'unknown_skill',
    });
    expect(await createReport(handle.db, { ...base, findingId: 'nope' }, NOW)).toEqual({
      error: 'unknown_finding',
    });
    const other = await skillId('dockerfile-reviewer');
    expect(await createReport(handle.db, { ...base, skillId: other }, NOW)).toEqual({
      error: 'unknown_finding',
    });
  });

  it('only count against ranking once a moderator triages them', async () => {
    const user = await admin();
    const id = await skillId('dockerfile-reviewer');
    const created = await createReport(
      handle.db,
      {
        type: 'security_concern',
        skillId: id,
        findingId: null,
        body: 'Looks suspicious to me.',
        contact: null,
        reporterId: null,
        ipHash: 'h',
      },
      NOW,
    );
    const reportsFor = async () =>
      (await loadRankingFacts(handle.db, NOW)).find((f) => f.skillId === id)!.openReports;
    expect(await reportsFor()).toBe(0);
    await resolveReport(
      handle.db,
      {
        id: ('report' in created ? created.report : null)!.id,
        status: 'triaged',
        note: null,
        actorId: user.id,
        ipHash: null,
      },
      NOW,
    );
    expect(await reportsFor()).toBe(1);
  });
});

describe('moderation', () => {
  it('reviews a finding across stored copies and hides skills, with audit', async () => {
    const user = await admin();
    const id = await skillId('remote-setup-helper');
    const finding = await handle.db
      .selectFrom('security_findings as f')
      .innerJoin('security_scans as sc', 'sc.id', 'f.scan_id')
      .select(['f.id', 'f.fingerprint'])
      .where('sc.skill_id', '=', id)
      .executeTakeFirstOrThrow();
    const target = await reviewFinding(
      handle.db,
      {
        findingId: finding.id,
        status: 'false_positive',
        note: 'Documented installer',
        actorId: user.id,
        ipHash: null,
      },
      NOW,
    );
    expect(target?.skillId).toBe(id);
    const stored = await handle.db
      .selectFrom('security_findings')
      .selectAll()
      .where('id', '=', finding.id)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({
      status: 'false_positive',
      review_note: 'Documented installer',
      reviewed_by: user.id,
    });

    expect(
      await setSkillVisibility(
        handle.db,
        { skillId: id, hidden: true, note: 'Takedown request', actorId: user.id, ipHash: null },
        NOW,
      ),
    ).toBe(true);
    expect((await adminOverview(handle.db)).hiddenSkills).toBe(1);
    expect((await listAudit(handle.db)).map((a) => a.action)).toEqual([
      'skill.hide',
      'finding.review',
    ]);
  });
});

describe('IP hashing', () => {
  it('uses a stable generated secret and never stores the address', async () => {
    const secret = await ipHashSecret(handle.db, NOW);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await ipHashSecret(handle.db, NOW)).toBe(secret);
    const hash = hashIp('203.0.113.9', secret);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain('203');
    expect(hashIp('203.0.113.9', secret)).toBe(hash);
  });
});
