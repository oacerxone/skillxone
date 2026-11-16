import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AGENTS } from './agents';
import { buildInstallPlan } from './build';
import { quotePosix, quotePowerShell } from './quote';
import type {
  AgentAdapter,
  InstallMethod,
  InstallPlan,
  InstallRequest,
  InstallScope,
  Shell,
} from './types';
import { cliFolderName, skillNameProblem } from './validate';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const base: InstallRequest = {
  owner: 'octo',
  repo: 'skills',
  skillPath: 'skills/pdf-tools',
  skill: { name: 'pdf-tools', hasDescription: true, specValid: true },
  agent: 'claude-code',
  scope: 'project',
  method: 'symlink',
};
const plan = (overrides: Partial<InstallRequest> = {}) =>
  buildInstallPlan({ ...base, ...overrides });
const ok = (overrides: Partial<InstallRequest> = {}) => {
  const result = plan(overrides);
  if (!result.ok) throw new Error(result.reason);
  return result;
};

describe('every agent × scope × pin × method × shell', () => {
  const scopes: InstallScope[] = ['project', 'global'];
  const methods: InstallMethod[] = ['symlink', 'copy', 'manual'];
  const shells: Shell[] = ['posix', 'powershell'];
  for (const agent of AGENTS) {
    for (const scope of scopes) {
      for (const pinned of [false, true]) {
        for (const method of methods) {
          for (const shell of shells) {
            const label = `${agent.id} ${scope} ${pinned ? 'pinned' : 'unpinned'} ${method} ${shell}`;
            it(label, () => {
              const result = ok({
                agent: agent.id,
                scope,
                method,
                shell,
                commitSha: pinned ? SHA : undefined,
              });
              const { install, update, uninstall, targetDir, steps, sourceUrl } = result;
              expect({ install, update, uninstall, targetDir, steps, sourceUrl }).toMatchSnapshot();
            });
          }
        }
      }
    }
  }
});

describe('commands', () => {
  it('match the skills CLI interface', () => {
    expect(ok()).toMatchObject({
      install: 'npx skills add octo/skills --skill pdf-tools -a claude-code',
      update: 'npx skills update pdf-tools -p',
      uninstall: 'npx skills remove pdf-tools -a claude-code',
      targetDir: '.claude/skills/pdf-tools/',
      pinned: false,
    });
    expect(ok({ agent: 'codex', scope: 'global', method: 'copy', commitSha: SHA })).toMatchObject({
      install: `npx skills add octo/skills@${SHA} --skill pdf-tools -a codex -g --copy`,
      update: 'npx skills update pdf-tools -g',
      uninstall: 'npx skills remove pdf-tools -a codex -g',
      targetDir: '~/.agents/skills/pdf-tools/',
      pinned: true,
      commitSha: SHA,
    });
  });

  it('give a manual method without the CLI', () => {
    const manual = ok({ method: 'manual', commitSha: SHA });
    expect(manual.install).toBeNull();
    expect(manual.sourceUrl).toBe(`https://github.com/octo/skills/tree/${SHA}/skills/pdf-tools`);
    expect(manual.steps.join(' ')).toContain('.claude/skills/pdf-tools/SKILL.md');
    expect(ok({ method: 'manual', skillPath: '' }).sourceUrl).toBe(
      'https://github.com/octo/skills/tree/HEAD',
    );
  });

  it('warn about pinning in both directions', () => {
    expect(ok({ commitSha: SHA }).warnings.join(' ')).toContain('moves past the pinned commit');
    expect(ok().warnings.join(' ')).toContain('Unpinned installs');
  });
});

describe('hostile input', () => {
  it.each([
    ['owner', { owner: 'octo;rm' }],
    ['owner', { owner: '-octo' }],
    ['owner', { owner: 'oc to' }],
    ['owner', { owner: 'a'.repeat(40) }],
    ['repo', { repo: '$(id)' }],
    ['repo', { repo: '..' }],
    ['repo', { repo: 'a b' }],
    ['repo', { repo: 'x`y`' }],
  ])('rejects an invalid %s rather than quoting it', (_field, overrides) => {
    expect(plan(overrides as Partial<InstallRequest>)).toMatchObject({ ok: false });
  });

  it('rejects malformed commits, paths, agents and methods', () => {
    expect(plan({ commitSha: 'main' }).ok).toBe(false);
    expect(plan({ commitSha: SHA.toUpperCase() }).ok).toBe(false);
    expect(plan({ skillPath: 'skills/../../etc' }).ok).toBe(false);
    expect(plan({ skillPath: 'skills/$(id)' }).ok).toBe(false);
    expect(plan({ agent: 'cursor' }).ok).toBe(false);
    expect(plan({ method: 'curl' as InstallMethod }).ok).toBe(false);
    expect(plan({ scope: 'system' as InstallScope }).ok).toBe(false);
  });

  it.each([
    'new\nline',
    'tab\there',
    'bell\u0007',
    'zero​width',
    'bidi‮evil',
    '-rf',
    '--help',
    ' padded',
    '',
    'x'.repeat(129),
  ])('refuses skill name %j', (name) => {
    expect(skillNameProblem(name)).not.toBeNull();
    expect(plan({ skill: { ...base.skill, name } }).ok).toBe(false);
  });

  const markerDir = mkdtempSync(join(tmpdir(), 'installer-quote-'));
  afterAll(() => rmSync(markerDir, { recursive: true, force: true }));
  const marker = join(markerDir, 'ran');
  const accepted = [
    'Convex Best Practices',
    "it's",
    'say "hi"',
    `$(touch ${marker})`,
    `\`touch ${marker}\``,
    'a; touch x',
    'a && b || c',
    'glob*?[x]',
    '$HOME ~ !history',
    'back\\slash',
    "'; touch x; '",
    'üñïçødé',
  ];

  it.each(accepted)('quotes %j so a POSIX shell reads it back unchanged', (name) => {
    const quoted = quotePosix(name);
    const echoed = execFileSync('/bin/sh', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8' });
    expect(echoed).toBe(name);
    expect(existsSync(marker)).toBe(false);
    const result = ok({ skill: { ...base.skill, name, specValid: false } });
    expect(result.install).toContain(`--skill ${quoted}`);
  });

  it('quotes for PowerShell by doubling single quotes, including typographic ones', () => {
    expect(quotePowerShell('pdf-tools')).toBe('pdf-tools');
    expect(quotePowerShell("it's")).toBe("'it''s'");
    expect(quotePowerShell('it’s $(x)')).toBe("'it’’s $(x)'");
    expect(
      ok({ shell: 'powershell', skill: { ...base.skill, name: 'Two Words' } }).install,
    ).toContain("--skill 'Two Words'");
  });

  it('names the folder the way the CLI does', () => {
    expect(cliFolderName('Convex Best Practices')).toBe('convex-best-practices');
    expect(cliFolderName('../../etc')).toBe('etc');
    expect(cliFolderName('...')).toBe('unnamed-skill');
    expect(ok({ skill: { ...base.skill, name: 'Convex Best Practices' } }).targetDir).toBe(
      '.claude/skills/convex-best-practices/',
    );
  });
});

describe('compatibility', () => {
  it('refuses Codex for a skill without a description', () => {
    expect(plan({ agent: 'codex', skill: { ...base.skill, hasDescription: false } })).toMatchObject(
      {
        ok: false,
        reason: expect.stringContaining('description'),
      },
    );
    expect(
      (ok({ skill: { ...base.skill, hasDescription: false } }) as InstallPlan).warnings.join(' '),
    ).toContain('no description');
  });

  it('refuses Claude Code for names with angle brackets', () => {
    expect(plan({ skill: { ...base.skill, name: 'a<b>' } }).ok).toBe(false);
    expect(plan({ agent: 'codex', skill: { ...base.skill, name: 'a<b>' } }).ok).toBe(true);
  });

  it('documents where each adapter was checked', () => {
    for (const agent of AGENTS) {
      expect(agent.docsUrl).toMatch(/^https:\/\//);
      expect(agent.projectDir).toMatch(/\/$/);
      expect(agent.globalDir).toMatch(/^~\/.*\/$/);
    }
  });
});

describe('extensibility', () => {
  it('supports a new agent through an adapter alone', () => {
    const dummy: AgentAdapter = {
      id: 'dummy-agent',
      label: 'Dummy',
      projectDir: '.dummy/skills/',
      globalDir: '~/.dummy/skills/',
      docsUrl: 'https://example.org/docs',
      afterInstall: 'Restart Dummy.',
      compatibility: () => ({ supported: true, warnings: [] }),
    };
    const result = buildInstallPlan({ ...base, agent: 'dummy-agent', scope: 'global' }, [
      ...AGENTS,
      dummy,
    ]);
    expect(result).toMatchObject({
      ok: true,
      install: 'npx skills add octo/skills --skill pdf-tools -a dummy-agent -g',
      targetDir: '~/.dummy/skills/pdf-tools/',
    });
    expect(buildInstallPlan({ ...base, agent: 'dummy-agent' }).ok).toBe(false);
  });
});
