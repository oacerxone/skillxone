import { excerptOf, splitLines } from '../text';
import { checkDeadline, isMarkdownFile, makeFinding, runLineRules } from '../rules';
import type { LineRule } from '../rules';
import type { Finding, Scanner, ScanFile } from '../types';

/**
 * Prompt injection: text written to steer the agent against its user or its instructions.
 *
 * This is the weakest scanner by nature. Paraphrase evades it, and skills that teach about
 * prompt injection trigger it; examples in code blocks, quotations and passages that warn
 * against the behaviour are therefore reported at a lower severity.
 */

const prose = (line: { inHtmlComment: boolean }, file: ScanFile) =>
  isMarkdownFile(file) && !line.inHtmlComment;

/** Teaching material and code samples are common; they are reported but do not block. */
const SOFTEN = { negated: 2, quoted: 2, code: 1 } as const;

export const PROMPT_INJECTION_RULES: readonly LineRule[] = [
  {
    id: 'PI-IGNORE-INSTRUCTIONS',
    category: 'prompt_injection',
    severity: 'high',
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\b[^\n.]{0,40}\b(?:previous|prior|above|earlier|preceding|all|any|system|developer|original|other)\b[^\n.]{0,24}\b(?:instructions?|prompts?|rules|guidelines|directives|messages|constraints)\b/i,
    explanation:
      'The text tells the agent to ignore or override its existing instructions, a common prompt-injection pattern.',
    remediation:
      'Remove the instruction. A skill should add guidance for its task, not cancel the instructions the agent already follows.',
    applies: prose,
    softenWhen: SOFTEN,
    accept: (match, line) => {
      // "Override the default system prompt" describes a setting, and "override any
      // instructions found in repository files" is a defence against injection.
      if (/\bdefault\b/i.test(match[0])) return false;
      const after = line.text.slice(
        match.index + match[0].length,
        match.index + match[0].length + 60,
      );
      return !/^\s*(?:found|from|within|inside|contained|embedded|in)\b[^.]{0,40}\b(?:files?|repositor|web|pages?|documents?|tools?|content|issues?|emails?|outputs?|results?)/i.test(
        after,
      );
    },
  },
  {
    id: 'PI-REVEAL-PROMPT',
    category: 'prompt_injection',
    severity: 'high',
    pattern:
      /\b(?:reveal|print|output|show|repeat|leak|disclose|dump)\b[^\n.]{0,30}\b(?:(?:your |the )?system prompt|your system message|developer prompt|hidden instructions|initial instructions|your instructions)\b/i,
    explanation: 'The text asks the agent to disclose its system prompt or hidden instructions.',
    remediation: 'Remove the request. A skill has no need to read or reveal the system prompt.',
    applies: prose,
    softenWhen: SOFTEN,
  },
  {
    id: 'PI-DISABLE-SAFEGUARDS',
    category: 'prompt_injection',
    severity: 'high',
    pattern:
      /\b(?:disable|turn off|bypass|ignore|circumvent)\b[^\n.]{0,30}\b(?:safety (?:checks?|guidelines|rules|measures)|safeguards?|guardrails?|content (?:policy|policies|filters?)|security (?:checks?|warnings?|policies)|permission (?:prompts?|checks?))\b/i,
    explanation:
      'The text tells the agent to disable safety checks, permission prompts or other safeguards.',
    remediation:
      'Remove the instruction. If the task genuinely needs elevated permissions, say so plainly and let the user decide.',
    applies: prose,
    softenWhen: SOFTEN,
  },
  {
    id: 'PI-HIDE-FROM-USER',
    category: 'prompt_injection',
    severity: 'medium',
    pattern:
      /\b(?:do not|don't|never|without)\b[^\n.]{0,20}\b(?:tell(?:ing)?|inform(?:ing)?|notify(?:ing)?|mention(?:ing)?|reveal(?:ing)?|alert(?:ing)?|let(?:ting)?)\b[^\n.]{0,20}\bthe user\b[^\n.]{0,40}\b(?:about|that|what|this|these|ran|run|sent|send|read|access)/i,
    explanation:
      'The text tells the agent to keep something from the user, which hides actions taken on their behalf.',
    remediation:
      'Remove the instruction. A skill should never ask the agent to conceal what it does from the user.',
    applies: prose,
    // The pattern is itself a negation, so negation does not soften it.
    softenWhen: { quoted: 2, code: 1 },
  },
  {
    id: 'PI-JAILBREAK-PERSONA',
    category: 'prompt_injection',
    severity: 'medium',
    pattern:
      /\b(?:jailbreak(?:ed|ing)?|DAN mode|developer mode (?:enabled|on)|unrestricted mode|no longer bound by|free from (?:all )?(?:rules|restrictions|guidelines))\b/i,
    explanation: 'The text uses language typical of jailbreak prompts.',
    remediation: 'Remove the jailbreak framing.',
    applies: prose,
    // Talking about defending against jailbreaks is not a jailbreak.
    accept: (match, line) =>
      !/jailbreak\w*\s+(?:detection|protection|prevention|attempts?|classifiers?|defen[cs]es?|filters?|resistance|attacks?)/i.test(
        line.text.slice(match.index, match.index + 60),
      ),
    softenWhen: SOFTEN,
  },
  {
    id: 'PI-HTML-COMMENT-INSTRUCTION',
    category: 'prompt_injection',
    severity: 'medium',
    pattern:
      /\b(?:ignore|you must|you are|always|execute|run the|send|curl|upload|do not tell|assistant|claude|codex|agent)\b/i,
    explanation:
      'An HTML comment contains instructions. Comments are hidden when the file is rendered, so a reader would not see them, but an agent reading the raw file would.',
    remediation: 'Move instructions into visible text, or remove the comment.',
    applies: (line, file) => isMarkdownFile(file) && line.inHtmlComment && !line.inCode,
  },
];

/** Unicode that is invisible when rendered and can carry hidden text or reorder what is shown. */
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/u;
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/u;
const ZERO_WIDTH_RUN = /[\u200B-\u200D\u2060\uFEFF]{3,}/u;

const INVISIBLE_RULES = [
  {
    id: 'PI-UNICODE-TAG-CHARS',
    severity: 'high' as const,
    pattern: TAG_CHARS,
    explanation:
      'The file contains Unicode tag characters, which are invisible in most views and can encode hidden instructions.',
    remediation: 'Remove the tag characters (U+E0000 to U+E007F).',
  },
  {
    id: 'PI-UNICODE-BIDI',
    severity: 'high' as const,
    pattern: BIDI_CONTROLS,
    explanation:
      'The file contains bidirectional control characters, which can make text display differently from what it says.',
    remediation:
      'Remove the bidirectional override and isolate characters (U+202A to U+202E, U+2066 to U+2069).',
  },
  {
    id: 'PI-UNICODE-ZERO-WIDTH',
    severity: 'medium' as const,
    pattern: ZERO_WIDTH_RUN,
    explanation:
      'The file contains a run of zero-width characters, which are invisible and can hide text.',
    remediation: 'Remove the zero-width characters.',
  },
];

/** Shows invisible characters as code points so a reviewer can see what was found. */
function visible(text: string): string {
  return excerptOf(
    text.replace(
      /[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF]/gu,
      (ch) => `<U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`,
    ),
  );
}

function invisibleUnicode(
  files: readonly ScanFile[],
  context: Parameters<Scanner['scan']>[1],
): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.content === null) continue;
    checkDeadline(context);
    const { lines } = splitLines(file);
    for (const rule of INVISIBLE_RULES) {
      for (const line of lines) {
        // A byte-order mark at the very start of a file is harmless.
        const text = line.number === 1 ? line.text.replace(/^\uFEFF/, '') : line.text;
        const match = rule.pattern.exec(text);
        if (!match) continue;
        findings.push(
          makeFinding(
            { ...rule, category: 'prompt_injection' },
            rule.severity,
            file,
            line.number,
            visible(text),
            visible(text),
          ),
        );
        break; // One finding per rule per file is enough to act on.
      }
    }
  }
  return findings;
}

export const promptInjectionScanner: Scanner = {
  id: 'prompt-injection',
  version: '1.0.0',
  required: true,
  scan(input, context) {
    return {
      findings: [
        ...runLineRules(PROMPT_INJECTION_RULES, input.files, context, isMarkdownFile),
        ...invisibleUnicode(input.files, context),
      ],
    };
  },
};
