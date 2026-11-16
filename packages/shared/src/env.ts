import { z } from 'zod';

const positiveInt = (fallback: number) => z.coerce.number().int().min(1).max(64).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (v) => v.startsWith('file:') || v.startsWith('postgres://') || v.startsWith('postgresql://'),
      'must start with file:, postgres:// or postgresql://',
    )
    .default('file:./data/skillxone.db'),
  SITE_URL: z.url().default('http://localhost:3000'),
  GITHUB_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  GITHUB_USER_AGENT: z
    .string()
    .regex(/^[\w .()/:+@-]{1,120}$/, 'may contain letters, digits, spaces and . ( ) / : + @ -')
    .optional()
    .transform((v) => (v ? v : undefined)),
  WORKER_CONCURRENCY: positiveInt(4),
  SCAN_CONCURRENCY: positiveInt(1),
  /** Wall-clock limit per scan; a scan that exceeds it is FAILED, never passed. */
  SCAN_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
  /** Days a verification stays valid before a rescan is required. */
  VERIFICATION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Look up dependency vulnerabilities in OSV.dev. When 0, the check is recorded as skipped. */
  OSV_LOOKUPS: z
    .enum(['0', '1'])
    .default('1')
    .transform((v) => v === '1'),
  /** Absolute path to a gitleaks binary; when unset, PATH is searched. */
  GITLEAKS_PATH: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  ALLOW_DEV_FIXTURES: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/**
 * Validates configuration. Error messages name the variable and the rule only;
 * values are never included, so a mistyped secret cannot leak into logs.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
