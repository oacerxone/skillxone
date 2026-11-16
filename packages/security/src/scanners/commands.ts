import { runLineRules } from '../rules';
import type { LineRule } from '../rules';
import type { Scanner } from '../types';

/**
 * Dangerous shell commands in scripts and in Markdown code. A command under a heading or
 * lead-in such as "Never run:" is still reported, at a lower severity.
 */

const SOFTEN = { negated: 2, quoted: 1, comment: 1 } as const;
const SHELL = String.raw`(?:sudo\s+)?(?:ba|z|da|k|fi)?sh\b`;
const INTERPRETER = String.raw`(?:sudo\s+)?(?:python[0-9.]*|node|perl|ruby|php)\b`;
/** Paths whose recursive deletion destroys a home directory or the system. */
const BROAD_TARGET = String.raw`(?:\/|\/\*|~|~\/|~\/\*|\$HOME|\$\{HOME\}|"\$HOME"|"\$\{HOME\}"|\/(?:usr|etc|var|bin|sbin|lib|home|Users|System|opt|boot|root)\/?\*?)`;

export const COMMAND_RULES: readonly LineRule[] = [
  {
    id: 'CMD-REMOTE-PIPE-SHELL',
    category: 'dangerous_command',
    severity: 'high',
    pattern: new RegExp(
      String.raw`\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:${SHELL}|${INTERPRETER})|\b(?:ba|z)?sh\s+(?:-c\s+)?["']?(?:<\(|\$\()\s*(?:curl|wget)\b|\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]{0,300}\|\s*(?:iex|Invoke-Expression)\b`,
      'i',
    ),
    explanation:
      'A script is downloaded and run in one step, so whatever the server returns at that moment is executed without review.',
    remediation:
      'Download the script, check it (and its checksum or signature), then run the saved copy. Prefer a package manager.',
    softenWhen: SOFTEN,
  },
  {
    id: 'CMD-RM-RF-BROAD',
    category: 'dangerous_command',
    severity: 'critical',
    pattern: new RegExp(
      String.raw`\brm\s+(?:-[a-zA-Z]*(?:rf|fr)[a-zA-Z]*|-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r[a-zA-Z]*|--recursive\s+--force|--force\s+--recursive)\s+(?:--no-preserve-root\s+)?${BROAD_TARGET}(?=\s|$|;|&|\||\))`,
    ),
    explanation:
      'A recursive, forced delete targets the root directory, a system directory or the home directory.',
    remediation: 'Delete only specific paths inside a working or temporary directory.',
    softenWhen: SOFTEN,
  },
  {
    id: 'CMD-CHMOD-WORLD-WRITABLE',
    category: 'dangerous_command',
    severity: 'medium',
    pattern: /\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx|ugo\+rwx)\b/,
    explanation: 'Files are made writable by every user on the machine.',
    remediation: 'Grant only the permissions needed, for example 755 for a script or 644 for data.',
    softenWhen: SOFTEN,
  },
  {
    id: 'CMD-SUDO',
    category: 'dangerous_command',
    severity: 'low',
    pattern: /(?:^|[\s;&|`(])sudo\s+-?[a-zA-Z]/,
    explanation: 'A command runs with administrator privileges.',
    remediation:
      'Avoid sudo where possible. If it is required, explain why so the user can decide.',
    softenWhen: { negated: 1 },
  },
  {
    id: 'CMD-DISK-TOOLS',
    category: 'dangerous_command',
    severity: 'high',
    pattern:
      /\b(?:mkfs(?:\.\w+)?\s|fdisk\s|sfdisk\s|parted\s|wipefs\s|diskutil\s+(?:erase\w*|partition\w*|zeroDisk|reformat|secureErase)\b|dd\s[^\n]{0,200}\bof=\/dev\/(?!null\b|zero\b|stdout\b|stderr\b))/,
    explanation: 'A disk or partition tool can erase or reformat a drive.',
    remediation: 'Remove disk and partition operations from the skill.',
    softenWhen: SOFTEN,
  },
  {
    id: 'CMD-HISTORY-LOG-WIPE',
    category: 'dangerous_command',
    severity: 'high',
    pattern:
      /\bhistory\s+-c\b|\bunset\s+HISTFILE\b|\bHISTFILE=\/dev\/null\b|\b(?:rm|shred)\s[^\n]{0,120}\.(?:bash|zsh|sh)_history\b|>\s*~?\/?[^\s]{0,40}\.(?:bash|zsh)_history\b|\b(?:shred|truncate|rm)\s[^\n]{0,120}\/var\/log\/|>\s*\/var\/log\/\S|\bwevtutil\s+cl\b|\bClear-EventLog\b/,
    explanation: 'Shell history or system logs are erased, which hides what was done.',
    remediation: 'Remove commands that clear history or logs.',
    softenWhen: SOFTEN,
  },
  {
    id: 'CMD-EVAL-FETCHED',
    category: 'dangerous_command',
    severity: 'high',
    pattern:
      /\beval\s+["']?\$\(\s*(?:curl|wget)\b|\beval\s+["']?`\s*(?:curl|wget)\b|\b(?:iex|Invoke-Expression)\b[^\n]{0,200}\b(?:DownloadString|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b|\bexec\(\s*(?:requests\.get|urllib\.request\.urlopen|urlopen)\(|\beval\(\s*(?:await\s+)?fetch\(/i,
    explanation: 'Content fetched from the network is evaluated as code.',
    remediation:
      'Never evaluate downloaded content. Ship the code with the skill so it can be reviewed.',
    softenWhen: SOFTEN,
  },
  {
    id: 'CMD-ENCODED-PAYLOAD',
    category: 'dangerous_command',
    severity: 'high',
    pattern: new RegExp(
      String.raw`\b(?:base64\s+(?:-d|--decode|-D)|xxd\s+-r|openssl\s+(?:enc\s+)?(?:-d\s[^\n|]{0,60}-base64|-base64\s[^\n|]{0,60}-d))\b[^\n|]{0,200}\|\s*(?:${SHELL}|${INTERPRETER})|\b(?:powershell|pwsh)(?:\.exe)?\s[^\n]{0,60}-(?:e|en|enc|encodedcommand)\s+[A-Za-z0-9+/=]{16,}`,
      'i',
    ),
    explanation:
      'An encoded payload is decoded and run, so the code that executes cannot be read in the file.',
    remediation: 'Ship readable source instead of encoded commands.',
    softenWhen: SOFTEN,
  },
  {
    id: 'CMD-PERSISTENCE',
    category: 'dangerous_command',
    severity: 'medium',
    pattern:
      /\|\s*crontab\s+-(?:\s|$)|\bcrontab\s+-e\b|\bLibrary\/LaunchAgents\/|\bLibrary\/LaunchDaemons\/|\blaunchctl\s+(?:load|bootstrap)\b|\bsystemctl\s+(?:--user\s+)?enable\b|>>\s*~?\/?[^\s]{0,40}\.(?:bashrc|zshrc|profile|bash_profile|zprofile|zshenv)\b|\bschtasks\s+\/create\b|\\CurrentVersion\\Run\b/i,
    explanation:
      'The skill sets something to run automatically later (scheduled task, login item or shell start-up file).',
    remediation:
      'Do not install persistent jobs or edit shell start-up files. Tell the user what to add if they want it.',
    softenWhen: SOFTEN,
  },
  {
    id: 'CMD-FORK-BOMB',
    category: 'dangerous_command',
    severity: 'high',
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    explanation: 'A fork bomb exhausts the machine by creating processes without limit.',
    remediation: 'Remove it.',
    softenWhen: SOFTEN,
  },
];

export const commandScanner: Scanner = {
  id: 'dangerous-commands',
  version: '1.0.0',
  required: true,
  scan(input, context) {
    // Commands matter in scripts, configuration and Markdown alike.
    return {
      findings: runLineRules(COMMAND_RULES, input.files, context, (file) => file.kind !== 'binary'),
    };
  },
};
