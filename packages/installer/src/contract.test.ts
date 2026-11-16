import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AGENTS } from './agents';
import { buildInstallPlan, CLI_VERSION_CHECKED } from './build';
import type { InstallPlan } from './types';

/**
 * Contract test: the commands we generate, run with the real skills CLI, put the skill where
 * the adapter says. It downloads the CLI from npm and runs it, so it is opt-in:
 *
 *   SKILLS_CONTRACT=1 pnpm exec vitest run packages/installer/src/contract.test.ts
 *
 * Requires Node.js 22.20 or later and network access to the npm registry. The skill comes
 * from a local fixture folder (a source the CLI supports), so no GitHub repository is needed;
 * only the source argument differs from what the site shows.
 */

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const nodeOk = major > 22 || (major === 22 && minor >= 20);
const enabled = process.env.SKILLS_CONTRACT === '1';
const reason = !enabled
  ? 'set SKILLS_CONTRACT=1 to run'
  : !nodeOk
    ? `Node ${process.versions.node} is older than 22.20, which the skills CLI requires`
    : '';

describe.skipIf(!enabled || !nodeOk)(`skills CLI ${CLI_VERSION_CHECKED} contract`, () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-contract-'));
  const home = join(root, 'home');
  const source = join(root, 'source', 'contract-skill');
  mkdirSync(home, { recursive: true });
  mkdirSync(source, { recursive: true });
  writeFileSync(
    join(source, 'SKILL.md'),
    '---\nname: contract-skill\ndescription: Fixture used to check generated install commands.\n---\n# Contract skill\n',
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const run = (args: string[], cwd: string) =>
    execFileSync('npx', ['-y', `skills@${CLI_VERSION_CHECKED}`, ...args.slice(2), '-y'], {
      cwd,
      env: { ...process.env, HOME: home, DISABLE_TELEMETRY: '1', CI: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    });

  for (const agent of AGENTS) {
    for (const scope of ['project', 'global'] as const) {
      it(`${agent.id} ${scope}: installs where the adapter says, then removes it`, () => {
        const project = mkdtempSync(join(root, 'project-'));
        const plan = buildInstallPlan({
          owner: 'example',
          repo: 'skills',
          skillPath: 'contract-skill',
          skill: { name: 'contract-skill', hasDescription: true, specValid: true },
          agent: agent.id,
          scope,
          method: 'copy',
        }) as InstallPlan;
        expect(plan.ok).toBe(true);
        // Same argument list as the generated command, with the local fixture as source.
        const args = plan.install!.split(' ');
        args[3] = join(root, 'source');
        run(args, project);
        const target = plan.targetDir.replace(/^~/, home);
        const installed = scope === 'global' ? target : join(project, target);
        expect(existsSync(join(installed, 'SKILL.md'))).toBe(true);
        expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toContain('contract-skill');

        run(plan.uninstall!.split(' '), project);
        expect(existsSync(join(installed, 'SKILL.md'))).toBe(false);
      });
    }
  }
});

describe('skills CLI contract availability', () => {
  it('reports whether the contract test ran', () => {
    if (reason) console.info(`skills CLI contract test not run: ${reason}.`);
    expect(true).toBe(true);
  });
});
