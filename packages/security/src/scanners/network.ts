import { CHAT_WEBHOOK_PATTERNS, lookupDomain } from '../data/domains';
import type { DomainKind } from '../data/domains';
import { excerptOf, splitLines } from '../text';
import { checkDeadline, isMarkdownFile, makeFinding, runLineRules, shiftSeverity } from '../rules';
import type { LineRule } from '../rules';
import type { Finding, Scanner, ScanContext, ScanFile } from '../types';
import type { Severity } from '@skillxone/shared';

/**
 * Network use and data exfiltration: uploads of local files, reverse shells, DNS tricks,
 * capture services, raw IP hosts and plain-HTTP links.
 */

const SOFTEN = { negated: 2, quoted: 1, comment: 1 } as const;

const UPLOAD =
  /\bcurl\b[^\n]{0,300}?(?:\s(?:-d|--data(?:-binary|-raw|-urlencode)?)\s+["']?@|\s(?:-F|--form)\s+["']?[^\s"'=]{1,60}=["']?@|\s(?:-T|--upload-file)\s)|\bwget\b[^\n]{0,200}--post-file\b|\bscp\s+(?:-[a-zA-Z]+\s+){0,4}[^\s:@]+\s+[^\s]{0,80}[@\w.-]:|\b(?:nc|ncat|netcat)\s[^\n<]{0,100}<\s*\S|\brequests\.(?:post|put)\([^\n]{0,200}\bfiles\s*=/i;

export const NETWORK_RULES: readonly LineRule[] = [
  {
    id: 'NET-UPLOAD-LOCAL-DATA',
    category: 'network_exfiltration',
    severity: 'medium',
    pattern: UPLOAD,
    explanation: 'A local file is sent to a remote host.',
    remediation:
      'Make uploads explicit to the user, name the destination, and never send files the task does not need.',
    softenWhen: SOFTEN,
  },
  {
    id: 'NET-REVERSE-SHELL',
    category: 'network_exfiltration',
    severity: 'critical',
    pattern:
      /\b(?:nc|ncat|netcat)\s[^\n]{0,100}\s-[a-zA-Z]*[ec]\s+\S{0,40}(?:sh|cmd(?:\.exe)?)\b|\/dev\/(?:tcp|udp)\/[^\s/]{1,100}\/\d{1,5}|\bsocat\b[^\n]{0,200}\bexec:/i,
    explanation:
      'The command gives a remote host interactive control of this machine (a reverse shell).',
    remediation: 'Remove it.',
    softenWhen: SOFTEN,
  },
  {
    id: 'NET-DNS-EXFIL',
    category: 'network_exfiltration',
    severity: 'high',
    pattern: /\b(?:nslookup|dig|host|ping)\s[^\n]{0,80}\$\([^)\n]{1,80}\)[^\s]{0,40}\.[a-z]/i,
    explanation:
      'A DNS lookup is built from command output, a known way to smuggle data out through DNS.',
    remediation: 'Remove it.',
    softenWhen: SOFTEN,
  },
  {
    id: 'NET-CLOUD-METADATA',
    category: 'network_exfiltration',
    severity: 'high',
    pattern: /\b169\.254\.169\.254\b|\bmetadata\.google\.internal\b|\bfd00:ec2::254\b/i,
    explanation:
      'The cloud instance metadata service is contacted. On a cloud machine it hands out credentials.',
    remediation: 'Remove access to the metadata service.',
    softenWhen: { ...SOFTEN, prose: 1 },
  },
];

/** True when the text sends data off the machine; used to raise file-access findings. */
export function sendsData(text: string): boolean {
  if (UPLOAD.test(text)) return true;
  if (CHAT_WEBHOOK_PATTERNS.some((pattern) => pattern.test(text))) return true;
  for (const url of extractUrls(text)) {
    if (lookupDomain(url.host)?.kind === 'interaction') return true;
  }
  return /\bcurl\b[^\n]{0,200}\s(?:-X\s*POST|--data|-d\s)/i.test(text);
}

const URL_PATTERN =
  /\b(https?):\/\/([A-Za-z0-9.-]{1,253}|\[[0-9a-fA-F:]{2,39}\])(?::\d{1,5})?(?=[/\s"'`)<>\]?#,;]|$)/g;

export function extractUrls(text: string): Array<{ scheme: string; host: string; raw: string }> {
  const urls: Array<{ scheme: string; host: string; raw: string }> = [];
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null && urls.length < 50) {
    urls.push({ scheme: match[1]!.toLowerCase(), host: match[2]!.toLowerCase(), raw: match[0] });
  }
  return urls;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateOrLocal(host: string): boolean {
  if (host === 'localhost' || host === '0.0.0.0' || host.startsWith('[')) return true;
  if (/\.(?:local|localhost|test|example|invalid|internal|lan|home\.arpa)$/.test(host)) return true;
  if (/^(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/.test(host)) return true;
  const ip = IPV4.exec(host);
  if (!ip) return !host.includes('.');
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Hosts whose http:// URLs are XML/JSON namespace identifiers, never fetched. */
const NAMESPACE_HOSTS = new Set([
  'www.w3.org',
  'w3.org',
  'json-schema.org',
  'schemas.openxmlformats.org',
  'schemas.microsoft.com',
  'purl.org',
  'xmlns.com',
  'ns.adobe.com',
  'www.apache.org',
  'maven.apache.org',
  'schemas.android.com',
  'www.springframework.org',
  'opensource.org',
  'creativecommons.org',
]);

const DOMAIN_SEVERITY: Record<DomainKind, Severity> = {
  interaction: 'high',
  paste: 'medium',
  tunnel: 'medium',
  shortener: 'low',
  'chat-webhook': 'low',
};
const DOMAIN_REASON: Record<DomainKind, string> = {
  interaction: 'a service built to capture whatever is sent to it',
  paste: 'an anonymous paste or file-drop service',
  tunnel: 'a tunnel that exposes a private machine under a public name',
  shortener: 'a link shortener that hides the real destination',
  'chat-webhook': 'a chat webhook, which accepts arbitrary data',
};

function urlFindings(files: readonly ScanFile[], context: ScanContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.content === null || file.kind === 'binary') continue;
    checkDeadline(context);
    const reported = new Set<string>();
    const report = (
      key: string,
      rule: { id: string; explanation: string; remediation: string },
      severity: Severity,
      lineNumber: number,
      text: string,
      matched: string,
      negated: boolean,
    ) => {
      if (reported.has(key)) return;
      reported.add(key);
      // Documentation (Markdown) shows examples; scripts are what actually runs.
      const steps = negated ? 2 : isMarkdownFile(file) && severity === 'high' ? 1 : 0;
      const finalSeverity = shiftSeverity(severity, -steps);
      const note =
        steps === 0
          ? null
          : negated
            ? `Severity lowered from ${severity} because the surrounding text warns against it.`
            : `Severity lowered from ${severity} because it appears in documentation rather than a script.`;
      findings.push(
        makeFinding(
          { ...rule, category: 'network_exfiltration' },
          finalSeverity,
          file,
          lineNumber,
          excerptOf(text),
          matched,
          note,
        ),
      );
    };

    for (const line of splitLines(file).lines) {
      for (const pattern of CHAT_WEBHOOK_PATTERNS) {
        const match = pattern.exec(line.text);
        if (match) {
          report(
            `chat:${match[0]}`,
            {
              id: 'NET-CHAT-WEBHOOK',
              explanation: `The skill sends data to ${DOMAIN_REASON['chat-webhook']}.`,
              remediation:
                'Make sure only the intended message is sent and that the user knows about it.',
            },
            DOMAIN_SEVERITY['chat-webhook'],
            line.number,
            line.text,
            match[0],
            line.negated,
          );
        }
      }
      for (const url of extractUrls(line.text)) {
        const entry = lookupDomain(url.host);
        if (entry) {
          report(
            `domain:${url.host}`,
            {
              id: 'NET-LISTED-DOMAIN',
              explanation: `The skill refers to ${url.host}, ${DOMAIN_REASON[entry.kind]}.`,
              remediation:
                'Use the real destination, and explain why data is sent there. If the domain is listed in error, open an issue.',
            },
            DOMAIN_SEVERITY[entry.kind],
            line.number,
            line.text,
            url.host,
            line.negated,
          );
          continue;
        }
        if (IPV4.test(url.host) && !isPrivateOrLocal(url.host)) {
          report(
            `ip:${url.host}`,
            {
              id: 'NET-RAW-IP-HTTP',
              explanation:
                'A URL points at a raw public IP address instead of a domain name, which hides who runs the server.',
              remediation: 'Use a domain name the user can recognise.',
            },
            'medium',
            line.number,
            line.text,
            url.host,
            line.negated,
          );
          continue;
        }
        if (
          url.scheme === 'http' &&
          !isPrivateOrLocal(url.host) &&
          !NAMESPACE_HOSTS.has(url.host)
        ) {
          report(
            `http:${url.host}`,
            {
              id: 'NET-INSECURE-URL',
              explanation: `A link uses unencrypted http:// (${url.host}), so its content can be altered in transit.`,
              remediation: 'Use https://.',
            },
            'low',
            line.number,
            line.text,
            url.host,
            false,
          );
        }
      }
    }
  }
  return findings;
}

export const networkScanner: Scanner = {
  id: 'network',
  version: '1.0.0',
  required: true,
  scan(input, context) {
    const text = (file: ScanFile) => file.kind !== 'binary';
    return {
      findings: [
        ...runLineRules(NETWORK_RULES, input.files, context, text),
        ...urlFindings(input.files, context),
      ],
    };
  },
};
