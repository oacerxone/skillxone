import type { Severity } from '@skillxone/shared';

/**
 * Types for the static security assessment. Everything here works on text that has already
 * been stored; nothing from a repository is ever executed, imported or installed.
 */

export type FindingCategory =
  | 'prompt_injection'
  | 'dangerous_command'
  | 'credential'
  | 'network_exfiltration'
  | 'dependency'
  | 'file_access'
  | 'integrity';

export type FileKind =
  'skill_md' | 'markdown' | 'script' | 'manifest' | 'config' | 'binary' | 'other';

export interface ScanFile {
  /** Path relative to the skill directory. */
  path: string;
  kind: FileKind;
  /** Text content, or null when the file is binary, a symlink or was too large to store. */
  content: string | null;
  sizeBytes: number;
  isExecutable: boolean;
  isBinary: boolean;
  /** Git blob id, used to tell whether a file changed between versions. */
  blobSha: string;
  /** True when the stored content is incomplete. */
  truncated: boolean;
}

export interface ScanInput {
  files: ScanFile[];
  license: string | null;
  /** Files of the last version that was verified, to report what changed since. */
  previousFiles?: Array<Pick<ScanFile, 'path' | 'blobSha' | 'kind'>>;
  /** Fingerprints an administrator marked as false positive or accepted for this skill. */
  suppressed?: ReadonlyMap<string, 'false_positive' | 'accepted'>;
  /** Set to the repository's current full name when it changed owner since the last verification. */
  ownerChangedTo?: string | null;
}

export interface Finding {
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  /** The matched line, trimmed and length-limited; redacted for credential findings. */
  excerpt: string | null;
  explanation: string;
  remediation: string;
  /** Stable id of this finding's content, so a reviewed finding stays suppressed. */
  fingerprint: string;
  status: 'open' | 'false_positive' | 'accepted';
}

export interface ScannerOutcome {
  findings: Finding[];
  /** Set when the scanner could not do its job; the reason is shown in the report. */
  skipped?: string;
}

export interface ScanContext {
  /** Monotonic deadline (performance.now() based). Scanners stop when it passes. */
  deadline: number;
  signal: AbortSignal;
}

export interface Scanner {
  id: string;
  version: string;
  /** Required scanners must complete for a version to be verified. */
  required: boolean | ((input: ScanInput) => boolean);
  scan(input: ScanInput, context: ScanContext): Promise<ScannerOutcome> | ScannerOutcome;
}

export interface CheckRun {
  scanner: string;
  version: string;
  durationMs: number;
}
export interface CheckSkipped {
  scanner: string;
  reason: string;
  required: boolean;
}

export interface ScanReport {
  status: 'COMPLETE' | 'FAILED';
  scannerVersion: string;
  policyVersion: string;
  findings: Finding[];
  checksRun: CheckRun[];
  checksSkipped: CheckSkipped[];
  /** Set when status is FAILED: timeout or internal error. Never a pass. */
  error: string | null;
  durationMs: number;
}

export class ScanTimeoutError extends Error {
  constructor() {
    super('Scan exceeded its time limit');
    this.name = 'ScanTimeoutError';
  }
}
