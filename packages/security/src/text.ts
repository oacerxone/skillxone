import { createHash } from 'node:crypto';
import type { ScanFile } from './types';

/**
 * Turns a file into lines annotated with the context a rule needs to judge a match:
 * is this prose or code, and is the surrounding text warning against the thing it mentions?
 */

export interface TextLine {
  number: number;
  text: string;
  /** True inside a fenced code block, an indented code block, or anywhere in a script. */
  inCode: boolean;
  /** True for Markdown outside code blocks. */
  inProse: boolean;
  /** True inside a Markdown blockquote or when the line is mostly an inline-code/quoted example. */
  quoted: boolean;
  /**
   * True when this Markdown line or its lead-in forbids or warns against what follows.
   * In scripts only comment lines can be negated: a comment does not change what code does.
   */
  negated: boolean;
  /** True inside an HTML comment in Markdown (hidden from a rendered view). */
  inHtmlComment: boolean;
  /** True for a whole-line comment in a script or configuration file; it does not execute. */
  comment: boolean;
}

/** Lines longer than this are cut before matching, which bounds regex work per line. */
export const MAX_LINE_LENGTH = 2000;
/** Files with more lines are scanned only up to this point; the report says so. */
export const MAX_LINES = 20_000;

const NEGATION =
  /\b(never|do not|don't|dont|must not|mustn't|should not|shouldn't|avoid|refuse|forbid|forbidden|prohibit(?:ed)?|dangerous|malicious|suspicious|anti-?pattern|bad example|red flags?|instead of|prevent|unsafe|harmful|attacks?|attackers?|vulnerab\w*|threats?|warning)\b/i;

const HEADING = /^\s{0,3}#{1,6}\s/;
const SCRIPT_COMMENT = /^\s*(?:#(?!!)|\/\/|\/\*|\*|--\s|;|REM\s|::)/i;
const FENCE = /^\s{0,3}(```+|~~~+)/;

const isMarkdown = (file: ScanFile) => file.kind === 'skill_md' || file.kind === 'markdown';

export function splitLines(file: ScanFile): { lines: TextLine[]; truncated: boolean } {
  const raw = (file.content ?? '').split(/\r?\n/);
  const truncated = raw.length > MAX_LINES;
  const markdown = isMarkdown(file);
  const lines: TextLine[] = [];

  let fence: string | null = null;
  let inComment = false;
  /** Negation carries from a heading or list lead-in to the lines beneath it. */
  let sectionNegated = false;
  let leadNegated = false;

  for (let index = 0; index < Math.min(raw.length, MAX_LINES); index += 1) {
    const text = raw[index]!.slice(0, MAX_LINE_LENGTH);
    let inCode = !markdown;
    let quoted = false;
    let lineInComment = false;

    if (markdown) {
      const fenceMatch = FENCE.exec(text);
      if (fenceMatch) {
        const marker = fenceMatch[1]![0]!;
        if (fence === null) fence = marker;
        else if (fence === marker) fence = null;
        lines.push({
          number: index + 1,
          text,
          inCode: true,
          inProse: false,
          quoted: false,
          negated: sectionNegated || leadNegated,
          inHtmlComment: false,
          comment: false,
        });
        continue;
      }
      inCode = fence !== null;

      if (!inCode) {
        // Comment markers inside inline code (`<!-- x -->`) are text, not comments.
        const outsideCode = text.replace(/`[^`]*`/g, '');
        const opens = outsideCode.includes('<!--');
        if (inComment || opens) lineInComment = true;
        if (opens) inComment = true;
        if (outsideCode.includes('-->')) inComment = false;

        if (HEADING.test(text)) {
          sectionNegated = NEGATION.test(text);
          leadNegated = false;
        } else if (text.trim() === '') {
          leadNegated = false;
        } else if (/[:：]\s*$/.test(text)) {
          // "Never do any of the following:" governs the list or code block after it.
          leadNegated = NEGATION.test(text);
        }
        quoted = /^\s{0,3}>/.test(text);
      }
    }

    const comment = !markdown && SCRIPT_COMMENT.test(text);
    lines.push({
      number: index + 1,
      text,
      inCode,
      inProse: markdown && !inCode,
      quoted,
      // In a script only a comment line can warn against something; code runs regardless.
      negated: markdown
        ? NEGATION.test(text) || sectionNegated || leadNegated
        : comment && NEGATION.test(text),
      inHtmlComment: lineInComment,
      comment,
    });
  }
  return { lines, truncated };
}

/** Trims and bounds a line for display in a report. */
export function excerptOf(text: string, max = 240): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Replaces the middle of a secret so the report does not republish it. */
export function redact(text: string, secret: string): string {
  if (secret.length < 8) return text.replace(secret, '[redacted]');
  return text.replace(secret, `${secret.slice(0, 4)}…[redacted]`);
}

/**
 * Fingerprint of a finding: rule, file and the matched text with whitespace collapsed.
 * Line numbers are deliberately excluded so the fingerprint survives unrelated edits above.
 */
export function fingerprint(ruleId: string, filePath: string | null, matched: string): string {
  return createHash('sha256')
    .update(`${ruleId}\0${filePath ?? ''}\0${matched.trim().replace(/\s+/g, ' ').toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

/** Shannon entropy in bits per character; used to tell random secrets from words. */
export function entropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
