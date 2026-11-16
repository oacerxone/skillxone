import { runLineRules, shiftSeverity } from '../rules';
import type { LineRule } from '../rules';
import type { Scanner } from '../types';
import { sendsData } from './network';

/**
 * Reads of credentials and other private data on the user's machine. A file that both reads
 * such a path and sends data somewhere is reported one level higher.
 */

/** A path named in prose or a comment is a mention; in code it is a read. */
const SOFTEN = { negated: 2, quoted: 1, comment: 1, prose: 1 } as const;
const HOME = String.raw`(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|\/Users\/[^\/\s]{1,40}|\/home\/[^\/\s]{1,40}|\/root)`;

const rule = (
  id: string,
  severity: LineRule['severity'],
  pattern: RegExp,
  what: string,
): LineRule => ({
  id,
  category: 'file_access',
  severity,
  pattern,
  explanation: `The skill refers to ${what}, a location that holds private data or credentials.`,
  remediation:
    'Do not read credential stores or private files. If the task needs a credential, ask the user to provide it through the environment.',
  softenWhen: SOFTEN,
});

export const FILE_ACCESS_RULES: readonly LineRule[] = [
  rule(
    'FILE-SSH-KEYS',
    'high',
    new RegExp(
      String.raw`${HOME}\/\.ssh\/(?:id_[a-z0-9_]{2,20}(?!\.pub)|authorized_keys|known_hosts)\b|${HOME}\/\.ssh\/?(?:\s|$|\*|["'])|\bid_(?:rsa|dsa|ecdsa|ed25519)(?!\.pub)\b`,
    ),
    'SSH keys',
  ),
  rule(
    'FILE-CLOUD-CREDENTIALS',
    'high',
    new RegExp(
      String.raw`${HOME}\/\.(?:aws\/credentials|config\/gcloud|azure\/|kube\/config|docker\/config\.json|oci\/config)|\bapplication_default_credentials\.json\b`,
    ),
    'cloud provider credentials',
  ),
  rule(
    'FILE-TOKEN-STORES',
    'high',
    new RegExp(
      String.raw`${HOME}\/\.(?:netrc|npmrc|pypirc|git-credentials|gnupg\/|config\/gh\/hosts\.yml|claude\/\.credentials\.json|codex\/auth\.json|config\/github-copilot\/)|\b(?:security\s+(?:find-generic-password|find-internet-password|dump-keychain)|login\.keychain(?:-db)?)\b`,
    ),
    'a token store or the system keychain',
  ),
  rule(
    'FILE-BROWSER-PROFILE',
    'high',
    /(?:\/Default|\/Profile \d{1,3}|\.default(?:-release)?)\/(?:Login Data|Cookies|Web Data|Local State)\b|\b(?:logins\.json|key[34]\.db|cookies\.sqlite)\b|(?:Google\/Chrome|Chromium|BraveSoftware\/Brave-Browser|Microsoft\/Edge|Firefox\/Profiles|\.mozilla\/firefox)\/[^\s"']{0,80}(?:Default|Profile|\.default)/,
    'browser profile data (saved passwords or cookies)',
  ),
  rule(
    'FILE-SHELL-HISTORY',
    'medium',
    /\.(?:bash|zsh|sh|python|node_repl|psql|mysql)_history\b|\bConsoleHost_history\.txt\b/,
    'shell history',
  ),
  rule(
    'FILE-SYSTEM-SECRETS',
    'high',
    /\/etc\/(?:shadow|sudoers|master\.passwd)\b/,
    'system password files',
  ),
  {
    ...rule(
      'FILE-DOTENV',
      'low',
      /(?:\bcat|\bsource|\bless|\bmore|\bhead|\btail|\bcp|\bopen\(|\breadFile(?:Sync)?\()[^\n]{0,40}(?:^|[\s"'/(])\.env(?:\.[a-z]{2,12})?\b/,
      'a .env file',
    ),
    explanation:
      'The skill reads a .env file, which usually holds secrets. This is often legitimate, but check what is done with the values.',
  },
];

export const fileAccessScanner: Scanner = {
  id: 'file-access',
  version: '1.0.0',
  required: true,
  scan(input, context) {
    const findings = runLineRules(
      FILE_ACCESS_RULES,
      input.files,
      context,
      (f) => f.kind !== 'binary',
    );
    // Reading a credential is worse when the same file also sends data out.
    const exfiltrating = new Set(
      input.files.filter((f) => f.content !== null && sendsData(f.content)).map((f) => f.path),
    );
    return {
      findings: findings.map((finding) =>
        finding.filePath && exfiltrating.has(finding.filePath)
          ? {
              ...finding,
              severity: shiftSeverity(finding.severity, 1),
              explanation: `${finding.explanation} The same file also sends data over the network, so severity was raised one level.`,
            }
          : finding,
      ),
    };
  },
};
