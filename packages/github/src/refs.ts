/**
 * Parsing and validation of GitHub repository references.
 *
 * Every owner and repository name that reaches a URL is validated here first. User input is
 * never fetched as a URL: it is reduced to an `owner/repo` pair, and requests are then built
 * against fixed GitHub hosts. That removes the server-side request forgery surface.
 */

export interface RepoRef {
  owner: string;
  repo: string;
}

// GitHub: owner is 1-39 alphanumerics with single inner hyphens; repository names allow . _ -
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

export function isValidRepoRef(ref: RepoRef): boolean {
  return OWNER.test(ref.owner) && REPO.test(ref.repo);
}

/**
 * Accepts `owner/repo`, `https://github.com/owner/repo`, the same with `.git`, a trailing
 * slash or a deeper path (`/tree/main/...`). Anything else returns null, including other
 * hosts, other schemes, credentials in the URL and non-standard ports.
 */
export function parseRepoRef(input: string): RepoRef | null {
  const text = input.trim();
  if (text.length === 0 || text.length > 300) return null;

  let owner: string | undefined;
  let repo: string | undefined;

  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:') return null;
    if (
      url.hostname.toLowerCase() !== 'github.com' &&
      url.hostname.toLowerCase() !== 'www.github.com'
    ) {
      return null;
    }
    if (url.username || url.password || url.port) return null;
    [owner, repo] = url.pathname.split('/').filter(Boolean);
  } else {
    const parts = text.split('/');
    if (parts.length !== 2) return null;
    [owner, repo] = parts;
  }

  if (!owner || !repo) return null;
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);
  const ref = { owner, repo };
  return isValidRepoRef(ref) ? ref : null;
}

export const fullName = (ref: RepoRef) => `${ref.owner}/${ref.repo}`;

/** Extracts distinct GitHub repositories linked from a Markdown document (awesome lists). */
export function extractRepoLinks(markdown: string, limit = 500): RepoRef[] {
  const seen = new Map<string, RepoRef>();
  for (const match of markdown.matchAll(
    /https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}/g,
  )) {
    // A sentence-ending full stop right after a link is not part of the repository name.
    const ref = parseRepoRef(match[0].replace(/\.+$/, ''));
    if (!ref) continue;
    const key = fullName(ref).toLowerCase();
    if (!seen.has(key)) seen.set(key, ref);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}
