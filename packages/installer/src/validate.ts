/**
 * Validation of everything that ends up in a command. Repository coordinates must match
 * GitHub's own rules exactly and are rejected, never quoted, when they do not.
 */

// GitHub: owner is 1-39 alphanumerics or single inner hyphens; repository is letters, digits, . _ -
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
/** Agent Skills specification: lowercase alphanumerics and single hyphens, 1-64 characters. */
export const SPEC_SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._ +@-]{1,100}$/;

export const isValidOwner = (value: string) => OWNER.test(value);
export const isValidRepo = (value: string) => REPO.test(value);
export const isValidCommitSha = (value: string) => COMMIT_SHA.test(value);

/** Null when the name can be used (quoted if needed), otherwise the reason it cannot. */
export function skillNameProblem(name: string): string | null {
  if (name.length === 0) return 'The skill has no name.';
  if (name.length > 128) return 'The skill name is longer than 128 characters.';
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))
    return 'The skill name contains control or invisible characters.';
  if (name !== name.trim()) return 'The skill name starts or ends with a space.';
  if (name.startsWith('-'))
    return 'The skill name starts with a dash, which the CLI would read as an option.';
  return null;
}

/** Splits a repository path into safe segments, or returns null if any segment is unsafe. */
export function skillPathSegments(path: string): string[] | null {
  if (path === '') return [];
  const segments = path.split('/');
  return segments.every((segment) => PATH_SEGMENT.test(segment)) ? segments : null;
}

/**
 * The folder name the skills CLI gives a skill, mirroring `sanitizeName` in
 * vercel-labs/skills v1.9.0 (src/sanitize.ts): lowercase, runs of other characters become
 * one hyphen, leading and trailing dots and hyphens removed, at most 255 characters.
 */
export function cliFolderName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return sanitized.slice(0, 255) || 'unnamed-skill';
}
