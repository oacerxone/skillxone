import { createHash } from 'node:crypto';
import { createDefaultScanners, runScan } from './engine';
import type { OsvClient } from './scanners/dependencies';
import type { FileKind, ScanFile, ScanInput } from './types';

/** Test-only helpers: build stored files and scan them with lookups disabled. */

export function file(
  path: string,
  content: string | null,
  overrides: Partial<ScanFile> = {},
): ScanFile {
  const kind: FileKind =
    overrides.kind ??
    (path === 'SKILL.md'
      ? 'skill_md'
      : /(package(-lock)?\.json|requirements\.txt|pyproject\.toml|go\.mod)$/.test(path)
        ? 'manifest'
        : /\.(md|txt)$/.test(path)
          ? 'markdown'
          : /\.(sh|py|js|ts|ps1)$/.test(path)
            ? 'script'
            : 'other');
  return {
    path,
    kind,
    content,
    sizeBytes: content?.length ?? 0,
    isExecutable: false,
    isBinary: false,
    blobSha: createHash('sha1')
      .update(content ?? path)
      .digest('hex'),
    truncated: false,
    ...overrides,
  };
}

export const SKILL_HEADER = '---\nname: demo\ndescription: A demo skill used in tests.\n---\n\n';

export async function scan(
  files: ScanFile[],
  input: Partial<ScanInput> = {},
  osv: OsvClient | null = null,
) {
  return runScan(
    { files, license: 'MIT', ...input },
    { scanners: createDefaultScanners({ osv, gitleaksBinary: null }) },
  );
}

export async function scanSkill(body: string, extra: ScanFile[] = []) {
  return scan([file('SKILL.md', SKILL_HEADER + body), ...extra]);
}
