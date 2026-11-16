import { describe, expect, it } from 'vitest';
import { AGENT_IDS, AGENT_INFO, agentLabel, buildInstallPlan, isAgentId } from './install';

/** The command builder is tested in packages/installer; this covers the web helpers over it. */
describe('web install helpers', () => {
  it('lists the installer agents', () => {
    expect(AGENT_IDS).toEqual(['claude-code', 'codex']);
    expect(AGENT_INFO.codex).toEqual({
      label: 'Codex',
      projectDir: '.agents/skills/',
      globalDir: '~/.agents/skills/',
    });
    expect(isAgentId('codex')).toBe(true);
    expect(isAgentId('toString')).toBe(false);
    expect(agentLabel('claude-code')).toBe('Claude Code');
    expect(agentLabel('unknown-agent')).toBe('unknown-agent');
  });

  it('keeps a flag-like repository name inside the source argument', () => {
    const plan = buildInstallPlan({
      owner: 'octo',
      repo: '-rf',
      skillPath: '',
      skill: { name: 'x', hasDescription: true, specValid: true },
      agent: 'claude-code',
      scope: 'project',
      method: 'symlink',
    });
    expect(plan.ok && plan.install).toBe('npx skills add octo/-rf --skill x -a claude-code');
  });
});
