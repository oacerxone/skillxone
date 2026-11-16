import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Finds the repository root by walking up from `start` to the directory that holds
 * `pnpm-workspace.yaml`. The web app and the worker run from different directories;
 * resolving relative paths from the root keeps them on the same database file.
 * `SKILLXONE_ROOT` overrides the search (used by deployments that do not ship the workspace file).
 */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  const override = process.env.SKILLXONE_ROOT;
  if (override) return override;
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Loads the root `.env` file if present. Variables already set in the environment win. */
export function loadRootEnvFile(root: string = findWorkspaceRoot()): void {
  const file = join(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
