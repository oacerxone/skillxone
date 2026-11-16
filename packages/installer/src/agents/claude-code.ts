import type { AgentAdapter } from '../types';

/**
 * Claude Code. Checked 2026-11-16 against https://code.claude.com/docs/en/skills and the
 * skills CLI v1.9.0 agent table: project skills in `.claude/skills/`, personal skills in
 * `~/.claude/skills/`. Names with control or zero-width characters, `<` or `>`, or leading
 * or trailing spaces are refused by Claude Code.
 */
export const claudeCode: AgentAdapter = {
  id: 'claude-code',
  label: 'Claude Code',
  projectDir: '.claude/skills/',
  globalDir: '~/.claude/skills/',
  docsUrl: 'https://code.claude.com/docs/en/skills',
  afterInstall:
    'Edits to existing skills are picked up live; run /reload-skills if the skills folder is new, or restart Claude Code.',
  compatibility(skill) {
    const warnings: string[] = [];
    if (
      /[\p{Cc}\u200B-\u200D\u2060\uFEFF<>]/u.test(skill.name) ||
      skill.name !== skill.name.trim()
    ) {
      return {
        supported: false,
        warnings: [
          'Claude Code refuses skill names with control characters, angle brackets or surrounding spaces.',
        ],
      };
    }
    if (!skill.hasDescription) {
      warnings.push(
        'SKILL.md has no description, so Claude Code has little to decide when to use it.',
      );
    }
    if (!skill.specValid) {
      warnings.push(
        'The skill does not fully follow the Agent Skills specification; check that it loads.',
      );
    }
    return { supported: true, warnings };
  },
};
