import {
  expireVerification,
  isDecisionCurrent,
  listExpiredVerifications,
  listVersionsNeedingScan,
  loadScanTarget,
  markScanning,
  saveScanResult,
} from '@skillxone/database';
import type { DatabaseHandle, JobQueue } from '@skillxone/database';
import {
  DEFAULT_SCAN_TIMEOUT_MS,
  evaluateVerification,
  POLICY_VERSION,
  runScan,
  SCANNER_VERSION,
} from '@skillxone/security';
import type { Scanner } from '@skillxone/security';

/**
 * Security assessment jobs. The scanner reads stored file text only; nothing from a
 * repository is executed, installed or imported here.
 */

export interface ScanDeps {
  db: DatabaseHandle['db'];
  queue: JobQueue;
  now: () => Date;
  scanners: readonly Scanner[];
  timeoutMs?: number;
  verificationDays?: number;
}

export interface ScanSummary {
  status: 'scanned' | 'skipped';
  reason?: string;
  scanStatus?: 'COMPLETE' | 'FAILED';
  state?: string;
  findings?: number;
  open?: Record<string, number>;
}

export async function scanVersion(
  deps: ScanDeps,
  target: { skillId: string; versionId: string },
  options: { force?: boolean } = {},
): Promise<ScanSummary> {
  const loaded = await loadScanTarget(deps.db, target.versionId);
  if (!loaded || loaded.skillId !== target.skillId)
    return { status: 'skipped', reason: 'version not found' };
  // Only the current version's state is shown; older versions are not worth the work.
  if (!loaded.isCurrent) return { status: 'skipped', reason: 'no longer the current version' };
  if (
    !options.force &&
    (await isDecisionCurrent(
      deps.db,
      loaded.skillId,
      loaded.versionId,
      SCANNER_VERSION,
      POLICY_VERSION,
    ))
  ) {
    return { status: 'skipped', reason: 'already assessed under this scanner and policy' };
  }

  const startedAt = deps.now();
  await markScanning(deps.db, loaded.skillId, loaded.versionId, startedAt);
  const report = await runScan(
    {
      files: loaded.files,
      license: loaded.license,
      previousFiles: loaded.previousFiles,
      suppressed: loaded.suppressed,
      ownerChangedTo: loaded.ownerChangedTo,
    },
    { scanners: deps.scanners, timeoutMs: deps.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS },
  );
  const finishedAt = deps.now();
  const decision = evaluateVerification(report, {
    now: finishedAt,
    verificationDays: deps.verificationDays,
  });

  await saveScanResult(deps.db, {
    skillId: loaded.skillId,
    versionId: loaded.versionId,
    commitSha: loaded.commitSha,
    contentHash: loaded.contentHash,
    scannerVersion: report.scannerVersion,
    policyVersion: report.policyVersion,
    status: report.status,
    outcome: decision.outcome,
    checksRun: report.checksRun,
    checksSkipped: report.checksSkipped,
    error: report.error,
    findings: report.findings,
    startedAt,
    finishedAt,
    decision,
  });
  // Verification is a ranking signal; one pending rank job covers any number of scans.
  await deps.queue.enqueue('rank', {}, { dedupeKey: 'rank' });

  const open: Record<string, number> = {};
  for (const finding of report.findings) {
    if (finding.status === 'open') open[finding.severity] = (open[finding.severity] ?? 0) + 1;
  }
  return {
    status: 'scanned',
    scanStatus: report.status,
    state: decision.state,
    findings: report.findings.length,
    open,
  };
}

/** Ends expired verifications and queues their rescans. Safe to run at any interval. */
export async function expireVerifications(
  deps: Pick<ScanDeps, 'db' | 'queue' | 'now'>,
): Promise<{ expired: number }> {
  const now = deps.now();
  let expired = 0;
  for (const item of await listExpiredVerifications(deps.db, now)) {
    if (await expireVerification(deps.db, item.skillId, item.versionId, now)) {
      expired += 1;
      await deps.queue.enqueue('scan_skill', item, { dedupeKey: `scan:${item.versionId}` });
    }
  }
  return { expired };
}

/** Queues a scan for every current version not yet assessed under this scanner and policy. */
export async function enqueueMissingScans(
  deps: Pick<ScanDeps, 'db' | 'queue'>,
  limit?: number,
): Promise<{ enqueued: number; candidates: number }> {
  const pending = await listVersionsNeedingScan(deps.db, SCANNER_VERSION, POLICY_VERSION, limit);
  let enqueued = 0;
  for (const item of pending) {
    const result = await deps.queue.enqueue('scan_skill', item, {
      dedupeKey: `scan:${item.versionId}`,
    });
    if (result.created) enqueued += 1;
  }
  return { enqueued, candidates: pending.length };
}
