import type { Generated, Insertable, Selectable } from 'kysely';
import type { JobStatus, LifecycleState, Severity, VerificationState } from '@skillxone/shared';

/**
 * Table types for Kysely. Conventions (docs/architecture/database-schema.md):
 * text ULID ids, ISO-8601 UTC text timestamps, 0/1 integer booleans, JSON stored as text.
 * `Generated<T>` marks columns that have a database default and may be omitted on insert.
 */
type Bool = 0 | 1;
type Iso = string;
type Json = string;

export interface RepositoriesTable {
  id: string;
  github_id: number;
  owner: string;
  name: string;
  full_name_lower: string;
  owner_github_id: number | null;
  owner_type: 'User' | 'Organization' | null;
  previous_full_names: Generated<Json>;
  description: string | null;
  homepage_url: string | null;
  default_branch: string | null;
  head_sha: string | null;
  license_spdx: string | null;
  stars: Generated<number>;
  forks: Generated<number>;
  open_issues: Generated<number>;
  is_archived: Generated<Bool>;
  is_fork: Generated<Bool>;
  pushed_at: Iso | null;
  github_created_at: Iso | null;
  status: Generated<'active' | 'archived' | 'deleted' | 'disabled' | 'unreachable'>;
  discovery_source: string;
  etag: string | null;
  last_synced_at: Iso | null;
  last_sync_error: string | null;
  missing_count: Generated<number>;
  created_at: Iso;
  updated_at: Iso;
}

export interface SkillsTable {
  id: string;
  repository_id: string;
  path: string;
  slug: string;
  name: string;
  description: Generated<string>;
  curated_title: string | null;
  curated_description: string | null;
  license: string | null;
  compatibility_note: string | null;
  current_version_id: string | null;
  verification_state: Generated<VerificationState>;
  lifecycle_state: Generated<LifecycleState>;
  status: Generated<'active' | 'removed' | 'hidden'>;
  spec_valid: Generated<Bool>;
  first_indexed_at: Iso;
  content_updated_at: Iso | null;
  created_at: Iso;
  updated_at: Iso;
}

export interface SkillVersionsTable {
  id: string;
  skill_id: string;
  commit_sha: string;
  content_hash: string;
  tree_sha: string | null;
  name: string;
  description: Generated<string>;
  frontmatter_json: Generated<Json>;
  parse_errors_json: Generated<Json>;
  dependencies_json: Generated<Json>;
  file_count: Generated<number>;
  total_bytes: Generated<number>;
  has_scripts: Generated<Bool>;
  has_binaries: Generated<Bool>;
  committed_at: Iso | null;
  indexed_at: Iso;
}

export interface SkillFilesTable {
  id: string;
  version_id: string;
  path: string;
  blob_sha: string;
  size_bytes: number;
  kind: 'skill_md' | 'markdown' | 'script' | 'manifest' | 'config' | 'binary' | 'other';
  is_executable: Generated<Bool>;
  is_binary: Generated<Bool>;
  content: string | null;
  truncated: Generated<Bool>;
}

export interface CategoriesTable {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: Generated<number>;
}

export interface SkillCategoriesTable {
  skill_id: string;
  category_id: string;
  source: 'auto' | 'curated';
}

export interface AgentCompatibilityTable {
  skill_id: string;
  agent_id: string;
  level: 'declared' | 'inferred' | 'verified' | 'unsupported';
  evidence: string | null;
  warnings_json: Generated<Json>;
  updated_at: Iso;
}

export interface GithubMetricsHistoryTable {
  id: string;
  repository_id: string;
  captured_on: string;
  stars: number;
  forks: number;
  open_issues: number;
  pushed_at: Iso | null;
}

export interface SecurityScansTable {
  id: string;
  skill_id: string;
  version_id: string;
  commit_sha: string;
  content_hash: string;
  scanner_version: string;
  policy_version: string;
  status: 'PENDING' | 'SCANNING' | 'COMPLETE' | 'FAILED';
  outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | null;
  checks_run_json: Generated<Json>;
  checks_skipped_json: Generated<Json>;
  error: string | null;
  log: string | null;
  started_at: Iso | null;
  finished_at: Iso | null;
  created_at: Iso;
}

export type FindingCategory =
  | 'prompt_injection'
  | 'dangerous_command'
  | 'credential'
  | 'network_exfiltration'
  | 'dependency'
  | 'file_access'
  | 'integrity';

export interface SecurityFindingsTable {
  id: string;
  scan_id: string;
  rule_id: string;
  category: FindingCategory;
  severity: Severity;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  excerpt: string | null;
  explanation: string;
  remediation: string;
  fingerprint: string;
  status: Generated<'open' | 'false_positive' | 'accepted'>;
  reviewed_by: string | null;
  reviewed_at: Iso | null;
  review_note: string | null;
}

export interface VerificationRecordsTable {
  id: string;
  skill_id: string;
  version_id: string;
  scan_id: string | null;
  state: VerificationState;
  reason: string;
  policy_version: string;
  decided_by: string;
  note: string | null;
  valid_from: Iso;
  expires_at: Iso | null;
  superseded_at: Iso | null;
}

export interface RankingScoresTable {
  skill_id: string;
  quality_score: number;
  trending_score: Generated<number>;
  rising_score: Generated<number>;
  maintenance_score: Generated<number>;
  signals_json: Json;
  weights_version: string;
  history_days: Generated<number>;
  computed_at: Iso;
}

export interface CollectionsTable {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  curator_id: string | null;
  source_repository_id: string | null;
  is_published: Generated<Bool>;
  created_at: Iso;
  updated_at: Iso;
}

export interface CollectionSkillsTable {
  collection_id: string;
  skill_id: string;
  position: Generated<number>;
  note: string | null;
}

export interface SubmissionsTable {
  id: string;
  repo_full_name_lower: string;
  repository_id: string | null;
  status: Generated<'pending' | 'approved' | 'rejected' | 'duplicate' | 'requires_review'>;
  submitter_id: string | null;
  submitter_ip_hash: string | null;
  note: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Iso | null;
  created_at: Iso;
}

export interface ReportsTable {
  id: string;
  skill_id: string | null;
  repository_id: string | null;
  finding_id: string | null;
  type:
    | 'security_concern'
    | 'false_positive'
    | 'inaccurate_metadata'
    | 'duplicate'
    | 'takedown'
    | 'other';
  body: string;
  contact: string | null;
  status: Generated<'open' | 'triaged' | 'resolved' | 'dismissed'>;
  reporter_id: string | null;
  reporter_ip_hash: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: Iso | null;
  created_at: Iso;
}

export interface SyncJobsTable {
  id: string;
  type: string;
  payload_json: Generated<Json>;
  dedupe_key: string | null;
  status: Generated<JobStatus>;
  priority: Generated<number>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_after: Iso;
  locked_by: string | null;
  locked_until: Iso | null;
  last_error: string | null;
  result_json: Json | null;
  schedule: string | null;
  created_at: Iso;
  started_at: Iso | null;
  finished_at: Iso | null;
}

export interface UsersTable {
  id: string;
  github_id: number;
  login: string;
  avatar_url: string | null;
  role: Generated<'user' | 'moderator' | 'admin'>;
  is_disabled: Generated<Bool>;
  created_at: Iso;
  last_login_at: Iso | null;
}

export interface AuditLogsTable {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  before_json: Json | null;
  after_json: Json | null;
  ip_hash: string | null;
  created_at: Iso;
}

export interface IngestionErrorsTable {
  id: string;
  repository_id: string | null;
  job_id: string | null;
  code: string;
  path: string | null;
  message: string;
  resolved_at: Iso | null;
  created_at: Iso;
}

export interface SettingsTable {
  key: string;
  value_json: Json;
  updated_by: string | null;
  updated_at: Iso;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_secret: string;
  expires_at: Iso;
  created_at: Iso;
}

export interface Database {
  repositories: RepositoriesTable;
  skills: SkillsTable;
  skill_versions: SkillVersionsTable;
  skill_files: SkillFilesTable;
  categories: CategoriesTable;
  skill_categories: SkillCategoriesTable;
  agent_compatibility: AgentCompatibilityTable;
  github_metrics_history: GithubMetricsHistoryTable;
  security_scans: SecurityScansTable;
  security_findings: SecurityFindingsTable;
  verification_records: VerificationRecordsTable;
  ranking_scores: RankingScoresTable;
  collections: CollectionsTable;
  collection_skills: CollectionSkillsTable;
  submissions: SubmissionsTable;
  reports: ReportsTable;
  sync_jobs: SyncJobsTable;
  users: UsersTable;
  audit_logs: AuditLogsTable;
  ingestion_errors: IngestionErrorsTable;
  settings: SettingsTable;
  sessions: SessionsTable;
}

export type TableName = keyof Database;
export type Job = Selectable<SyncJobsTable>;
export type NewRepository = Insertable<RepositoriesTable>;
export type NewSkill = Insertable<SkillsTable>;
export type Category = Selectable<CategoriesTable>;
