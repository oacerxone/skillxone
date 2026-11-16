#!/usr/bin/env node
// One-step local setup: create .env if missing, migrate the database, load reference
// data and development fixtures. Safe to run repeatedly; `pnpm dev` runs it first.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Node.js 22.12 or later is required (found ${process.versions.node}).`);
  process.exit(1);
}

if (!existsSync(join(root, 'node_modules'))) {
  console.error('Dependencies are not installed. Run `pnpm install` first.');
  process.exit(1);
}

const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  copyFileSync(join(root, '.env.example'), envFile);
  console.log('Created .env from .env.example');
}

function worker(...args) {
  // Run the worker CLI with the same Node binary, through the tsx loader. Arguments are
  // passed as an array (no shell), so nothing here is subject to shell interpretation.
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(root, 'apps/worker/src/cli.ts'), ...args],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

worker('migrate');
worker('seed', '--dev');
worker('reindex');
worker('rank');
console.log('Ready. Start the site with `pnpm dev`.');
