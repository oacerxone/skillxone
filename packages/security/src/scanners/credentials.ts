import { entropy, excerptOf, redact } from '../text';
import { runLineRules } from '../rules';
import type { LineRule } from '../rules';
import type { Scanner } from '../types';

/**
 * Committed secrets. Patterns are high precision (known prefixes and lengths) with an
 * entropy check that discards placeholders like `ghp_xxxxxxxx…`. Excerpts never contain
 * the secret: the matched value is redacted before the finding is created.
 */

const PLACEHOLDER =
  /example|sample|dummy|placeholder|your[_-]?|xxxx|0000|1234|abcd|test|fake|redacted|changeme|replace|insert|<|>|\$\{|\.\.\./i;

/** True when a candidate secret looks random enough to be real. */
export function looksLikeSecret(value: string, minEntropy = 3.2): boolean {
  return !PLACEHOLDER.test(value) && entropy(value) >= minEntropy;
}

const redacted =
  (group = 0) =>
  (match: RegExpExecArray, line: { text: string }) =>
    excerptOf(redact(line.text, match[group] ?? match[0]));

const secretRule = (
  id: string,
  label: string,
  pattern: RegExp,
  severity: LineRule['severity'] = 'critical',
): LineRule => ({
  id,
  category: 'credential',
  severity,
  pattern,
  explanation: `The file appears to contain ${label}. Anyone who installs or browses the skill can read it.`,
  remediation:
    'Revoke the credential with its issuer now, remove it from the repository history, and load secrets from the environment at run time.',
  accept: (match) => looksLikeSecret(match[0]),
  excerpt: redacted(),
});

export const CREDENTIAL_RULES: readonly LineRule[] = [
  secretRule('CRED-AWS-ACCESS-KEY', 'an AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/),
  secretRule(
    'CRED-GITHUB-TOKEN',
    'a GitHub token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/,
  ),
  secretRule('CRED-SLACK-TOKEN', 'a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,200}\b/),
  secretRule('CRED-STRIPE-LIVE-KEY', 'a live Stripe key', /\b(?:sk|rk)_live_[A-Za-z0-9]{24,200}\b/),
  secretRule(
    'CRED-OPENAI-KEY',
    'an OpenAI API key',
    /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,200}T3BlbkFJ[A-Za-z0-9_-]{20,200}\b|\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,200}\b/,
  ),
  secretRule(
    'CRED-ANTHROPIC-KEY',
    'an Anthropic API key',
    /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,200}\b/,
  ),
  secretRule('CRED-GOOGLE-API-KEY', 'a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/, 'high'),
  {
    id: 'CRED-PRIVATE-KEY',
    category: 'credential',
    severity: 'critical',
    pattern: /-----BEGIN (?:(?:RSA|DSA|EC|OPENSSH|PGP|ENCRYPTED) )?PRIVATE KEY(?: BLOCK)?-----/,
    explanation:
      'The file contains a private key. Anyone who installs or browses the skill can read it.',
    remediation:
      'Treat the key as compromised: revoke or rotate it, remove it from the repository history, and never commit private keys.',
    // A header followed by a placeholder body ("...") is documentation, not a key.
    accept: (_match, line, file) => {
      const content = file.content ?? '';
      const lines = content.split(/\r?\n/);
      const body = lines.slice(line.number, line.number + 3).join('');
      return /^[A-Za-z0-9+/=]{40,}/.test(body.trim());
    },
  },
  {
    id: 'CRED-GENERIC-SECRET',
    category: 'credential',
    severity: 'medium',
    pattern:
      /\b(?:api[_-]?key|api[_-]?secret|client[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd)\b["']?\s{0,3}[:=]\s{0,3}["']([A-Za-z0-9_\-+/=.]{20,200})["']/i,
    explanation:
      'A value assigned to a secret-like name looks like a real credential rather than a placeholder.',
    remediation:
      'If this is a real secret, revoke it and load it from the environment. If it is an example, make that obvious (for example "your-api-key").',
    accept: (match) => looksLikeSecret(match[1] ?? '', 4),
    excerpt: redacted(1),
  },
];

export const credentialScanner: Scanner = {
  id: 'credentials',
  version: '1.0.0',
  required: true,
  scan(input, context) {
    return { findings: runLineRules(CREDENTIAL_RULES, input.files, context) };
  },
};
