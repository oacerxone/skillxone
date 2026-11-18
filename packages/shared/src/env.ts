import { z } from 'zod';

const positiveInt = (fallback: number) => z.coerce.number().int().min(1).max(64).default(fallback);

/** Comma-separated numeric GitHub user ids. */
const githubIdList = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const ids = (v ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (ids.some((id) => !/^\d{1,12}$/.test(id))) {
      ctx.addIssue({ code: 'custom', message: 'must be comma-separated numeric GitHub user ids' });
      return z.NEVER;
    }
    return ids.map(Number);
  });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

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
  GITHUB_USER_AGENT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[\w .()/:+@-]{1,120}$/, 'may contain letters, digits, spaces and . ( ) / : + @ -')
      .optional(),
  ),
  WORKER_CONCURRENCY: positiveInt(4),
  SCAN_CONCURRENCY: positiveInt(1),
  /** New repositories stop being indexed once the catalog holds this many active skills. */
  CATALOG_MAX_SKILLS: z.coerce.number().int().min(100).max(10_000_000).default(60_000),
  /** Repository search only lists repositories with at least this many stars. */
  DISCOVERY_MIN_STARS: z.coerce.number().int().min(0).max(100_000).default(5),
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
  /** GitHub OAuth app for sign-in. Without both, the site runs without accounts and admin. */
  GITHUB_OAUTH_CLIENT_ID: optionalString,
  GITHUB_OAUTH_CLIENT_SECRET: optionalString,
  /** Numeric GitHub user ids granted the admin and moderator roles at sign-in. */
  ADMIN_GITHUB_IDS: githubIdList,
  MODERATOR_GITHUB_IDS: githubIdList,
  /**
   * Razorpay Subscriptions for the paid Pro plan. Pro features are gated only when all four
   * are set and sign-in is configured; otherwise every feature stays open to everyone.
   */
  RAZORPAY_KEY_ID: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  /** The plan created in the Razorpay dashboard (its amount and currency are set there). */
  RAZORPAY_PLAN_ID: optionalString,
  /** Price shown on the site; it must match the Razorpay plan. */
  PRO_PRICE_LABEL: z
    .string()
    .max(40)
    .optional()
    .transform((v) => (v ? v : '$5 / month')),
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
