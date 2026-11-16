import type { ParsedSkill } from './parse';
import type { SkillFileEntry } from './locate';

/** Derived metadata: agent compatibility, dependencies, references and a category guess. */

export interface AgentCompatibility {
  agentId: string;
  level: 'declared' | 'inferred' | 'unsupported';
  evidence: string;
  warnings: string[];
}

/** Frontmatter keys that only Claude Code understands (code.claude.com/docs/en/skills). */
const CLAUDE_ONLY_KEYS = new Set([
  'context',
  'agent',
  'hooks',
  'model',
  'disable-model-invocation',
  'user-invocable',
  'argument-hint',
  'when_to_use',
  'paths',
  'effort',
]);

export function inferAgentCompatibility(
  directory: string,
  parsed: ParsedSkill,
  files: readonly SkillFileEntry[],
): AgentCompatibility[] {
  const inClaudeDir = /(^|\/)\.claude\/skills(\/|$)/.test(directory);
  const inAgentsDir = /(^|\/)\.(agents|codex)\/skills(\/|$)/.test(directory);
  const hasOpenAiConfig = files.some((f) => f.relativePath === 'agents/openai.yaml');
  const claudeKeys = parsed.extensionKeys.filter((key) => CLAUDE_ONLY_KEYS.has(key));
  const standard = 'Standard SKILL.md layout that this agent can load.';

  return [
    {
      agentId: 'claude-code',
      level: inClaudeDir ? 'declared' : 'inferred',
      evidence: inClaudeDir ? 'Located under .claude/skills in the source repository.' : standard,
      warnings: [],
    },
    {
      agentId: 'codex',
      level: inAgentsDir || hasOpenAiConfig ? 'declared' : 'inferred',
      evidence: hasOpenAiConfig
        ? 'Ships agents/openai.yaml.'
        : inAgentsDir
          ? 'Located under .agents/skills in the source repository.'
          : standard,
      warnings:
        claudeKeys.length > 0
          ? [`Uses Claude Code frontmatter that Codex ignores: ${claudeKeys.join(', ')}.`]
          : [],
    },
  ];
}

export interface DependencyManifest {
  path: string;
  ecosystem: 'npm' | 'PyPI' | 'RubyGems' | 'Go' | 'crates.io';
}

const ECOSYSTEMS: Record<string, DependencyManifest['ecosystem']> = {
  'package.json': 'npm',
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'npm',
  'yarn.lock': 'npm',
  'requirements.txt': 'PyPI',
  'pyproject.toml': 'PyPI',
  Pipfile: 'PyPI',
  'Pipfile.lock': 'PyPI',
  'poetry.lock': 'PyPI',
  'uv.lock': 'PyPI',
  Gemfile: 'RubyGems',
  'Gemfile.lock': 'RubyGems',
  'go.mod': 'Go',
  'go.sum': 'Go',
  'Cargo.toml': 'crates.io',
  'Cargo.lock': 'crates.io',
};

/** Dependency manifests inside the skill directory. Versions are resolved by the scanner (Phase 5). */
export function detectDependencyManifests(files: readonly SkillFileEntry[]): DependencyManifest[] {
  return files.flatMap((file) => {
    const name = file.relativePath.split('/').pop() ?? '';
    const ecosystem = ECOSYSTEMS[name];
    return ecosystem ? [{ path: file.relativePath, ecosystem }] : [];
  });
}

/** Relative paths the SKILL.md body links to, and whether each exists in the skill directory. */
export function extractReferences(
  body: string,
  files: readonly SkillFileEntry[],
): Array<{ path: string; exists: boolean }> {
  const known = new Set(files.map((f) => f.relativePath));
  const found = new Set<string>();
  // Markdown links and images: [text](target). Bounded quantifiers keep matching linear.
  for (const match of body.matchAll(/\]\(([^)\s]{1,300})\)/g)) {
    const target = (match[1] ?? '').split('#')[0] ?? '';
    if (
      !target ||
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      target.startsWith('/') ||
      target.startsWith('..')
    ) {
      continue;
    }
    found.add(target.replace(/^\.\//, ''));
    if (found.size >= 100) break;
  }
  return [...found].map((path) => ({ path, exists: known.has(path) }));
}

const CATEGORY_KEYWORDS: Array<[slug: string, pattern: RegExp]> = [
  ['security', /\b(security|vulnerab|threat|pentest|secret|owasp|audit)\w*/i],
  ['testing', /\b(tests?|testing|qa|debug|playwright|jest|pytest|coverage)\b/i],
  [
    'devops',
    /\b(docker|kubernetes|k8s|terraform|ci\/cd|deploy|pipeline|infrastructure|aws|gcp|azure)\w*/i,
  ],
  ['data', /\b(sql|database|data ?pipeline|analytics|pandas|notebook|csv|bigquery|postgres)\w*/i],
  ['documents', /\b(pdf|docx|xlsx|pptx|spreadsheet|slides?|word document|excel|powerpoint)\b/i],
  ['design', /\b(design|frontend|front-end|css|ui|ux|figma|accessib|tailwind|component)\w*/i],
  ['documentation', /\b(documentation|readme|changelog|docs|technical writing|api reference)\b/i],
  ['agents', /\b(skill|agent|mcp|prompt|subagent|claude code|codex)\w*/i],
  ['research', /\b(research|literature|paper|summari[sz]e|web search)\w*/i],
  [
    'productivity',
    /\b(planning|project management|meeting|workflow|productivity|tickets?|jira|linear)\b/i,
  ],
  ['development', /\b(code|refactor|review|commit|git|typescript|python|api|backend|library)\w*/i],
];

/**
 * A first guess at one category from the name and description. It is stored with
 * `source = 'auto'` and can be overridden by a curator; it is never shown as authoritative.
 */
export function guessCategory(name: string, description: string): string {
  const text = `${name.replace(/-/g, ' ')} ${description}`;
  return CATEGORY_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}
