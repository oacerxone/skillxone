import type { AgentAdapter } from '../types';

/**
 * OpenAI Codex. Checked 2026-11-16 against the Codex skills documentation (now at
 * https://learn.chatgpt.com/docs/build-skills) and the skills CLI v1.9.0 agent table:
 * repository skills in `.agents/skills/`, personal skills in `~/.agents/skills/`.
 * Codex requires `name` and `description` in the frontmatter.
 */
export const codex: AgentAdapter = {
  id: 'codex',
  label: 'Codex',
  projectDir: '.agents/skills/',
  globalDir: '~/.agents/skills/',
  docsUrl: 'https://learn.chatgpt.com/docs/build-skills',
  afterInstall: 'Codex detects new skills automatically; restart Codex if one does not appear.',
  compatibility(skill) {
    if (!skill.hasDescription) {
      return {
        supported: false,
        warnings: ['Codex requires a description in SKILL.md, and this skill has none.'],
      };
    }
    const warnings: string[] = [];
    if (!skill.specValid) {
      warnings.push(
        'The skill does not fully follow the Agent Skills specification; check that it loads.',
      );
    }
    return { supported: true, warnings };
  },
};
