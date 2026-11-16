import type { LifecycleState, VerificationState } from '@skillxone/shared';
import type { ScanReport } from './types';

/**
 * The decision rule of docs/security/verification-policy.md, as code. Change the two
 * together, and bump POLICY_VERSION when the rule changes.
 */
export const POLICY_VERSION = '0.1-draft';
export const DEFAULT_VERIFICATION_DAYS = 30;

export type DecisionReason =
  | 'POLICY_PASS'
  | 'BLOCKING_FINDINGS'
  | 'OPEN_MEDIUM_FINDINGS'
  | 'REQUIRED_CHECK_SKIPPED'
  | 'SCAN_FAILED';

export interface VerificationDecision {
  state: VerificationState;
  lifecycle: LifecycleState;
  outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  reason: DecisionReason;
  /** Plain-language reason shown on the report. */
  summary: string;
  expiresAt: Date | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function evaluateVerification(
  report: Pick<ScanReport, 'status' | 'findings' | 'checksSkipped' | 'error'>,
  options: { now: Date; verificationDays?: number },
): VerificationDecision {
  if (report.status === 'FAILED') {
    return {
      state: 'UNVERIFIED',
      lifecycle: 'FAILED',
      outcome: 'INCONCLUSIVE',
      reason: 'SCAN_FAILED',
      summary: `The scan did not complete: ${report.error ?? 'unknown error'}`,
      expiresAt: null,
    };
  }

  const open = report.findings.filter((finding) => finding.status === 'open');
  const blocking = open.filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (blocking.length > 0) {
    return {
      state: 'FLAGGED',
      lifecycle: 'COMPLETE',
      outcome: 'FAIL',
      reason: 'BLOCKING_FINDINGS',
      summary: `${plural(blocking.length, 'open critical or high finding')}.`,
      expiresAt: null,
    };
  }

  const skippedRequired = report.checksSkipped.filter((check) => check.required);
  if (skippedRequired.length > 0) {
    return {
      state: 'UNVERIFIED',
      lifecycle: 'COMPLETE',
      outcome: 'INCONCLUSIVE',
      reason: 'REQUIRED_CHECK_SKIPPED',
      summary: `Required check skipped: ${skippedRequired.map((c) => `${c.scanner} (${c.reason})`).join('; ')}`,
      expiresAt: null,
    };
  }

  const medium = open.filter((finding) => finding.severity === 'medium');
  if (medium.length > 0) {
    return {
      state: 'UNVERIFIED',
      lifecycle: 'COMPLETE',
      outcome: 'INCONCLUSIVE',
      reason: 'OPEN_MEDIUM_FINDINGS',
      summary: `${plural(medium.length, 'open medium finding')} to review.`,
      expiresAt: null,
    };
  }

  const days = options.verificationDays ?? DEFAULT_VERIFICATION_DAYS;
  return {
    state: 'VERIFIED',
    lifecycle: 'COMPLETE',
    outcome: 'PASS',
    reason: 'POLICY_PASS',
    summary: 'Every required check completed with no open blocking or medium findings.',
    expiresAt: new Date(options.now.getTime() + days * 24 * 60 * 60 * 1000),
  };
}
