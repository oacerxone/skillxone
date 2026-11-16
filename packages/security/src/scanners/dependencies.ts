import type { Severity } from '@skillxone/shared';
import { makeFinding } from '../rules';
import type { Finding, Scanner, ScanFile } from '../types';

/**
 * Known vulnerabilities in dependencies declared inside the skill directory, looked up in
 * the OSV.dev database. Only exact versions are looked up; ranges are reported as `info`
 * rather than guessed. If OSV cannot be reached the check is recorded as skipped, which
 * keeps the skill UNVERIFIED instead of passing silently.
 */

export type Ecosystem = 'npm' | 'PyPI';

export interface PackageRef {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

export interface Vulnerability {
  id: string;
  summary: string;
  severity: Severity;
}

export interface OsvClient {
  /** Vulnerabilities for each package, in input order. Throws when OSV is unreachable. */
  query(packages: readonly PackageRef[], signal: AbortSignal): Promise<Vulnerability[][]>;
}

export class OsvUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsvUnavailableError';
  }
}

const OSV_API = 'https://api.osv.dev/v1';
const MAX_PACKAGES = 1000;
const MAX_DETAIL_LOOKUPS = 100;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 10_000;

const GHSA_SEVERITY: Record<string, Severity> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
};

/**
 * OSV.dev client with an in-process cache keyed by package and version. The batch endpoint
 * returns only ids, so details (summary and severity) are fetched per vulnerability.
 */
export function createOsvClient(
  options: { fetch?: typeof fetch; timeoutMs?: number; userAgent?: string } = {},
): OsvClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const packageCache = new Map<string, { at: number; ids: string[] }>();
  const detailCache = new Map<string, Vulnerability>();
  const headers = {
    'content-type': 'application/json',
    'user-agent': options.userAgent ?? 'skillxone-security-scanner',
  };

  const call = async (url: string, signal: AbortSignal, body?: unknown) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new OsvUnavailableError(`OSV.dev could not be reached (${(error as Error).name}).`);
    }
    if (!response.ok) throw new OsvUnavailableError(`OSV.dev answered HTTP ${response.status}.`);
    return (await response.json()) as unknown;
  };

  const key = (pkg: PackageRef) => `${pkg.ecosystem}\0${pkg.name.toLowerCase()}\0${pkg.version}`;

  return {
    async query(packages, signal) {
      const now = Date.now();
      const missing = packages.filter((pkg) => {
        const hit = packageCache.get(key(pkg));
        return !hit || now - hit.at > CACHE_TTL_MS;
      });
      for (let start = 0; start < missing.length; start += 500) {
        const chunk = missing.slice(start, start + 500);
        const result = (await call(`${OSV_API}/querybatch`, signal, {
          queries: chunk.map((pkg) => ({
            package: { ecosystem: pkg.ecosystem, name: pkg.name },
            version: pkg.version,
          })),
        })) as { results?: Array<{ vulns?: Array<{ id?: unknown }> }> };
        chunk.forEach((pkg, index) => {
          const ids = (result.results?.[index]?.vulns ?? [])
            .map((v) => v.id)
            .filter((id): id is string => typeof id === 'string');
          if (packageCache.size >= CACHE_LIMIT) packageCache.clear();
          packageCache.set(key(pkg), { at: now, ids });
        });
      }

      const ids = packages.map((pkg) => packageCache.get(key(pkg))?.ids ?? []);
      const unknown = [...new Set(ids.flat())].filter((id) => !detailCache.has(id));
      for (const id of unknown.slice(0, MAX_DETAIL_LOOKUPS)) {
        if (!/^[A-Za-z0-9._:-]{3,80}$/.test(id)) continue;
        const detail = (await call(`${OSV_API}/vulns/${encodeURIComponent(id)}`, signal)) as {
          summary?: unknown;
          database_specific?: { severity?: unknown };
        };
        const label = String(detail.database_specific?.severity ?? '').toUpperCase();
        detailCache.set(id, {
          id,
          summary: typeof detail.summary === 'string' ? detail.summary.slice(0, 300) : '',
          // Without a published severity, assume medium: it blocks VERIFIED but does not flag.
          severity: GHSA_SEVERITY[label] ?? 'medium',
        });
      }
      return ids.map((list) =>
        list.map((id) => detailCache.get(id) ?? { id, summary: '', severity: 'medium' as const }),
      );
    },
  };
}

// ---------------------------------------------------------------------------------------
// Manifest parsing. Pure; no package is installed or resolved.

export interface ManifestResult {
  packages: PackageRef[];
  unpinned: string[];
  error?: string;
}

const EXACT_SEMVER = /^=?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,60})?)$/;
const PEP508_NAME = /^([A-Za-z0-9][A-Za-z0-9._-]{0,100})/;

export function parsePackageJson(content: string): ManifestResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { packages: [], unpinned: [], error: 'package.json is not valid JSON.' };
  }
  const result: ManifestResult = { packages: [], unpinned: [] };
  if (!data || typeof data !== 'object') return result;
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const deps = (data as Record<string, unknown>)[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== 'string') continue;
      const exact = EXACT_SEMVER.exec(spec.trim());
      if (exact && field !== 'peerDependencies')
        result.packages.push({ ecosystem: 'npm', name, version: exact[1]! });
      else result.unpinned.push(name);
    }
  }
  return result;
}

export function parsePackageLock(content: string): ManifestResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { packages: [], unpinned: [], error: 'package-lock.json is not valid JSON.' };
  }
  const result: ManifestResult = { packages: [], unpinned: [] };
  const packages = (data as { packages?: Record<string, { version?: unknown }> } | null)?.packages;
  if (!packages || typeof packages !== 'object') return result;
  for (const [path, entry] of Object.entries(packages)) {
    const name = path.split('node_modules/').pop();
    if (!path || !name || typeof entry?.version !== 'string') continue;
    const exact = EXACT_SEMVER.exec(entry.version);
    if (exact) result.packages.push({ ecosystem: 'npm', name, version: exact[1]! });
  }
  return result;
}

function parseRequirement(line: string, result: ManifestResult): void {
  const text = line
    .replace(/\s+#.*$/, '')
    .split(';')[0]!
    .trim();
  if (!text || text.startsWith('#') || text.startsWith('-')) return;
  const name = PEP508_NAME.exec(text)?.[1];
  if (!name) return;
  const pinned =
    /^[A-Za-z0-9._-]+(?:\[[^\]]{0,100}\])?\s*===?\s*([0-9][0-9A-Za-z.+!-]{0,60})\s*$/.exec(text);
  if (pinned) result.packages.push({ ecosystem: 'PyPI', name, version: pinned[1]! });
  else result.unpinned.push(name);
}

export function parseRequirementsTxt(content: string): ManifestResult {
  const result: ManifestResult = { packages: [], unpinned: [] };
  for (const line of content.split(/\r?\n/).slice(0, 5000)) parseRequirement(line, result);
  return result;
}

/** Reads PEP 621 `dependencies = [...]` and `optional-dependencies` arrays from pyproject.toml. */
export function parsePyproject(content: string): ManifestResult {
  const result: ManifestResult = { packages: [], unpinned: [] };
  for (const section of content.split(/^(?=\s*\[)/m)) {
    const header = /^\s*\[([^\]]+)\]/.exec(section)?.[1]?.trim() ?? '';
    const inProject = header === 'project';
    if (!inProject && header !== 'project.optional-dependencies') continue;
    for (const match of section.matchAll(
      /^\s*([A-Za-z0-9_-]{1,40})\s*=\s*\[([^\]]{0,20000})\]/gm,
    )) {
      if (inProject && match[1] !== 'dependencies') continue;
      for (const item of match[2]!.matchAll(/["']([^"'\n]{1,200})["']/g))
        parseRequirement(item[1]!, result);
    }
  }
  return result;
}

const PARSERS: Record<string, (content: string) => ManifestResult> = {
  'package.json': parsePackageJson,
  'package-lock.json': parsePackageLock,
  'requirements.txt': parseRequirementsTxt,
  'pyproject.toml': parsePyproject,
};

const basename = (path: string) => path.split('/').pop() ?? path;
export const isManifest = (file: Pick<ScanFile, 'kind'>) => file.kind === 'manifest';

const RULES = {
  vulnerable: {
    id: 'DEP-KNOWN-VULNERABILITY',
    category: 'dependency' as const,
    explanation: 'A pinned dependency has a known vulnerability.',
    remediation: 'Upgrade to a version without the vulnerability.',
  },
  unpinned: {
    id: 'DEP-UNPINNED',
    category: 'dependency' as const,
    explanation:
      'Some dependencies use version ranges, so what gets installed can change over time; ranges are not checked for vulnerabilities.',
    remediation: 'Pin exact versions, or commit a lockfile.',
  },
  unparseable: {
    id: 'DEP-MANIFEST-UNPARSEABLE',
    category: 'dependency' as const,
    explanation: 'A dependency manifest could not be parsed, so its dependencies were not checked.',
    remediation: 'Fix the manifest syntax.',
  },
};

export function createDependencyScanner(osv: OsvClient | null): Scanner {
  return {
    id: 'dependencies',
    version: '1.0.0',
    required: (input) => input.files.some(isManifest),
    async scan(input, context) {
      const manifests = input.files.filter(isManifest);
      if (manifests.length === 0) {
        return { findings: [], skipped: 'No dependency manifest in the skill directory.' };
      }
      const findings: Finding[] = [];
      const unsupported: string[] = [];
      const lookups: Array<{ file: ScanFile; pkg: PackageRef }> = [];

      for (const file of manifests) {
        const parser = PARSERS[basename(file.path)];
        if (!parser || file.content === null) {
          unsupported.push(file.path);
          continue;
        }
        const parsed = parser(file.content);
        if (parsed.error) {
          findings.push(
            makeFinding(
              {
                ...RULES.unparseable,
                explanation: `${RULES.unparseable.explanation} ${parsed.error}`,
              },
              'low',
              file,
              null,
              null,
              parsed.error,
            ),
          );
          continue;
        }
        if (parsed.unpinned.length > 0) {
          const names = [...new Set(parsed.unpinned)].sort();
          findings.push(
            makeFinding(
              RULES.unpinned,
              'info',
              file,
              null,
              `${names.length} unpinned: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}`,
              names.join(','),
            ),
          );
        }
        for (const pkg of parsed.packages) lookups.push({ file, pkg });
      }

      if (lookups.length > 0) {
        if (!osv)
          return {
            findings,
            skipped: 'Vulnerability lookups are disabled (no OSV client configured).',
          };
        const unique = new Map<string, { file: ScanFile; pkg: PackageRef }>();
        for (const item of lookups)
          unique.set(
            `${item.file.path}\0${item.pkg.ecosystem}\0${item.pkg.name}\0${item.pkg.version}`,
            item,
          );
        const items = [...unique.values()].slice(0, MAX_PACKAGES);
        let results: Vulnerability[][];
        try {
          results = await osv.query(
            items.map((item) => item.pkg),
            context.signal,
          );
        } catch (error) {
          if (error instanceof OsvUnavailableError) return { findings, skipped: error.message };
          throw error;
        }
        items.forEach((item, index) => {
          for (const vuln of results[index] ?? []) {
            findings.push(
              makeFinding(
                {
                  ...RULES.vulnerable,
                  explanation: `${item.pkg.name}@${item.pkg.version} is affected by ${vuln.id}${vuln.summary ? `: ${vuln.summary}` : '.'}`,
                },
                vuln.severity,
                item.file,
                null,
                `${item.pkg.name}@${item.pkg.version} (${vuln.id})`,
                `${item.pkg.ecosystem}:${item.pkg.name}@${item.pkg.version}:${vuln.id}`,
              ),
            );
          }
        });
      }

      if (unsupported.length > 0) {
        return {
          findings,
          skipped: `Manifest format not supported yet, dependencies not checked: ${unsupported.join(', ')}.`,
        };
      }
      return { findings };
    },
  };
}
