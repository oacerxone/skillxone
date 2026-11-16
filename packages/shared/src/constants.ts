/** Public verification states. See docs/security/verification-policy.md. */
export const VERIFICATION_STATES = ['VERIFIED', 'UNVERIFIED', 'FLAGGED'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const LIFECYCLE_STATES = ['PENDING', 'SCANNING', 'COMPLETE', 'EXPIRED', 'FAILED'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** `repositories.discovery_source` value that marks development-only fixture rows. */
export const DEV_FIXTURE_SOURCE = 'dev-fixture';

/** Sort orders for skill listings. */
export const SKILL_SORTS = [
  'recommended', // quality score (ADR-008); the default without a search query
  'relevance', // search relevance blended with quality; the default with a query
  'popular',
  'trending',
  'rising',
  'maintained',
  'updated',
  'newest',
  'name',
] as const;
export type SkillSort = (typeof SKILL_SORTS)[number];
