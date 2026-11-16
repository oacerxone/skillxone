import { AGENTS } from './agents';
import { commandLine } from './quote';
import type { AgentAdapter, InstallRequest, InstallResult, Shell } from './types';
import {
  cliFolderName,
  isValidCommitSha,
  isValidOwner,
  isValidRepo,
  skillNameProblem,
  skillPathSegments,
  SPEC_SKILL_NAME,
} from './validate';

/**
 * Builds install, update and uninstall instructions for one skill and agent.
 *
 * Interface checked against the skills CLI v1.9.0 documentation (vercel-labs/skills,
 * docs/commands.md, 2026-11-16):
 *   npx skills add <owner>/<repo>[@<commit>] --skill <name> -a <agent> [-g] [--copy]
 *   npx skills update <name> (-g | -p)
 *   npx skills remove <name> -a <agent> [-g]
 * In `owner/repo@<x>`, a full commit SHA is a checkout pin, not a skill name
 * (src/source-parser.ts in the same release).
 */

export const CLI_VERSION_CHECKED = '1.9.0';
export const CLI_MIN_NODE = '22.20';

const refuse = (reason: string): InstallResult => ({ ok: false, reason });

export function findAgent(
  id: string,
  agents: readonly AgentAdapter[] = AGENTS,
): AgentAdapter | undefined {
  return agents.find((agent) => agent.id === id);
}

export function buildInstallPlan(
  request: InstallRequest,
  agents: readonly AgentAdapter[] = AGENTS,
): InstallResult {
  const agent = findAgent(request.agent, agents);
  if (!agent) return refuse('Unknown agent.');
  if (!isValidOwner(request.owner) || !isValidRepo(request.repo)) {
    return refuse('The repository name contains characters GitHub does not allow.');
  }
  if (request.commitSha !== undefined && !isValidCommitSha(request.commitSha)) {
    return refuse('The commit reference is not a full commit SHA.');
  }
  if (request.scope !== 'project' && request.scope !== 'global') return refuse('Unknown scope.');
  if (!['symlink', 'copy', 'manual'].includes(request.method))
    return refuse('Unknown install method.');
  const nameProblem = skillNameProblem(request.skill.name);
  if (nameProblem) return refuse(`${nameProblem} A command cannot be generated safely.`);
  const segments = skillPathSegments(request.skillPath);
  if (!segments) return refuse('The skill folder path contains unsupported characters.');

  const compatibility = agent.compatibility(request.skill);
  if (!compatibility.supported)
    return refuse(compatibility.warnings.join(' ') || `${agent.label} cannot load this skill.`);

  const shell: Shell = request.shell ?? 'posix';
  const name = request.skill.name;
  const global = request.scope === 'global';
  const pinned = request.commitSha !== undefined;
  const scopeArgs = global ? ['-g'] : [];
  const targetDir = `${global ? agent.globalDir : agent.projectDir}${cliFolderName(name)}/`;
  const ref = request.commitSha ?? 'HEAD';
  const sourceUrl = [
    'https://github.com',
    request.owner,
    request.repo,
    'tree',
    ref,
    ...segments.map((segment) => encodeURIComponent(segment)),
  ].join('/');

  const warnings = [...compatibility.warnings];
  if (!SPEC_SKILL_NAME.test(name)) {
    warnings.push(
      'The name does not follow the Agent Skills naming rules; the folder is named after a cleaned-up version of it.',
    );
  }
  if (pinned) {
    warnings.push(
      'Updating later moves past the pinned commit. Check this site for a newer assessment first.',
    );
  } else {
    warnings.push(
      'Unpinned installs fetch the latest commit, which may differ from the version assessed here.',
    );
  }

  const folder = segments.length > 0 ? `the ${segments.join('/')} folder` : 'the repository root';
  const steps = [
    `Download ${folder} from ${sourceUrl}${pinned ? ` (commit ${request.commitSha!.slice(0, 7)})` : ''}.`,
    `Copy it to ${targetDir} so that SKILL.md is at ${targetDir}SKILL.md.`,
    agent.afterInstall,
  ];

  if (request.method === 'manual') {
    return {
      ok: true,
      agent: { id: agent.id, label: agent.label },
      method: 'manual',
      scope: request.scope,
      shell,
      pinned,
      commitSha: request.commitSha ?? null,
      targetDir,
      install: null,
      update: null,
      uninstall: null,
      steps: [...steps, `To uninstall, delete ${targetDir}.`],
      sourceUrl,
      prerequisites: [`${agent.label} installed.`, 'git, or a browser to download the files.'],
      warnings,
    };
  }

  const source = `${request.owner}/${request.repo}${pinned ? `@${request.commitSha}` : ''}`;
  const install = commandLine(
    [
      'npx',
      'skills',
      'add',
      source,
      '--skill',
      name,
      '-a',
      agent.id,
      ...scopeArgs,
      ...(request.method === 'copy' ? ['--copy'] : []),
    ],
    shell,
  );
  return {
    ok: true,
    agent: { id: agent.id, label: agent.label },
    method: request.method,
    scope: request.scope,
    shell,
    pinned,
    commitSha: request.commitSha ?? null,
    targetDir,
    install,
    update: commandLine(['npx', 'skills', 'update', name, global ? '-g' : '-p'], shell),
    uninstall: commandLine(['npx', 'skills', 'remove', name, '-a', agent.id, ...scopeArgs], shell),
    steps: [agent.afterInstall],
    sourceUrl,
    prerequisites: [
      `Node.js ${CLI_MIN_NODE} or later (required by the skills CLI).`,
      `${agent.label} installed.`,
      'The skills CLI sends anonymous usage data unless DISABLE_TELEMETRY=1 is set.',
    ],
    warnings,
  };
}
