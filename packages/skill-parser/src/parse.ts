import { parse as parseYaml } from 'yaml';

/**
 * Parses and validates a SKILL.md file against the Agent Skills specification
 * (agentskills.io/specification, checked 2026-11-16).
 *
 * Real repositories often break the specification. Parsing is therefore tolerant: every
 * problem becomes an issue in the result, and the skill is still indexed whenever a usable
 * name can be determined. Nothing in the file is executed or evaluated.
 */

export type IssueCode =
  | 'MISSING_FRONTMATTER'
  | 'MALFORMED_FRONTMATTER'
  | 'FRONTMATTER_NOT_A_MAPPING'
  | 'MISSING_NAME'
  | 'INVALID_NAME'
  | 'NAME_DIRECTORY_MISMATCH'
  | 'MISSING_DESCRIPTION'
  | 'DESCRIPTION_TOO_LONG'
  | 'COMPATIBILITY_TOO_LONG'
  | 'INVALID_METADATA'
  | 'INVALID_ALLOWED_TOOLS'
  | 'INVALID_LICENSE'
  | 'EMPTY_BODY'
  | 'FILE_TOO_LARGE';

export interface ParseIssue {
  code: IssueCode;
  message: string;
  /** `error` breaks the specification; `warning` is a quality concern. */
  level: 'error' | 'warning';
}

export interface ParsedSkill {
  /** Display name: the frontmatter name when present, otherwise the directory name. */
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  allowedTools: string | null;
  metadata: Record<string, string>;
  /** Frontmatter keys that are not part of the open specification (agent extensions). */
  extensionKeys: string[];
  /** The whole frontmatter mapping as JSON-safe data, for storage. */
  frontmatter: Record<string, unknown>;
  body: string;
  issues: ParseIssue[];
  /** True when there are no `error` issues. */
  specValid: boolean;
}

const SPEC_KEYS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
export const MAX_SKILL_MD_BYTES = 512 * 1024;

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Converts parsed YAML into plain JSON-safe data, dropping anything exotic. */
function toJsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => toJsonSafe(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
      // Skip keys that could pollute a prototype if the object is later merged.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = toJsonSafe(item, depth + 1);
    }
    return out;
  }
  return null;
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : null;

export function parseSkillMd(source: string, directoryName: string): ParsedSkill {
  const issues: ParseIssue[] = [];
  const error = (code: IssueCode, message: string) =>
    issues.push({ code, message, level: 'error' });
  const warning = (code: IssueCode, message: string) =>
    issues.push({ code, message, level: 'warning' });

  let text = source;
  if (Buffer.byteLength(text) > MAX_SKILL_MD_BYTES) {
    warning('FILE_TOO_LARGE', `SKILL.md exceeds ${MAX_SKILL_MD_BYTES} bytes and was truncated.`);
    text = text.slice(0, MAX_SKILL_MD_BYTES);
  }

  let frontmatter: Record<string, unknown> = {};
  let body = text;
  const match = FRONTMATTER.exec(text);
  if (!match) {
    error('MISSING_FRONTMATTER', 'SKILL.md must start with YAML frontmatter between --- lines.');
  } else {
    body = text.slice(match[0].length);
    const raw = match[1] ?? '';
    if (Buffer.byteLength(raw) > MAX_FRONTMATTER_BYTES) {
      error('MALFORMED_FRONTMATTER', 'Frontmatter is unreasonably large.');
    } else {
      try {
        // `core` schema: plain YAML types only, no custom tags. Alias expansion is bounded
        // to stop "billion laughs" documents.
        const parsed: unknown = parseYaml(raw, {
          schema: 'core',
          maxAliasCount: 50,
          logLevel: 'error', // unknown tags fall back to plain values without console noise
        });
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          error(
            'FRONTMATTER_NOT_A_MAPPING',
            'Frontmatter must be a YAML mapping of keys to values.',
          );
        } else {
          frontmatter = toJsonSafe(parsed) as Record<string, unknown>;
        }
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message.split('\n')[0] : 'invalid YAML';
        error('MALFORMED_FRONTMATTER', `Frontmatter is not valid YAML: ${detail}`);
      }
    }
  }

  const declaredName = asText(frontmatter.name);
  if (!declaredName) {
    error('MISSING_NAME', 'Frontmatter is missing the required "name" field.');
  } else {
    if (declaredName.length > 64 || !NAME_PATTERN.test(declaredName)) {
      error(
        'INVALID_NAME',
        'Name must be 1-64 characters of lowercase letters, digits and single hyphens, not starting or ending with a hyphen.',
      );
    }
    if (directoryName && declaredName !== directoryName) {
      error(
        'NAME_DIRECTORY_MISMATCH',
        `Name "${declaredName.slice(0, 80)}" does not match its directory "${directoryName.slice(0, 80)}".`,
      );
    }
  }

  const description = asText(frontmatter.description) ?? '';
  if (!description) {
    error('MISSING_DESCRIPTION', 'Frontmatter is missing the required "description" field.');
  } else if (description.length > 1024) {
    error('DESCRIPTION_TOO_LONG', 'Description is longer than 1024 characters.');
  }

  let license: string | null = null;
  if (frontmatter.license !== undefined && frontmatter.license !== null) {
    license = asText(frontmatter.license);
    if (license === null) warning('INVALID_LICENSE', 'License should be a string.');
  }

  const compatibility = asText(frontmatter.compatibility);
  if (compatibility && compatibility.length > 500) {
    error('COMPATIBILITY_TOO_LONG', 'Compatibility is longer than 500 characters.');
  }

  const metadata: Record<string, string> = {};
  if (frontmatter.metadata !== undefined && frontmatter.metadata !== null) {
    const value = frontmatter.metadata;
    if (typeof value !== 'object' || Array.isArray(value)) {
      error('INVALID_METADATA', 'Metadata must be a mapping of string keys to string values.');
    } else {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (typeof item === 'string') metadata[key] = item;
        else {
          // Numbers and booleans are common in practice; keep them as text but flag it.
          if (typeof item === 'number' || typeof item === 'boolean') metadata[key] = String(item);
          warning(
            'INVALID_METADATA',
            `Metadata value for "${key.slice(0, 60)}" should be a string.`,
          );
        }
      }
    }
  }

  let allowedTools: string | null = null;
  const tools = frontmatter['allowed-tools'];
  if (tools !== undefined && tools !== null) {
    if (typeof tools === 'string') allowedTools = tools.trim();
    else if (Array.isArray(tools) && tools.every((t) => typeof t === 'string')) {
      // Claude Code accepts a list; the open specification says a space-separated string.
      allowedTools = (tools as string[]).join(' ');
      warning('INVALID_ALLOWED_TOOLS', 'allowed-tools should be a space-separated string.');
    } else {
      error('INVALID_ALLOWED_TOOLS', 'allowed-tools must be a space-separated string.');
    }
  }

  if (body.trim().length === 0) {
    warning('EMPTY_BODY', 'SKILL.md has no instructions after the frontmatter.');
  }

  return {
    name: declaredName ? declaredName.slice(0, 200) : directoryName,
    description: description.slice(0, 2000),
    license: license ? license.slice(0, 200) : null,
    compatibility: compatibility ? compatibility.slice(0, 1000) : null,
    allowedTools: allowedTools ? allowedTools.slice(0, 2000) : null,
    metadata,
    extensionKeys: Object.keys(frontmatter).filter((key) => !SPEC_KEYS.has(key)),
    frontmatter,
    body,
    issues,
    specValid: issues.every((issue) => issue.level !== 'error'),
  };
}
