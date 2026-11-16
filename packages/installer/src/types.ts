/**
 * Installer types. Everything in this package is pure: it produces text for a person to
 * read and copy. Nothing here runs a command, and the web app never executes its output.
 */

export type InstallScope = 'project' | 'global';
/** `symlink` and `copy` use the skills CLI; `manual` is a set of steps without it. */
export type InstallMethod = 'symlink' | 'copy' | 'manual';
export type Shell = 'posix' | 'powershell';

export interface SkillFacts {
  /** The `name` from SKILL.md (or the directory name when absent). */
  name: string;
  /** Whether SKILL.md has a non-empty description. */
  hasDescription: boolean;
  /** Whether the skill follows the Agent Skills specification. */
  specValid: boolean;
}

export interface CompatibilityResult {
  supported: boolean;
  /** Plain-language notes for the person installing. */
  warnings: string[];
}

/**
 * One coding agent. To support a new agent, add a file in `src/agents/` and list it in
 * `src/agents/index.ts`; nothing else in the package names an agent.
 */
export interface AgentAdapter {
  /** Id used by this site and by the skills CLI's `-a` option. */
  id: string;
  label: string;
  /** Where the agent discovers skills, relative to the project or home directory, with a trailing slash. */
  projectDir: string;
  globalDir: string;
  /** Agent documentation that the directories above were checked against. */
  docsUrl: string;
  /** Whether the agent picks up a new skill without a restart, for the "after installing" note. */
  afterInstall: string;
  compatibility(skill: SkillFacts): CompatibilityResult;
}

export interface InstallRequest {
  owner: string;
  repo: string;
  /** Skill directory inside the repository ('' for a skill at the root). */
  skillPath: string;
  skill: SkillFacts;
  agent: string;
  scope: InstallScope;
  method: InstallMethod;
  /** Full commit SHA to pin to. Omit to install the latest commit on the default branch. */
  commitSha?: string;
  shell?: Shell;
}

export interface InstallPlan {
  ok: true;
  agent: { id: string; label: string };
  method: InstallMethod;
  scope: InstallScope;
  shell: Shell;
  pinned: boolean;
  commitSha: string | null;
  /** Where the skill ends up, as the person would type it. */
  targetDir: string;
  /** Commands for the CLI methods; null for `manual`. */
  install: string | null;
  update: string | null;
  uninstall: string | null;
  /** Ordered steps for the manual method (and a fallback note for the others). */
  steps: string[];
  /** Source to download from: the GitHub tree at the pinned commit or default branch. */
  sourceUrl: string;
  prerequisites: string[];
  warnings: string[];
}

export interface InstallRefusal {
  ok: false;
  reason: string;
}

export type InstallResult = InstallPlan | InstallRefusal;
