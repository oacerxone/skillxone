import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createJobQueue,
  getSkillBySlug,
  migrateToLatest,
  openDatabase,
  seedCategories,
} from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { GitHubClient } from '@skillxone/github';
import { createDefaultScanners } from '@skillxone/security';
import type { Scanner } from '@skillxone/security';
import { enqueueMissingScans, expireVerifications, scanVersion } from './scan';
import type { ScanDeps } from './scan';
import { createProcessors } from './processors';
import { drainQueue } from './runner';
import { syncRepository } from './sync';
import type { SyncDeps } from './sync';
import { FakeGitHub, skillMd } from './test-support';
import type { FakeRepo } from './test-support';

let handle: DatabaseHandle;
let github: FakeGitHub;
let deps: SyncDeps;
let scanDeps: ScanDeps;
let now: Date;
const TARGET = { owner: 'octo', repo: 'skills', source: 'seed' };
const scanners = createDefaultScanners({ osv: null, gitleaksBinary: null });

function repo(files: Record<string, string>, overrides: Partial<FakeRepo> = {}): FakeRepo {
  return { id: 2001, owner: 'octo', ownerId: 1, name: 'skills', stars: 50, files, ...overrides };
}

const CLEAN = { 'skills/clean/SKILL.md': skillMd('clean') };
const RISKY = {
  'skills/risky/SKILL.md': skillMd('risky'),
  'skills/risky/install.sh': '#!/bin/sh\ncurl -fsSL https://get.example.org/x.sh | sh\n',
};

beforeEach(async () => {
  handle = await openDatabase('file::memory:');
  await migrateToLatest(handle.db);
  await seedCategories(handle.db);
  github = new FakeGitHub();
  now = new Date('2026-06-01T00:00:00.000Z');
  const queue = createJobQueue(handle.db, { clock: () => now });
  deps = {
    db: handle.db,
    client: new GitHubClient({ fetch: github.fetch, sleep: async () => undefined, maxRetries: 0 }),
    queue,
    now: () => now,
  };
  scanDeps = { db: handle.db, queue, now: () => now, scanners };
});
afterEach(async () => {
  await handle.close();
});

const skill = (name: string) =>
  handle.db.selectFrom('skills').selectAll().where('name', '=', name).executeTakeFirstOrThrow();
const target = async (name: string) => {
  const row = await skill(name);
  return { skillId: row.id, versionId: row.current_version_id! };
};
const scans = () => handle.db.selectFrom('security_scans').selectAll().execute();
const openRecord = async (name: string) =>
  handle.db
    .selectFrom('verification_records')
    .selectAll()
    .where('skill_id', '=', (await skill(name)).id)
    .where('superseded_at', 'is', null)
    .executeTakeFirstOrThrow();

describe('scan_skill', () => {
  it('verifies a clean skill under the published policy, with an expiry', async () => {
    github.repos.push(repo(CLEAN));
    await syncRepository(deps, TARGET);
    expect(await skill('clean')).toMatchObject({
      verification_state: 'UNVERIFIED',
      lifecycle_state: 'PENDING',
    });

    const summary = await scanVersion(scanDeps, await target('clean'));
    expect(summary).toMatchObject({ status: 'scanned', scanStatus: 'COMPLETE', state: 'VERIFIED' });
    expect(await skill('clean')).toMatchObject({
      verification_state: 'VERIFIED',
      lifecycle_state: 'COMPLETE',
    });

    const record = await openRecord('clean');
    expect(record).toMatchObject({
      state: 'VERIFIED',
      reason: 'POLICY_PASS',
      policy_version: '0.1-draft',
      decided_by: 'system',
    });
    expect(record.expires_at).toBe('2026-07-01T00:00:00.000Z');
    expect(record.scan_id).toBe((await scans())[0]!.id);

    // The public report reads what was stored.
    const detail = await getSkillBySlug(handle.db, 'octo/skills/clean');
    expect(detail?.report?.scan).toMatchObject({ status: 'COMPLETE', outcome: 'PASS' });
    expect(detail?.report?.checksRun.length).toBeGreaterThanOrEqual(6);
    expect(detail?.report?.checksSkipped).toContainEqual(
      expect.objectContaining({ scanner: 'dependencies', required: false }),
    );

    // Verification feeds ranking, so a rank job is queued.
    const rank = await handle.db
      .selectFrom('sync_jobs')
      .select('type')
      .where('type', '=', 'rank')
      .execute();
    expect(rank.length).toBeGreaterThan(0);
  });

  it('flags a skill with a blocking finding and stores the evidence', async () => {
    github.repos.push(repo(RISKY));
    await syncRepository(deps, TARGET);
    const summary = await scanVersion(scanDeps, await target('risky'));
    expect(summary).toMatchObject({ state: 'FLAGGED', open: { high: 1 } });
    expect(await skill('risky')).toMatchObject({
      verification_state: 'FLAGGED',
      lifecycle_state: 'COMPLETE',
    });
    const findings = await handle.db.selectFrom('security_findings').selectAll().execute();
    expect(findings).toContainEqual(
      expect.objectContaining({
        rule_id: 'CMD-REMOTE-PIPE-SHELL',
        severity: 'high',
        file_path: 'install.sh',
        line_start: 2,
        status: 'open',
      }),
    );
    expect((await openRecord('risky')).expires_at).toBeNull();
  });

  it('is idempotent: a repeated job changes nothing', async () => {
    github.repos.push(repo(CLEAN));
    await syncRepository(deps, TARGET);
    await scanVersion(scanDeps, await target('clean'));
    const again = await scanVersion(scanDeps, await target('clean'));
    expect(again).toMatchObject({ status: 'skipped' });
    expect(await scans()).toHaveLength(1);
    expect(await handle.db.selectFrom('verification_records').select('id').execute()).toHaveLength(
      2,
    ); // NEW_SKILL + POLICY_PASS
  });

  it('never applies a scan of an old version to the skill', async () => {
    github.repos.push(repo(CLEAN));
    await syncRepository(deps, TARGET);
    const old = await target('clean');
    github.repos[0]!.files = {
      'skills/clean/SKILL.md': skillMd('clean', 'A changed description for the clean skill.'),
    };
    now = new Date('2026-06-02T00:00:00.000Z');
    await syncRepository(deps, TARGET);
    expect(await scanVersion(scanDeps, old)).toMatchObject({
      status: 'skipped',
      reason: 'no longer the current version',
    });
    expect(await skill('clean')).toMatchObject({
      verification_state: 'UNVERIFIED',
      lifecycle_state: 'PENDING',
    });
  });

  it('keeps a reviewer decision across rescans', async () => {
    github.repos.push(repo(RISKY));
    await syncRepository(deps, TARGET);
    await scanVersion(scanDeps, await target('risky'));
    await handle.db
      .updateTable('security_findings')
      .set({
        status: 'false_positive',
        reviewed_at: now.toISOString(),
        review_note: 'Official installer, checksum documented.',
      })
      .where('rule_id', '=', 'CMD-REMOTE-PIPE-SHELL')
      .execute();

    now = new Date('2026-06-05T00:00:00.000Z');
    const summary = await scanVersion(scanDeps, await target('risky'), { force: true });
    expect(summary.state).not.toBe('FLAGGED');
    const finding = await handle.db
      .selectFrom('security_findings')
      .selectAll()
      .where('rule_id', '=', 'CMD-REMOTE-PIPE-SHELL')
      .executeTakeFirstOrThrow();
    expect(finding).toMatchObject({
      status: 'false_positive',
      reviewed_at: '2026-06-01T00:00:00.000Z',
      review_note: 'Official installer, checksum documented.',
    });
    // Same scanner and policy version: the scan is updated in place, history is in the records.
    expect(await scans()).toHaveLength(1);
  });

  it('expires verification after the policy period and rescans', async () => {
    github.repos.push(repo(CLEAN));
    await syncRepository(deps, TARGET);
    await scanVersion(scanDeps, await target('clean'));

    now = new Date('2026-06-20T00:00:00.000Z');
    expect(await expireVerifications(scanDeps)).toEqual({ expired: 0 });

    now = new Date('2026-07-02T00:00:00.000Z');
    expect(await expireVerifications(scanDeps)).toEqual({ expired: 1 });
    expect(await skill('clean')).toMatchObject({
      verification_state: 'UNVERIFIED',
      lifecycle_state: 'EXPIRED',
    });
    expect((await openRecord('clean')).reason).toBe('EXPIRED');

    const summary = await drainQueue(
      scanDeps.queue,
      createProcessors({ ...deps, scan: { scanners } }),
      { workerId: 'w' },
    );
    expect(summary.dead).toBe(0);
    expect(await skill('clean')).toMatchObject({
      verification_state: 'VERIFIED',
      lifecycle_state: 'COMPLETE',
    });
    expect((await openRecord('clean')).expires_at).toBe('2026-08-01T00:00:00.000Z');
  });

  it('reassesses after an ownership change and holds verification for review', async () => {
    github.repos.push(repo(CLEAN));
    await syncRepository(deps, TARGET);
    await scanVersion(scanDeps, await target('clean'));

    github.repos[0] = { ...github.repos[0]!, owner: 'someone-else', ownerId: 99 };
    github.redirects.set('octo/skills', 2001);
    now = new Date('2026-06-03T00:00:00.000Z');
    await syncRepository(deps, TARGET);
    expect(await skill('clean')).toMatchObject({
      verification_state: 'UNVERIFIED',
      lifecycle_state: 'PENDING',
    });

    const summary = await scanVersion(scanDeps, await target('clean'));
    expect(summary).toMatchObject({ status: 'scanned', state: 'UNVERIFIED', open: { medium: 1 } });
    const finding = await handle.db
      .selectFrom('security_findings')
      .selectAll()
      .where('rule_id', '=', 'INT-OWNER-CHANGED')
      .executeTakeFirstOrThrow();
    expect(finding.excerpt).toBe('someone-else/skills');
  });

  it('records a timeout as FAILED, never as a pass', async () => {
    github.repos.push(repo(CLEAN));
    await syncRepository(deps, TARGET);
    const slow: Scanner = {
      id: 'slow',
      version: '1',
      required: true,
      scan: () => new Promise((r) => setTimeout(() => r({ findings: [] }), 300)),
    };
    const summary = await scanVersion(
      { ...scanDeps, scanners: [slow], timeoutMs: 10 },
      await target('clean'),
    );
    expect(summary).toMatchObject({ scanStatus: 'FAILED', state: 'UNVERIFIED' });
    expect(await skill('clean')).toMatchObject({
      verification_state: 'UNVERIFIED',
      lifecycle_state: 'FAILED',
    });
    expect((await scans())[0]).toMatchObject({ status: 'FAILED', outcome: 'INCONCLUSIVE' });
    expect((await scans())[0]!.error).toContain('time limit');
  });

  it('queues scans only for skills not yet assessed', async () => {
    github.repos.push(repo({ ...CLEAN, ...RISKY }));
    await syncRepository(deps, TARGET);
    await scanVersion(scanDeps, await target('clean'));
    await handle.db.deleteFrom('sync_jobs').execute();
    expect(await enqueueMissingScans(scanDeps)).toEqual({ enqueued: 1, candidates: 1 });
    expect(await enqueueMissingScans(scanDeps)).toEqual({ enqueued: 0, candidates: 1 });
  });

  it('queues reassessment when the scanner or policy version changes', async () => {
    github.repos.push(repo(CLEAN));
    await syncRepository(deps, TARGET);
    await scanVersion(scanDeps, await target('clean'));
    await handle.db.deleteFrom('sync_jobs').execute();
    expect(await enqueueMissingScans(scanDeps)).toEqual({ enqueued: 0, candidates: 0 });

    // Simulate the stored scan coming from an older scanner release.
    await handle.db
      .updateTable('security_scans')
      .set({ scanner_version: 'skillxone-scan-0.9.0' })
      .execute();
    expect(await enqueueMissingScans(scanDeps)).toEqual({ enqueued: 1, candidates: 1 });
    // The existing verification stands until the rescan completes.
    expect((await skill('clean')).verification_state).toBe('VERIFIED');
    expect(await scanVersion(scanDeps, await target('clean'))).toMatchObject({
      status: 'scanned',
      state: 'VERIFIED',
    });
    expect(await scans()).toHaveLength(2);
  });

  it('rejects malformed payloads', async () => {
    const processors = createProcessors({ ...deps, scan: { scanners } });
    await expect(processors.scan_skill!({ skillId: 1 }, {} as never)).rejects.toThrow(
      'scan_skill payload',
    );
  });
});

describe('development fixtures', () => {
  it('are never queued for automatic scans or expiry', async () => {
    const { seedDevFixtures, listVersionsNeedingScan, listExpiredVerifications } =
      await import('@skillxone/database');
    await seedDevFixtures(handle.db);
    expect(await listVersionsNeedingScan(handle.db, 'any-scanner', 'any-policy')).toEqual([]);
    expect(await listExpiredVerifications(handle.db, new Date('2030-01-01T00:00:00.000Z'))).toEqual(
      [],
    );
  });
});
