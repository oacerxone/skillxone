import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from '@skillxone/shared';
import { POLICY_VERSION } from './policy';
import { SCANNER_VERSION } from './engine';

/** The published rule list must name every rule in the code, and the versions it was written for. */
describe('docs/security/rules.md', () => {
  const root = findWorkspaceRoot();
  const doc = readFileSync(join(root, 'docs', 'security', 'rules.md'), 'utf8');
  const policy = readFileSync(join(root, 'docs', 'security', 'verification-policy.md'), 'utf8');
  const dir = join(root, 'packages', 'security', 'src', 'scanners');
  const ids = new Set<string>();
  for (const name of readdirSync(dir)) {
    const source = readFileSync(join(dir, name), 'utf8');
    for (const match of source.matchAll(/'((?:PI|CMD|CRED|NET|FILE|INT|DEP)-[A-Z0-9-]+)'/g))
      ids.add(match[1]!);
  }

  it('finds the rules in the source', () => {
    expect(ids.size).toBeGreaterThan(50);
  });

  it.each([...ids].sort())('documents %s', (id) => {
    expect(doc).toContain(`\`${id}\``);
  });

  it('names the current scanner and policy versions', () => {
    expect(doc).toContain(SCANNER_VERSION);
    expect(doc).toContain(POLICY_VERSION);
    expect(policy).toContain(`Policy version: **${POLICY_VERSION}**`);
  });
});
