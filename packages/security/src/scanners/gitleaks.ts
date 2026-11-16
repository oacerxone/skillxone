import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { excerptOf, redact } from '../text';
import { makeFinding } from '../rules';
import type { Finding, Scanner, ScanFile } from '../types';

/**
 * Optional adapter to the gitleaks secret scanner (https://github.com/gitleaks/gitleaks).
 *
 * gitleaks is run only when its binary is installed on the worker host; it is never
 * downloaded. Skill files are written as plain data to a private temporary directory and
 * gitleaks reads them; nothing from the skill is executed. When the binary is absent the
 * check is recorded as skipped. It is not a required check: the built-in credential scanner
 * is, so verification never depends on an optional tool.
 */

const run = promisify(execFile);

export interface GitleaksLeak {
  RuleID?: string;
  Description?: string;
  File?: string;
  StartLine?: number;
  EndLine?: number;
  Secret?: string;
  Match?: string;
}

/** Finds an executable named `gitleaks` on PATH. */
export async function findGitleaks(path = process.env.PATH ?? ''): Promise<string | null> {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const name of process.platform === 'win32' ? ['gitleaks.exe'] : ['gitleaks']) {
      const candidate = join(dir, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here.
      }
    }
  }
  return null;
}

/** Converts gitleaks JSON output into findings, with secrets redacted. */
export function leaksToFindings(
  leaks: readonly GitleaksLeak[],
  root: string,
  files: readonly ScanFile[],
): Finding[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const findings: Finding[] = [];
  for (const leak of leaks.slice(0, 200)) {
    const absolute = leak.File ?? '';
    const relative = absolute.startsWith(root + sep)
      ? absolute
          .slice(root.length + 1)
          .split(sep)
          .join('/')
      : absolute;
    const file = byPath.get(relative) ?? null;
    const secret = leak.Secret ?? '';
    const rawExcerpt = leak.Match ?? '';
    const ruleId = String(leak.RuleID ?? 'unknown')
      .replace(/[^A-Za-z0-9-]/g, '')
      .slice(0, 60);
    const finding = makeFinding(
      {
        id: `CRED-GITLEAKS-${ruleId.toUpperCase()}`,
        category: 'credential',
        explanation: `gitleaks reported a possible secret${leak.Description ? ` (${leak.Description})` : ''}.`,
        remediation:
          'If the value is a real credential, revoke it, remove it from the repository history, and load it from the environment instead.',
      },
      'medium',
      file,
      typeof leak.StartLine === 'number' ? leak.StartLine : null,
      secret ? excerptOf(redact(rawExcerpt, secret)) : null,
      `${ruleId}:${secret}`,
    );
    findings.push({
      ...finding,
      lineEnd: typeof leak.EndLine === 'number' ? leak.EndLine : finding.lineEnd,
    });
  }
  return findings;
}

/** Writes text files under `root`, refusing any path that would leave it. */
async function writeTree(root: string, files: readonly ScanFile[]): Promise<void> {
  for (const file of files) {
    if (file.content === null) continue;
    const target = normalize(join(root, file.path));
    if (!target.startsWith(root + sep)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { mode: 0o600 });
  }
}

export function createGitleaksScanner(
  options: { binary?: string | null; timeoutMs?: number } = {},
): Scanner {
  let resolved: Promise<string | null> | null = null;
  const binary = () => {
    if (options.binary !== undefined) return Promise.resolve(options.binary);
    resolved ??= findGitleaks();
    return resolved;
  };

  return {
    id: 'gitleaks',
    version: '1.0.0',
    required: false,
    async scan(input, context) {
      const executable = await binary();
      if (!executable) return { findings: [], skipped: 'gitleaks is not installed on this host.' };

      const root = await realpath(await mkdtemp(join(tmpdir(), 'skillxone-scan-')));
      try {
        const tree = join(root, 'tree');
        await mkdir(tree, { mode: 0o700 });
        await writeTree(tree, input.files);
        const report = join(root, 'report.json');
        const remaining = Math.max(1000, Math.floor(context.deadline - performance.now()));
        await run(
          executable,
          [
            'detect',
            '--no-git',
            '--no-banner',
            '--source',
            tree,
            '--report-format',
            'json',
            '--report-path',
            report,
            '--exit-code',
            '0',
          ],
          {
            timeout: Math.min(options.timeoutMs ?? 30_000, remaining),
            signal: context.signal,
            env: { PATH: process.env.PATH ?? '' },
          },
        );
        const leaks = JSON.parse(await readFile(report, 'utf8')) as GitleaksLeak[];
        return { findings: leaksToFindings(Array.isArray(leaks) ? leaks : [], tree, input.files) };
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { findings: [], skipped: `gitleaks did not complete (${(error as Error).name}).` };
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}
