import { severityRank } from './rules';
import { commandScanner } from './scanners/commands';
import { credentialScanner } from './scanners/credentials';
import { createDependencyScanner } from './scanners/dependencies';
import type { OsvClient } from './scanners/dependencies';
import { fileAccessScanner } from './scanners/file-access';
import { createGitleaksScanner } from './scanners/gitleaks';
import { integrityScanner } from './scanners/integrity';
import { networkScanner } from './scanners/network';
import { promptInjectionScanner } from './scanners/prompt-injection';
import type { CheckRun, CheckSkipped, Finding, Scanner, ScanInput, ScanReport } from './types';
import { ScanTimeoutError } from './types';
import { POLICY_VERSION } from './policy';

/**
 * Version of the scanner set as a whole. Bump it whenever a rule, severity or scanner
 * changes; a new version queues reassessment of the catalog (verification policy).
 */
export const SCANNER_VERSION = 'skillxone-scan-1.0.0';
export const DEFAULT_SCAN_TIMEOUT_MS = 60_000;

export interface ScannerOptions {
  /** OSV.dev client, or null to disable lookups (dependency check is then skipped). */
  osv: OsvClient | null;
  /** Path to the gitleaks binary; omit to search PATH, null to disable. */
  gitleaksBinary?: string | null;
}

export function createDefaultScanners(options: ScannerOptions): Scanner[] {
  return [
    promptInjectionScanner,
    commandScanner,
    credentialScanner,
    networkScanner,
    fileAccessScanner,
    integrityScanner,
    createDependencyScanner(options.osv),
    createGitleaksScanner({ binary: options.gitleaksBinary }),
  ];
}

const isRequired = (scanner: Scanner, input: ScanInput) =>
  typeof scanner.required === 'function' ? scanner.required(input) : scanner.required;

function withDeadline<T>(promise: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort();
        reject(new ScanTimeoutError());
      },
      Math.max(0, ms),
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Orders findings most severe first, then by file and line, for stable reports. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      (a.filePath ?? '').localeCompare(b.filePath ?? '') ||
      (a.lineStart ?? 0) - (b.lineStart ?? 0) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * Runs every scanner over the stored files of one skill version. Static only: files are read
 * as text. A timeout or an internal error yields status FAILED, never a pass.
 */
export async function runScan(
  input: ScanInput,
  options: { scanners: readonly Scanner[]; timeoutMs?: number },
): Promise<ScanReport> {
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  const deadline = started + timeoutMs;
  const controller = new AbortController();
  const checksRun: CheckRun[] = [];
  const checksSkipped: CheckSkipped[] = [];
  const byFingerprint = new Map<string, Finding>();

  const base = {
    scannerVersion: SCANNER_VERSION,
    policyVersion: POLICY_VERSION,
    checksRun,
    checksSkipped,
  };

  try {
    for (const scanner of options.scanners) {
      const required = isRequired(scanner, input);
      const scannerStart = performance.now();
      if (scannerStart > deadline) throw new ScanTimeoutError();
      const outcome = await withDeadline(
        Promise.resolve().then(() => scanner.scan(input, { deadline, signal: controller.signal })),
        deadline - scannerStart,
        controller,
      );
      for (const finding of outcome.findings) {
        if (!byFingerprint.has(finding.fingerprint))
          byFingerprint.set(finding.fingerprint, finding);
      }
      if (outcome.skipped)
        checksSkipped.push({ scanner: scanner.id, reason: outcome.skipped, required });
      else
        checksRun.push({
          scanner: scanner.id,
          version: scanner.version,
          durationMs: Math.round(performance.now() - scannerStart),
        });
    }
  } catch (error) {
    return {
      ...base,
      status: 'FAILED',
      findings: [],
      error:
        error instanceof ScanTimeoutError
          ? `Scan exceeded its ${Math.round(timeoutMs / 1000)} s time limit.`
          : `Scanner error: ${(error as Error).message}`.slice(0, 500),
      durationMs: Math.round(performance.now() - started),
    };
  }

  // Findings an administrator reviewed keep their decision across rescans.
  const findings = sortFindings(
    [...byFingerprint.values()].map((finding) => {
      const status = input.suppressed?.get(finding.fingerprint);
      return status ? { ...finding, status } : finding;
    }),
  );
  return {
    ...base,
    status: 'COMPLETE',
    findings,
    error: null,
    durationMs: Math.round(performance.now() - started),
  };
}
