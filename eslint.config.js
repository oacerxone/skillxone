// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Package boundaries (see docs/architecture/overview.md, section 4).
 * Each entry lists the internal packages a package MAY import. Anything else is an error.
 * Adding a package: add a line here and to the table in the overview.
 */
const allowedInternalImports = {
  shared: [],
  database: ['shared'],
  ui: ['shared'],
  'skill-parser': ['shared'],
  github: ['shared'],
  ranking: ['shared'],
  search: ['shared', 'database'],
};

const boundaryConfigs = Object.entries(allowedInternalImports).map(([pkg, allowed]) => ({
  files: [`packages/${pkg}/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@skillxone/*',
              `!@skillxone/${pkg}`,
              ...allowed.map((name) => `!@skillxone/${name}`),
            ],
            message: `packages/${pkg} may only import: ${allowed.length ? allowed.map((n) => `@skillxone/${n}`).join(', ') : 'no internal packages'}. See docs/architecture/overview.md#4-module-boundaries.`,
          },
        ],
      },
    ],
  },
}));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/out/**',
      '**/dist/**',
      'data/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  ...boundaryConfigs,
);
