import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * Verifies that the ESLint configuration really enforces the package boundaries in
 * docs/architecture/overview.md. Source text is linted as if it lived at the given
 * path; no files are written.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function restrictedImportErrors(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-imports')
    .map((m) => m.message);
}

describe('package boundaries', () => {
  it('forbids shared from importing any internal package', async () => {
    const errors = await restrictedImportErrors(
      'packages/shared/src/leak.ts',
      "import { openDatabase } from '@skillxone/database';\nexport const x = openDatabase;\n",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('packages/shared may only import');
  });

  it('forbids database from importing ui', async () => {
    const errors = await restrictedImportErrors(
      'packages/database/src/leak.ts',
      "import { colorTokens } from '@skillxone/ui';\nexport const x = colorTokens;\n",
    );
    expect(errors).toHaveLength(1);
  });

  it('forbids ui from importing database', async () => {
    const errors = await restrictedImportErrors(
      'packages/ui/src/leak.ts',
      "import type { Job } from '@skillxone/database';\nexport type X = Job;\n",
    );
    expect(errors).toHaveLength(1);
  });

  it('allows database to import shared', async () => {
    const errors = await restrictedImportErrors(
      'packages/database/src/ok.ts',
      "import { newId } from '@skillxone/shared';\nexport const x = newId;\n",
    );
    expect(errors).toEqual([]);
  });

  it('allows apps to import any package', async () => {
    const errors = await restrictedImportErrors(
      'apps/worker/src/ok.ts',
      "import { openDatabase } from '@skillxone/database';\nimport { newId } from '@skillxone/shared';\nexport const x = [openDatabase, newId];\n",
    );
    expect(errors).toEqual([]);
  });
});
