/**
 * Install commands for the project's own skill (skills/skillxone in the repository).
 * Built from constants only; the web app shows them and never runs them.
 */
import { repositoryFullName } from './navigation';

const repo = (repositoryFullName() ?? ['oacerxone', 'skillxone']).join('/');

export const OWN_SKILL_NAME = 'skillxone';

export const ownSkillInstall = {
  claudeCode: `npx skills add ${repo} --skill ${OWN_SKILL_NAME} -a claude-code`,
  codex: `npx skills add ${repo} --skill ${OWN_SKILL_NAME} -a codex`,
  claudeCodeGlobal: `npx skills add ${repo} --skill ${OWN_SKILL_NAME} -a claude-code -g`,
  codexGlobal: `npx skills add ${repo} --skill ${OWN_SKILL_NAME} -a codex -g`,
} as const;

/** The companion skill (skills/skillxone-audit): audits what is already installed. */
export const AUDIT_SKILL_NAME = 'skillxone-audit';

export const auditSkillInstall = {
  claudeCode: `npx skills add ${repo} --skill ${AUDIT_SKILL_NAME} -a claude-code -g`,
  codex: `npx skills add ${repo} --skill ${AUDIT_SKILL_NAME} -a codex -g`,
} as const;
