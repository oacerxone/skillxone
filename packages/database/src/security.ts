import type { Kysely } from 'kysely';
import { DEV_FIXTURE_SOURCE, newId, toIso } from '@skillxone/shared';
import type { LifecycleState, Severity, VerificationState } from '@skillxone/shared';
import type { Database, FindingCategory, SkillFilesTable } from './types';

/**
 * Storage for security assessments. The scanner itself lives in packages/security and never
 * touches the database; these functions load what it needs and store what it reports.
 *
 * A scan is identified by (version, scanner version, policy version). Rescanning the same
 * identity (after expiry, or after a reviewer's decision) replaces that scan's findings in
 * place, carrying review decisions over by fingerprint. Every decision is kept separately in
 * `verification_records`, which is the history shown on the site.
 */

type Db = Kysely<Database>;

export interface StoredScanFile {
  path: string;
  kind: SkillFilesTable['kind'];
  content: string | null;
  sizeBytes: number;
  isExecutable: boolean;
  isBinary: boolean;
  blobSha: string;
  truncated: boolean;
}

export interface ScanTarget {
  skillId: string;
  versionId: string;
  commitSha: string;
  contentHash: string;
  /** True when this version is still the skill's current version. */
  isCurrent: boolean;
  files: StoredScanFile[];
  license: string | null;
  previousFiles: Array<Pick<StoredScanFile, 'path' | 'blobSha' | 'kind'>> | undefined;
  suppressed: Map<string, 'false_positive' | 'accepted'>;
  ownerChangedTo: string | null;
}

/** Everything the scanner needs for one version, or null if the version no longer exists. */
export async function loadScanTarget(db: Db, versionId: string): Promise<ScanTarget | null> {
  const version = await db
    .selectFrom('skill_versions as v')
    .innerJoin('skills as s', 's.id', 'v.skill_id')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .select([
      'v.id',
      'v.skill_id',
      'v.commit_sha',
      'v.content_hash',
      's.current_version_id',
      's.license',
      'r.license_spdx',
      'r.owner',
      'r.name as repo_name',
    ])
    .where('v.id', '=', versionId)
    .executeTakeFirst();
  if (!version) return null;

  const toFile = (row: {
    path: string;
    kind: SkillFilesTable['kind'];
    content: string | null;
    size_bytes: number;
    is_executable: number;
    is_binary: number;
    blob_sha: string;
    truncated: number;
  }): StoredScanFile => ({
    path: row.path,
    kind: row.kind,
    content: row.content,
    sizeBytes: Number(row.size_bytes),
    isExecutable: Number(row.is_executable) === 1,
    isBinary: Number(row.is_binary) === 1,
    blobSha: row.blob_sha,
    truncated: Number(row.truncated) === 1,
  });

  const files = (
    await db
      .selectFrom('skill_files')
      .select([
        'path',
        'kind',
        'content',
        'size_bytes',
        'is_executable',
        'is_binary',
        'blob_sha',
        'truncated',
      ])
      .where('version_id', '=', versionId)
      .orderBy('path')
      .execute()
  ).map(toFile);

  const records = await db
    .selectFrom('verification_records')
    .select(['version_id', 'state', 'reason', 'valid_from'])
    .where('skill_id', '=', version.skill_id)
    .orderBy('valid_from', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const lastVerified = records.find((record) => record.state === 'VERIFIED');

  let previousFiles: ScanTarget['previousFiles'];
  if (lastVerified && lastVerified.version_id !== versionId) {
    previousFiles = (
      await db
        .selectFrom('skill_files')
        .select(['path', 'blob_sha', 'kind'])
        .where('version_id', '=', lastVerified.version_id)
        .execute()
    ).map((row) => ({ path: row.path, blobSha: row.blob_sha, kind: row.kind }));
  }

  // An ownership change after the last verification stays relevant until a reviewer accepts it.
  const ownerChanged = records.some(
    (record) =>
      record.reason === 'OWNER_CHANGED' &&
      (!lastVerified || record.valid_from > lastVerified.valid_from),
  );

  const reviewed = await db
    .selectFrom('security_findings as f')
    .innerJoin('security_scans as sc', 'sc.id', 'f.scan_id')
    .select(['f.fingerprint', 'f.status'])
    .where('sc.skill_id', '=', version.skill_id)
    .where('f.status', '!=', 'open')
    .execute();
  const suppressed = new Map<string, 'false_positive' | 'accepted'>();
  for (const row of reviewed) {
    if (row.status === 'false_positive' || row.status === 'accepted')
      suppressed.set(row.fingerprint, row.status);
  }

  return {
    skillId: version.skill_id,
    versionId: version.id,
    commitSha: version.commit_sha,
    contentHash: version.content_hash,
    isCurrent: version.current_version_id === version.id,
    files,
    license: version.license ?? version.license_spdx,
    previousFiles,
    suppressed,
    ownerChangedTo: ownerChanged ? `${version.owner}/${version.repo_name}` : null,
  };
}

export async function hasCompletedScan(
  db: Db,
  versionId: string,
  scannerVersion: string,
  policyVersion: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('security_scans')
    .select('id')
    .where('version_id', '=', versionId)
    .where('scanner_version', '=', scannerVersion)
    .where('policy_version', '=', policyVersion)
    .where('status', '=', 'COMPLETE')
    .executeTakeFirst();
  return row !== undefined;
}

/** Shows the scan as running on the skill page. Only touches the current version. */
export async function markScanning(
  db: Db,
  skillId: string,
  versionId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('skills')
    .set({ lifecycle_state: 'SCANNING', updated_at: toIso(now) })
    .where('id', '=', skillId)
    .where('current_version_id', '=', versionId)
    .execute();
}

export interface FindingToStore {
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  excerpt: string | null;
  explanation: string;
  remediation: string;
  fingerprint: string;
  status: 'open' | 'false_positive' | 'accepted';
}

export interface ScanResultToStore {
  skillId: string;
  versionId: string;
  commitSha: string;
  contentHash: string;
  scannerVersion: string;
  policyVersion: string;
  status: 'COMPLETE' | 'FAILED';
  outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  checksRun: unknown[];
  checksSkipped: unknown[];
  error: string | null;
  findings: FindingToStore[];
  startedAt: Date;
  finishedAt: Date;
  decision: {
    state: VerificationState;
    lifecycle: LifecycleState;
    reason: string;
    summary: string;
    expiresAt: Date | null;
  };
}

/**
 * Stores a scan, its findings and the resulting verification decision in one transaction.
 * The skill's state changes only if the scanned version is still current, so a slow scan of
 * an old version can never overwrite the state of a newer one. Safe to call twice.
 */
export async function saveScanResult(
  db: Db,
  result: ScanResultToStore,
): Promise<{ scanId: string; applied: boolean }> {
  const finishedIso = toIso(result.finishedAt);
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('security_scans')
      .select('id')
      .where('version_id', '=', result.versionId)
      .where('scanner_version', '=', result.scannerVersion)
      .where('policy_version', '=', result.policyVersion)
      .executeTakeFirst();

    const values = {
      skill_id: result.skillId,
      version_id: result.versionId,
      commit_sha: result.commitSha,
      content_hash: result.contentHash,
      scanner_version: result.scannerVersion,
      policy_version: result.policyVersion,
      status: result.status,
      outcome: result.outcome,
      checks_run_json: JSON.stringify(result.checksRun),
      checks_skipped_json: JSON.stringify(result.checksSkipped),
      error: result.error,
      started_at: toIso(result.startedAt),
      finished_at: finishedIso,
    };

    // Review notes from the earlier scan of this identity carry over by fingerprint.
    const reviews = new Map<
      string,
      { reviewed_by: string | null; reviewed_at: string | null; review_note: string | null }
    >();
    let scanId: string;
    if (existing) {
      scanId = existing.id;
      const old = await trx
        .selectFrom('security_findings')
        .select(['fingerprint', 'reviewed_by', 'reviewed_at', 'review_note'])
        .where('scan_id', '=', scanId)
        .where('status', '!=', 'open')
        .execute();
      for (const row of old) reviews.set(row.fingerprint, row);
      await trx.deleteFrom('security_findings').where('scan_id', '=', scanId).execute();
      await trx.updateTable('security_scans').set(values).where('id', '=', scanId).execute();
    } else {
      scanId = newId(result.finishedAt);
      await trx
        .insertInto('security_scans')
        .values({ id: scanId, ...values, created_at: finishedIso })
        .execute();
    }

    if (result.findings.length > 0) {
      const rows = result.findings.map((finding) => ({
        id: newId(result.finishedAt),
        scan_id: scanId,
        rule_id: finding.ruleId,
        category: finding.category,
        severity: finding.severity,
        file_path: finding.filePath,
        line_start: finding.lineStart,
        line_end: finding.lineEnd,
        excerpt: finding.excerpt,
        explanation: finding.explanation,
        remediation: finding.remediation,
        fingerprint: finding.fingerprint,
        status: finding.status,
        ...(finding.status !== 'open'
          ? (reviews.get(finding.fingerprint) ?? {})
          : { reviewed_by: null, reviewed_at: null, review_note: null }),
      }));
      // Chunked so large reports stay under SQLite's bound-parameter limit.
      for (let start = 0; start < rows.length; start += 50) {
        await trx
          .insertInto('security_findings')
          .values(rows.slice(start, start + 50))
          .execute();
      }
    }

    const skill = await trx
      .selectFrom('skills')
      .select('current_version_id')
      .where('id', '=', result.skillId)
      .executeTakeFirst();
    if (skill?.current_version_id !== result.versionId) return { scanId, applied: false };

    await trx
      .updateTable('verification_records')
      .set({ superseded_at: finishedIso })
      .where('skill_id', '=', result.skillId)
      .where('superseded_at', 'is', null)
      .execute();
    await trx
      .insertInto('verification_records')
      .values({
        id: newId(result.finishedAt),
        skill_id: result.skillId,
        version_id: result.versionId,
        scan_id: scanId,
        state: result.decision.state,
        reason: result.decision.reason,
        policy_version: result.policyVersion,
        decided_by: 'system',
        note: result.decision.summary.slice(0, 1000),
        valid_from: finishedIso,
        expires_at: result.decision.expiresAt ? toIso(result.decision.expiresAt) : null,
      })
      .execute();
    await trx
      .updateTable('skills')
      .set({
        verification_state: result.decision.state,
        lifecycle_state: result.decision.lifecycle,
        updated_at: finishedIso,
      })
      .where('id', '=', result.skillId)
      .execute();
    return { scanId, applied: true };
  });
}

/** Current versions whose verification has passed its expiry date. */
export async function listExpiredVerifications(
  db: Db,
  now: Date,
): Promise<Array<{ skillId: string; versionId: string }>> {
  const rows = await db
    .selectFrom('verification_records as v')
    .innerJoin('skills as s', 's.id', 'v.skill_id')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .select(['v.skill_id', 'v.version_id'])
    // Development fixtures keep their hand-made states; they are never rescanned automatically.
    .where('r.discovery_source', '!=', DEV_FIXTURE_SOURCE)
    .where('v.superseded_at', 'is', null)
    .where('v.state', '=', 'VERIFIED')
    .where('v.expires_at', '<=', toIso(now))
    .where('s.status', '=', 'active')
    .whereRef('s.current_version_id', '=', 'v.version_id')
    .execute();
  return rows.map((row) => ({ skillId: row.skill_id, versionId: row.version_id }));
}

/** Ends an expired verification: the skill becomes UNVERIFIED / EXPIRED until rescanned. */
export async function expireVerification(
  db: Db,
  skillId: string,
  versionId: string,
  now: Date,
): Promise<boolean> {
  const nowIso = toIso(now);
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('verification_records')
      .select(['id', 'scan_id', 'policy_version'])
      .where('skill_id', '=', skillId)
      .where('version_id', '=', versionId)
      .where('superseded_at', 'is', null)
      .where('state', '=', 'VERIFIED')
      .where('expires_at', '<=', nowIso)
      .executeTakeFirst();
    if (!current) return false;
    await trx
      .updateTable('verification_records')
      .set({ superseded_at: nowIso })
      .where('id', '=', current.id)
      .execute();
    await trx
      .insertInto('verification_records')
      .values({
        id: newId(now),
        skill_id: skillId,
        version_id: versionId,
        scan_id: current.scan_id,
        state: 'UNVERIFIED',
        reason: 'EXPIRED',
        policy_version: current.policy_version,
        decided_by: 'system',
        note: 'The verification period ended; a rescan has been queued.',
        valid_from: nowIso,
      })
      .execute();
    await trx
      .updateTable('skills')
      .set({ verification_state: 'UNVERIFIED', lifecycle_state: 'EXPIRED', updated_at: nowIso })
      .where('id', '=', skillId)
      .execute();
    return true;
  });
}

/** Current versions with no complete scan under the given scanner and policy versions. */
export async function listVersionsNeedingScan(
  db: Db,
  scannerVersion: string,
  policyVersion: string,
  limit = 10_000,
): Promise<Array<{ skillId: string; versionId: string }>> {
  const rows = await db
    .selectFrom('skills as s')
    .innerJoin('repositories as r', 'r.id', 's.repository_id')
    .select(['s.id', 's.current_version_id'])
    .where('s.status', '=', 'active')
    .where('r.discovery_source', '!=', DEV_FIXTURE_SOURCE)
    .where('s.current_version_id', 'is not', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('security_scans as sc')
            .select('sc.id')
            .whereRef('sc.version_id', '=', 's.current_version_id')
            .where('sc.scanner_version', '=', scannerVersion)
            .where('sc.policy_version', '=', policyVersion)
            .where('sc.status', '=', 'COMPLETE'),
        ),
      ),
    )
    .orderBy('s.id')
    .limit(limit)
    .execute();
  return rows.map((row) => ({ skillId: row.id, versionId: row.current_version_id! }));
}

/**
 * True when the skill's standing decision already comes from a complete scan of this version
 * under these scanner and policy versions, so scanning again would change nothing. False
 * after an expiry, an ownership change or a content change, which all need a fresh scan.
 */
export async function isDecisionCurrent(
  db: Db,
  skillId: string,
  versionId: string,
  scannerVersion: string,
  policyVersion: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('verification_records as v')
    .innerJoin('security_scans as sc', 'sc.id', 'v.scan_id')
    .select('v.id')
    .where('v.skill_id', '=', skillId)
    .where('v.version_id', '=', versionId)
    .where('v.superseded_at', 'is', null)
    .where('v.reason', '!=', 'EXPIRED')
    .where('sc.status', '=', 'COMPLETE')
    .where('sc.scanner_version', '=', scannerVersion)
    .where('sc.policy_version', '=', policyVersion)
    .executeTakeFirst();
  return row !== undefined;
}
