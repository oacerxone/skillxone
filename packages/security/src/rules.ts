import type { Severity } from '@skillxone/shared';
import { excerptOf, fingerprint, splitLines } from './text';
import type { TextLine } from './text';
import type { Finding, FindingCategory, ScanContext, ScanFile } from './types';
import { ScanTimeoutError } from './types';

/**
 * Shared machinery for line-based rules.
 *
 * Every pattern here is written to run in linear time: no nested quantifiers, and every
 * unbounded gap is a bounded `[^\n]{0,N}` so a hostile line cannot cause catastrophic
 * backtracking. Lines are also cut to MAX_LINE_LENGTH before matching.
 */

const ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

/** Moves a severity down (negative steps) or up (positive steps), clamped to the scale. */
export function shiftSeverity(severity: Severity, steps: number): Severity {
  const index = ORDER.indexOf(severity) + steps;
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, index))]!;
}

export const severityRank = (severity: Severity) => ORDER.indexOf(severity);

export type LineContext = 'negated' | 'quoted' | 'code' | 'prose' | 'comment';

export interface LineRule {
  id: string;
  category: FindingCategory;
  severity: Severity;
  pattern: RegExp;
  explanation: string;
  remediation: string;
  /** Which lines the rule looks at. Defaults to every line of every text file. */
  applies?: (line: TextLine, file: ScanFile) => boolean;
  /**
   * Contexts that lower the severity, each by `steps` levels (default 2). For example a
   * command under "Never run the following:" is reported, but does not block.
   */
  softenWhen?: Partial<Record<LineContext, number>>;
  /** Final check on a match; return false to discard it (placeholders, examples). */
  accept?: (match: RegExpExecArray, line: TextLine, file: ScanFile) => boolean;
  /** Text to show instead of the line, for example with a secret redacted. */
  excerpt?: (match: RegExpExecArray, line: TextLine) => string;
  /** One finding per file for this rule, rather than one per line. */
  oncePerFile?: boolean;
}

export const isMarkdownFile = (file: ScanFile) =>
  file.kind === 'skill_md' || file.kind === 'markdown';

export function checkDeadline(context: ScanContext): void {
  if (context.signal.aborted || performance.now() > context.deadline) throw new ScanTimeoutError();
}

/** True when position `index` of a prose line sits inside a "double-quoted" phrase. */
export function insideInlineQuote(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const straight = (before.match(/"/g) ?? []).length;
  const open = (before.match(/\u201C/g) ?? []).length;
  const close = (before.match(/\u201D/g) ?? []).length;
  return straight % 2 === 1 || open > close;
}

function softened(
  rule: LineRule,
  line: TextLine,
  inlineQuoted = false,
): { severity: Severity; note: string | null } {
  const soften = rule.softenWhen ?? {};
  let steps = 0;
  const reasons: string[] = [];
  const apply = (context: LineContext, active: boolean, reason: string) => {
    const amount = soften[context];
    if (amount !== undefined && active && amount > steps) {
      steps = amount;
      reasons.push(reason);
    }
  };
  apply('negated', line.negated, 'the surrounding text warns against it');
  apply('quoted', line.quoted || inlineQuoted, 'it appears in a quotation');
  apply('code', line.inCode && line.inProse === false, 'it appears in a code example');
  apply('prose', line.inProse, 'it appears in prose rather than code');
  apply('comment', line.comment, 'it appears in a code comment');
  if (steps === 0) return { severity: rule.severity, note: null };
  return {
    severity: shiftSeverity(rule.severity, -steps),
    note: `Severity lowered from ${rule.severity} because ${reasons.join(' and ')}.`,
  };
}

export function makeFinding(
  rule: Pick<LineRule, 'id' | 'category' | 'explanation' | 'remediation'>,
  severity: Severity,
  file: ScanFile | null,
  line: number | null,
  excerpt: string | null,
  matched: string,
  note: string | null = null,
): Finding {
  return {
    ruleId: rule.id,
    category: rule.category,
    severity,
    filePath: file?.path ?? null,
    lineStart: line,
    lineEnd: line,
    excerpt,
    explanation: note ? `${rule.explanation} ${note}` : rule.explanation,
    remediation: rule.remediation,
    fingerprint: fingerprint(rule.id, file?.path ?? null, matched),
    status: 'open',
  };
}

/** Runs line rules over the text files that `include` selects. */
export function runLineRules(
  rules: readonly LineRule[],
  files: readonly ScanFile[],
  context: ScanContext,
  include: (file: ScanFile) => boolean = () => true,
): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.content === null || !include(file)) continue;
    checkDeadline(context);
    const { lines } = splitLines(file);
    const seen = new Set<string>();
    for (const line of lines) {
      if (line.number % 500 === 0) checkDeadline(context);
      for (const rule of rules) {
        if (rule.oncePerFile && seen.has(rule.id)) continue;
        if (rule.applies && !rule.applies(line, file)) continue;
        rule.pattern.lastIndex = 0;
        const match = rule.pattern.exec(line.text);
        if (!match) continue;
        if (rule.accept && !rule.accept(match, line, file)) continue;
        const inlineQuoted = line.inProse && insideInlineQuote(line.text, match.index);
        const { severity, note } = softened(rule, line, inlineQuoted);
        const excerpt = rule.excerpt ? rule.excerpt(match, line) : excerptOf(line.text);
        findings.push(makeFinding(rule, severity, file, line.number, excerpt, match[0], note));
        seen.add(rule.id);
      }
    }
  }
  return findings;
}
