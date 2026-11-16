import { createHash } from 'node:crypto';

/**
 * Content hash of a skill directory, compatible with the `computedHash` of the open-source
 * `skills` CLI's `skills-lock.json` version 2 (ADR-006), so a hash in a security report can
 * be compared with a user's lock file.
 *
 * Algorithm (from the vercel-labs/skills README, checked 2026-11-16):
 *  1. Take every file in the skill folder, except `metadata.json` files and anything inside
 *     `.git`, `__pycache__` or `__pypackages__`.
 *  2. Paths are relative to the skill folder with `/` separators.
 *  3. Text files (no NUL byte) have CRLF replaced by LF; binary files are unchanged.
 *  4. Sort by the UTF-8 bytes of the path (not locale-aware).
 *  5. Feed `path`, NUL, decimal byte length, NUL, content into one SHA-256.
 *  6. The hash is the lowercase hex digest.
 */
export const HASH_ALGORITHM = 'skills-lock-v2';

export interface HashableFile {
  /** Path relative to the skill directory, `/`-separated. */
  path: string;
  content: Uint8Array;
}

const EXCLUDED_DIRS = new Set(['.git', '__pycache__', '__pypackages__']);

export function isExcludedFromHash(path: string): boolean {
  const segments = path.split('/');
  if (segments[segments.length - 1] === 'metadata.json') return true;
  return segments.slice(0, -1).some((segment) => EXCLUDED_DIRS.has(segment));
}

function normaliseLineEndings(content: Uint8Array): Uint8Array {
  if (content.includes(0)) return content; // binary
  if (!content.includes(13)) return content; // no CR at all
  const out = new Uint8Array(content.length);
  let length = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === 13 && content[i + 1] === 10) continue; // drop the CR of a CRLF pair
    out[length] = content[i]!;
    length += 1;
  }
  return out.subarray(0, length);
}

export function computeContentHash(files: readonly HashableFile[]): string {
  const included = files
    .filter((file) => !isExcludedFromHash(file.path))
    .map((file) => ({ path: Buffer.from(file.path, 'utf8'), content: file.content }))
    .sort((a, b) => Buffer.compare(a.path, b.path));

  const hash = createHash('sha256');
  const NUL = Buffer.from([0]);
  for (const file of included) {
    const content = normaliseLineEndings(file.content);
    hash.update(file.path);
    hash.update(NUL);
    hash.update(String(content.length), 'ascii');
    hash.update(NUL);
    hash.update(content);
  }
  return hash.digest('hex');
}
