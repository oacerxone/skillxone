/**
 * Install command generation for the install panel.
 *
 * PHASE 2 STUB. This covers Claude Code and Codex with the `skills` CLI only and lives in
 * the web app. Phase 6 replaces it with `packages/installer` (agent adapters, a manual-copy
 * method, compatibility checks and a contract test against the real CLI). The safety
 * property is already final, though: commands are built from an argument list, and every
 * argument must match a strict allowlist pattern or no command is produced at all.
 * Nothing here is ever executed by the server.
 *
 * CLI interface checked against vercel-labs/skills v1.8.1 documentation (2026-11-16).
 */

export const AGENT_INFO = {
  'claude-code': {
    label: 'Claude Code',
    projectDir: '.claude/skills/',
    globalDir: '~/.claude/skills/',
  },
  codex: {
    label: 'Codex',
    projectDir: '.agents/skills/',
    globalDir: '~/.agents/skills/',
  },
} as const;

export type AgentId = keyof typeof AGENT_INFO;
export type InstallScope = 'project' | 'global';

export const AGENT_IDS = Object.keys(AGENT_INFO) as AgentId[];

export function isAgentId(value: string): value is AgentId {
  return Object.hasOwn(AGENT_INFO, value);
}

export function agentLabel(id: string): string {
  return isAgentId(id) ? AGENT_INFO[id].label : id;
}

// GitHub: owner is 1-39 alphanumerics or single hyphens; repository is letters, digits, . _ -
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
// Agent Skills specification: lowercase alphanumerics and single hyphens, 1-64 characters.
const SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export interface InstallRequest {
  owner: string;
  repo: string;
  skillName: string;
  agent: AgentId;
  scope: InstallScope;
  /** Commit to pin to. Omit to install the latest commit on the default branch. */
  commitSha?: string;
}

export type InstallPlan =
  | {
      ok: true;
      install: string;
      update: string;
      uninstall: string;
      targetDir: string;
      pinned: boolean;
    }
  | { ok: false; reason: string };

/**
 * Builds the commands. Because every interpolated value has passed an allowlist that
 * contains no whitespace, quotes or shell metacharacters, joining with spaces is safe
 * without quoting. Values that do not pass are rejected rather than escaped.
 */
export function buildInstallPlan(request: InstallRequest): InstallPlan {
  if (!isAgentId(request.agent)) return { ok: false, reason: 'Unknown agent.' };
  if (!OWNER.test(request.owner) || !REPO.test(request.repo)) {
    return { ok: false, reason: 'The repository name contains unsupported characters.' };
  }
  if (!SKILL_NAME.test(request.skillName)) {
    return {
      ok: false,
      reason:
        'The skill name does not follow the Agent Skills naming rules, so a command cannot be generated safely yet.',
    };
  }
  if (request.commitSha !== undefined && !COMMIT_SHA.test(request.commitSha)) {
    return { ok: false, reason: 'The commit reference is not a full commit SHA.' };
  }

  const global = request.scope === 'global';
  const source = `${request.owner}/${request.repo}${request.commitSha ? `@${request.commitSha}` : ''}`;
  const scopeFlag = global ? ['-g'] : [];

  return {
    ok: true,
    install: [
      'npx',
      'skills',
      'add',
      source,
      '--skill',
      request.skillName,
      '-a',
      request.agent,
      ...scopeFlag,
    ].join(' '),
    update: ['npx', 'skills', 'update', request.skillName, global ? '-g' : '-p'].join(' '),
    uninstall: [
      'npx',
      'skills',
      'remove',
      request.skillName,
      '-a',
      request.agent,
      ...scopeFlag,
    ].join(' '),
    targetDir: `${global ? AGENT_INFO[request.agent].globalDir : AGENT_INFO[request.agent].projectDir}${request.skillName}/`,
    pinned: request.commitSha !== undefined,
  };
}
