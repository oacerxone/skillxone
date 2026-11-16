/**
 * Domain reputation list used by the network scanner.
 *
 * Kept in the repository and changed only by reviewed pull request (CODEOWNERS covers
 * packages/security). Each entry says why it is listed. A listing is not an accusation:
 * these services have legitimate uses, but a skill sending data to them deserves a look.
 *
 * Matching is by host suffix: `webhook.site` also matches `abc.webhook.site`.
 */

export type DomainKind = 'interaction' | 'paste' | 'tunnel' | 'shortener' | 'chat-webhook';

export interface DomainEntry {
  domain: string;
  kind: DomainKind;
}

const entries = (kind: DomainKind, domains: string[]): DomainEntry[] =>
  domains.map((domain) => ({ domain, kind }));

export const DOMAIN_LIST: readonly DomainEntry[] = [
  // Request inspection and out-of-band interaction services: built to capture whatever is sent.
  ...entries('interaction', [
    'webhook.site',
    'requestbin.com',
    'requestbin.net',
    'requestcatcher.com',
    'hookbin.com',
    'pipedream.net',
    'beeceptor.com',
    'interact.sh',
    'oast.fun',
    'oast.live',
    'oast.me',
    'oast.online',
    'oast.pro',
    'oast.site',
    'burpcollaborator.net',
    'oastify.com',
    'canarytokens.com',
    'dnslog.cn',
  ]),
  // Anonymous paste and file-drop services.
  ...entries('paste', [
    'pastebin.com',
    'paste.ee',
    'hastebin.com',
    'ghostbin.com',
    'transfer.sh',
    'file.io',
    '0x0.st',
    'termbin.com',
    'temp.sh',
    'catbox.moe',
  ]),
  // Tunnels that expose a private machine under a public name.
  ...entries('tunnel', [
    'ngrok.io',
    'ngrok-free.app',
    'ngrok.app',
    'trycloudflare.com',
    'loca.lt',
    'serveo.net',
    'localhost.run',
  ]),
  // Link shorteners hide the real destination.
  ...entries('shortener', [
    'bit.ly',
    'tinyurl.com',
    'is.gd',
    'goo.gl',
    't.ly',
    'cutt.ly',
    'rb.gy',
    'shorturl.at',
    'ow.ly',
  ]),
];

/** Chat webhooks: often legitimate (notifications), but they accept arbitrary data. */
export const CHAT_WEBHOOK_PATTERNS: readonly RegExp[] = [
  /\bdiscord(?:app)?\.com\/api\/webhooks\//i,
  /\bhooks\.slack\.com\/services\//i,
  /\bapi\.telegram\.org\/bot/i,
];

export function lookupDomain(host: string): DomainEntry | null {
  const lower = host.toLowerCase().replace(/\.$/, '');
  for (const entry of DOMAIN_LIST) {
    if (lower === entry.domain || lower.endsWith(`.${entry.domain}`)) return entry;
  }
  return null;
}
