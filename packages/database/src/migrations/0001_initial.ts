import { sql } from 'kysely';
import type { ColumnDefinitionBuilder, Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Initial schema. Design and rationale: docs/architecture/database-schema.md.
 * Only features common to SQLite and PostgreSQL are used.
 */

type Col = ColumnDefinitionBuilder;

const oneOf = (column: string, values: readonly string[]) =>
  sql<boolean>`${sql.ref(column)} in (${sql.join(values.map((v) => sql.lit(v)))})`;

const required = (c: Col) => c.notNull();
const pk = (c: Col) => c.primaryKey().notNull();
const flag = (c: Col) => c.notNull().defaultTo(0);
const count = (c: Col) => c.notNull().defaultTo(0);
const json = (fallback: '[]' | '{}') => (c: Col) => c.notNull().defaultTo(fallback);
const enumCol = (column: string, values: readonly string[], fallback?: string) => (c: Col) => {
  const base = c.notNull().check(oneOf(column, values));
  return fallback === undefined ? base : base.defaultTo(fallback);
};
const nullableEnum = (column: string, values: readonly string[]) => (c: Col) =>
  c.check(sql<boolean>`${sql.ref(column)} is null or ${oneOf(column, values)}`);
const fk =
  (target: string, onDelete: 'cascade' | 'set null' | 'restrict', notNull = true) =>
  (c: Col) => {
    const ref = c.references(target).onDelete(onDelete);
    return notNull ? ref.notNull() : ref;
  };

const TABLES_IN_CREATION_ORDER = [
  'repositories',
  'users',
  'categories',
  'skills',
  'skill_versions',
  'skill_files',
  'skill_categories',
  'agent_compatibility',
  'github_metrics_history',
  'security_scans',
  'security_findings',
  'verification_records',
  'ranking_scores',
  'collections',
  'collection_skills',
  'submissions',
  'reports',
  'sync_jobs',
  'audit_logs',
  'ingestion_errors',
  'settings',
  'sessions',
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations are schema-agnostic
async function up(db: Kysely<any>): Promise<void> {
  const s = db.schema;

  await s
    .createTable('repositories')
    .addColumn('id', 'text', pk)
    .addColumn('github_id', 'bigint', (c) => c.notNull().unique())
    .addColumn('owner', 'text', required)
    .addColumn('name', 'text', required)
    .addColumn('full_name_lower', 'text', (c) => c.notNull().unique())
    .addColumn('owner_github_id', 'bigint')
    .addColumn('owner_type', 'text', nullableEnum('owner_type', ['User', 'Organization']))
    .addColumn('previous_full_names', 'text', json('[]'))
    .addColumn('description', 'text')
    .addColumn('homepage_url', 'text')
    .addColumn('default_branch', 'text')
    .addColumn('head_sha', 'text')
    .addColumn('license_spdx', 'text')
    .addColumn('stars', 'integer', count)
    .addColumn('forks', 'integer', count)
    .addColumn('open_issues', 'integer', count)
    .addColumn('is_archived', 'integer', flag)
    .addColumn('is_fork', 'integer', flag)
    .addColumn('pushed_at', 'text')
    .addColumn('github_created_at', 'text')
    .addColumn(
      'status',
      'text',
      enumCol('status', ['active', 'archived', 'deleted', 'disabled', 'unreachable'], 'active'),
    )
    .addColumn('discovery_source', 'text', required)
    .addColumn('etag', 'text')
    .addColumn('last_synced_at', 'text')
    .addColumn('last_sync_error', 'text')
    .addColumn('missing_count', 'integer', count)
    .addColumn('created_at', 'text', required)
    .addColumn('updated_at', 'text', required)
    .execute();
  await s
    .createIndex('idx_repositories_status_synced')
    .on('repositories')
    .columns(['status', 'last_synced_at'])
    .execute();
  await s.createIndex('idx_repositories_stars').on('repositories').column('stars').execute();

  await s
    .createTable('users')
    .addColumn('id', 'text', pk)
    .addColumn('github_id', 'bigint', (c) => c.notNull().unique())
    .addColumn('login', 'text', required)
    .addColumn('avatar_url', 'text')
    .addColumn('role', 'text', enumCol('role', ['user', 'moderator', 'admin'], 'user'))
    .addColumn('is_disabled', 'integer', flag)
    .addColumn('created_at', 'text', required)
    .addColumn('last_login_at', 'text')
    .execute();

  await s
    .createTable('categories')
    .addColumn('id', 'text', pk)
    .addColumn('slug', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', required)
    .addColumn('description', 'text')
    .addColumn('sort_order', 'integer', count)
    .execute();

  // skills.current_version_id points at skill_versions, which points back at skills.
  // The reference is deliberately not a database constraint (SQLite cannot add one
  // after table creation); it is maintained by the repository layer and covered by a test.
  await s
    .createTable('skills')
    .addColumn('id', 'text', pk)
    .addColumn('repository_id', 'text', fk('repositories.id', 'cascade'))
    .addColumn('path', 'text', required)
    .addColumn('slug', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', required)
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('curated_title', 'text')
    .addColumn('curated_description', 'text')
    .addColumn('license', 'text')
    .addColumn('compatibility_note', 'text')
    .addColumn('current_version_id', 'text')
    .addColumn(
      'verification_state',
      'text',
      enumCol('verification_state', ['VERIFIED', 'UNVERIFIED', 'FLAGGED'], 'UNVERIFIED'),
    )
    .addColumn(
      'lifecycle_state',
      'text',
      enumCol(
        'lifecycle_state',
        ['PENDING', 'SCANNING', 'COMPLETE', 'EXPIRED', 'FAILED'],
        'PENDING',
      ),
    )
    .addColumn('status', 'text', enumCol('status', ['active', 'removed', 'hidden'], 'active'))
    .addColumn('spec_valid', 'integer', flag)
    .addColumn('first_indexed_at', 'text', required)
    .addColumn('content_updated_at', 'text')
    .addColumn('created_at', 'text', required)
    .addColumn('updated_at', 'text', required)
    .addUniqueConstraint('uq_skills_repository_path', ['repository_id', 'path'])
    .execute();
  await s
    .createIndex('idx_skills_state')
    .on('skills')
    .columns(['status', 'verification_state'])
    .execute();
  await s
    .createIndex('idx_skills_content_updated')
    .on('skills')
    .column('content_updated_at')
    .execute();
  await s.createIndex('idx_skills_first_indexed').on('skills').column('first_indexed_at').execute();

  await s
    .createTable('skill_versions')
    .addColumn('id', 'text', pk)
    .addColumn('skill_id', 'text', fk('skills.id', 'cascade'))
    .addColumn('commit_sha', 'text', required)
    .addColumn('content_hash', 'text', required)
    .addColumn('tree_sha', 'text')
    .addColumn('name', 'text', required)
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('frontmatter_json', 'text', json('{}'))
    .addColumn('parse_errors_json', 'text', json('[]'))
    .addColumn('dependencies_json', 'text', json('[]'))
    .addColumn('file_count', 'integer', count)
    .addColumn('total_bytes', 'integer', count)
    .addColumn('has_scripts', 'integer', flag)
    .addColumn('has_binaries', 'integer', flag)
    .addColumn('committed_at', 'text')
    .addColumn('indexed_at', 'text', required)
    .addUniqueConstraint('uq_skill_versions_skill_hash', ['skill_id', 'content_hash'])
    .execute();
  await s
    .createIndex('idx_skill_versions_skill_indexed')
    .on('skill_versions')
    .columns(['skill_id', 'indexed_at'])
    .execute();

  await s
    .createTable('skill_files')
    .addColumn('id', 'text', pk)
    .addColumn('version_id', 'text', fk('skill_versions.id', 'cascade'))
    .addColumn('path', 'text', required)
    .addColumn('blob_sha', 'text', required)
    .addColumn('size_bytes', 'integer', required)
    .addColumn(
      'kind',
      'text',
      enumCol('kind', ['skill_md', 'markdown', 'script', 'manifest', 'config', 'binary', 'other']),
    )
    .addColumn('is_executable', 'integer', flag)
    .addColumn('is_binary', 'integer', flag)
    .addColumn('content', 'text')
    .addColumn('truncated', 'integer', flag)
    .addUniqueConstraint('uq_skill_files_version_path', ['version_id', 'path'])
    .execute();

  await s
    .createTable('skill_categories')
    .addColumn('skill_id', 'text', fk('skills.id', 'cascade'))
    .addColumn('category_id', 'text', fk('categories.id', 'cascade'))
    .addColumn('source', 'text', enumCol('source', ['auto', 'curated']))
    .addPrimaryKeyConstraint('pk_skill_categories', ['skill_id', 'category_id'])
    .execute();
  await s
    .createIndex('idx_skill_categories_category')
    .on('skill_categories')
    .column('category_id')
    .execute();

  await s
    .createTable('agent_compatibility')
    .addColumn('skill_id', 'text', fk('skills.id', 'cascade'))
    .addColumn('agent_id', 'text', required)
    .addColumn(
      'level',
      'text',
      enumCol('level', ['declared', 'inferred', 'verified', 'unsupported']),
    )
    .addColumn('evidence', 'text')
    .addColumn('warnings_json', 'text', json('[]'))
    .addColumn('updated_at', 'text', required)
    .addPrimaryKeyConstraint('pk_agent_compatibility', ['skill_id', 'agent_id'])
    .execute();
  await s
    .createIndex('idx_agent_compat_agent')
    .on('agent_compatibility')
    .columns(['agent_id', 'level'])
    .execute();

  await s
    .createTable('github_metrics_history')
    .addColumn('id', 'text', pk)
    .addColumn('repository_id', 'text', fk('repositories.id', 'cascade'))
    .addColumn('captured_on', 'text', required)
    .addColumn('stars', 'integer', required)
    .addColumn('forks', 'integer', required)
    .addColumn('open_issues', 'integer', required)
    .addColumn('pushed_at', 'text')
    .addUniqueConstraint('uq_metrics_repo_day', ['repository_id', 'captured_on'])
    .execute();

  await s
    .createTable('security_scans')
    .addColumn('id', 'text', pk)
    .addColumn('skill_id', 'text', fk('skills.id', 'cascade'))
    .addColumn('version_id', 'text', fk('skill_versions.id', 'cascade'))
    .addColumn('commit_sha', 'text', required)
    .addColumn('content_hash', 'text', required)
    .addColumn('scanner_version', 'text', required)
    .addColumn('policy_version', 'text', required)
    .addColumn('status', 'text', enumCol('status', ['PENDING', 'SCANNING', 'COMPLETE', 'FAILED']))
    .addColumn('outcome', 'text', nullableEnum('outcome', ['PASS', 'FAIL', 'INCONCLUSIVE']))
    .addColumn('checks_run_json', 'text', json('[]'))
    .addColumn('checks_skipped_json', 'text', json('[]'))
    .addColumn('error', 'text')
    .addColumn('log', 'text')
    .addColumn('started_at', 'text')
    .addColumn('finished_at', 'text')
    .addColumn('created_at', 'text', required)
    .addUniqueConstraint('uq_security_scans_identity', [
      'version_id',
      'scanner_version',
      'policy_version',
    ])
    .execute();
  await s
    .createIndex('idx_security_scans_skill')
    .on('security_scans')
    .columns(['skill_id', 'created_at'])
    .execute();

  await s
    .createTable('security_findings')
    .addColumn('id', 'text', pk)
    .addColumn('scan_id', 'text', fk('security_scans.id', 'cascade'))
    .addColumn('rule_id', 'text', required)
    .addColumn(
      'category',
      'text',
      enumCol('category', [
        'prompt_injection',
        'dangerous_command',
        'credential',
        'network_exfiltration',
        'dependency',
        'file_access',
        'integrity',
      ]),
    )
    .addColumn(
      'severity',
      'text',
      enumCol('severity', ['critical', 'high', 'medium', 'low', 'info']),
    )
    .addColumn('file_path', 'text')
    .addColumn('line_start', 'integer')
    .addColumn('line_end', 'integer')
    .addColumn('excerpt', 'text')
    .addColumn('explanation', 'text', required)
    .addColumn('remediation', 'text', required)
    .addColumn('fingerprint', 'text', required)
    .addColumn('status', 'text', enumCol('status', ['open', 'false_positive', 'accepted'], 'open'))
    .addColumn('reviewed_by', 'text', fk('users.id', 'set null', false))
    .addColumn('reviewed_at', 'text')
    .addColumn('review_note', 'text')
    .execute();
  await s
    .createIndex('idx_security_findings_scan')
    .on('security_findings')
    .column('scan_id')
    .execute();
  await s
    .createIndex('idx_security_findings_open')
    .on('security_findings')
    .columns(['status', 'severity'])
    .execute();
  await s
    .createIndex('idx_security_findings_fingerprint')
    .on('security_findings')
    .column('fingerprint')
    .execute();

  await s
    .createTable('verification_records')
    .addColumn('id', 'text', pk)
    .addColumn('skill_id', 'text', fk('skills.id', 'cascade'))
    .addColumn('version_id', 'text', fk('skill_versions.id', 'cascade'))
    .addColumn('scan_id', 'text', fk('security_scans.id', 'set null', false))
    .addColumn('state', 'text', enumCol('state', ['VERIFIED', 'UNVERIFIED', 'FLAGGED']))
    .addColumn('reason', 'text', required)
    .addColumn('policy_version', 'text', required)
    .addColumn('decided_by', 'text', required)
    .addColumn('note', 'text')
    .addColumn('valid_from', 'text', required)
    .addColumn('expires_at', 'text')
    .addColumn('superseded_at', 'text')
    .execute();
  await s
    .createIndex('idx_verification_skill_current')
    .on('verification_records')
    .columns(['skill_id', 'superseded_at'])
    .execute();
  await s
    .createIndex('idx_verification_expiry')
    .on('verification_records')
    .column('expires_at')
    .execute();

  await s
    .createTable('ranking_scores')
    .addColumn('skill_id', 'text', (c) =>
      c.primaryKey().notNull().references('skills.id').onDelete('cascade'),
    )
    .addColumn('quality_score', 'real', required)
    .addColumn('trending_score', 'real', count)
    .addColumn('rising_score', 'real', count)
    .addColumn('maintenance_score', 'real', count)
    .addColumn('signals_json', 'text', required)
    .addColumn('weights_version', 'text', required)
    .addColumn('history_days', 'integer', count)
    .addColumn('computed_at', 'text', required)
    .execute();
  await s.createIndex('idx_ranking_quality').on('ranking_scores').column('quality_score').execute();
  await s
    .createIndex('idx_ranking_trending')
    .on('ranking_scores')
    .column('trending_score')
    .execute();

  await s
    .createTable('collections')
    .addColumn('id', 'text', pk)
    .addColumn('slug', 'text', (c) => c.notNull().unique())
    .addColumn('title', 'text', required)
    .addColumn('description', 'text')
    .addColumn('curator_id', 'text', fk('users.id', 'set null', false))
    .addColumn('source_repository_id', 'text', fk('repositories.id', 'set null', false))
    .addColumn('is_published', 'integer', flag)
    .addColumn('created_at', 'text', required)
    .addColumn('updated_at', 'text', required)
    .execute();

  await s
    .createTable('collection_skills')
    .addColumn('collection_id', 'text', fk('collections.id', 'cascade'))
    .addColumn('skill_id', 'text', fk('skills.id', 'cascade'))
    .addColumn('position', 'integer', count)
    .addColumn('note', 'text')
    .addPrimaryKeyConstraint('pk_collection_skills', ['collection_id', 'skill_id'])
    .execute();

  await s
    .createTable('submissions')
    .addColumn('id', 'text', pk)
    .addColumn('repo_full_name_lower', 'text', required)
    .addColumn('repository_id', 'text', fk('repositories.id', 'set null', false))
    .addColumn(
      'status',
      'text',
      enumCol(
        'status',
        ['pending', 'approved', 'rejected', 'duplicate', 'requires_review'],
        'pending',
      ),
    )
    .addColumn('submitter_id', 'text', fk('users.id', 'set null', false))
    .addColumn('submitter_ip_hash', 'text')
    .addColumn('note', 'text')
    .addColumn('review_note', 'text')
    .addColumn('reviewed_by', 'text', fk('users.id', 'set null', false))
    .addColumn('reviewed_at', 'text')
    .addColumn('created_at', 'text', required)
    .execute();
  await s
    .createIndex('idx_submissions_status')
    .on('submissions')
    .columns(['status', 'created_at'])
    .execute();
  await s
    .createIndex('idx_submissions_repo')
    .on('submissions')
    .column('repo_full_name_lower')
    .execute();

  await s
    .createTable('reports')
    .addColumn('id', 'text', pk)
    .addColumn('skill_id', 'text', fk('skills.id', 'cascade', false))
    .addColumn('repository_id', 'text', fk('repositories.id', 'cascade', false))
    .addColumn('finding_id', 'text', fk('security_findings.id', 'set null', false))
    .addColumn(
      'type',
      'text',
      enumCol('type', [
        'security_concern',
        'false_positive',
        'inaccurate_metadata',
        'duplicate',
        'takedown',
        'other',
      ]),
    )
    .addColumn('body', 'text', required)
    .addColumn('contact', 'text')
    .addColumn(
      'status',
      'text',
      enumCol('status', ['open', 'triaged', 'resolved', 'dismissed'], 'open'),
    )
    .addColumn('reporter_id', 'text', fk('users.id', 'set null', false))
    .addColumn('reporter_ip_hash', 'text')
    .addColumn('resolution_note', 'text')
    .addColumn('resolved_by', 'text', fk('users.id', 'set null', false))
    .addColumn('resolved_at', 'text')
    .addColumn('created_at', 'text', required)
    .execute();
  await s
    .createIndex('idx_reports_status')
    .on('reports')
    .columns(['status', 'created_at'])
    .execute();
  await s.createIndex('idx_reports_skill').on('reports').column('skill_id').execute();

  await s
    .createTable('sync_jobs')
    .addColumn('id', 'text', pk)
    .addColumn('type', 'text', required)
    .addColumn('payload_json', 'text', json('{}'))
    .addColumn('dedupe_key', 'text')
    .addColumn(
      'status',
      'text',
      enumCol(
        'status',
        ['queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled'],
        'queued',
      ),
    )
    .addColumn('priority', 'integer', count)
    .addColumn('attempts', 'integer', count)
    .addColumn('max_attempts', 'integer', (c) => c.notNull().defaultTo(5))
    .addColumn('run_after', 'text', required)
    .addColumn('locked_by', 'text')
    .addColumn('locked_until', 'text')
    .addColumn('last_error', 'text')
    .addColumn('result_json', 'text')
    .addColumn('schedule', 'text')
    .addColumn('created_at', 'text', required)
    .addColumn('started_at', 'text')
    .addColumn('finished_at', 'text')
    .execute();
  await s
    .createIndex('idx_sync_jobs_claim')
    .on('sync_jobs')
    .columns(['status', 'run_after', 'priority'])
    .execute();
  await s
    .createIndex('idx_sync_jobs_type_finished')
    .on('sync_jobs')
    .columns(['type', 'finished_at'])
    .execute();
  // At most one active (queued or running) job per dedupe key.
  await s
    .createIndex('idx_sync_jobs_dedupe')
    .on('sync_jobs')
    .column('dedupe_key')
    .unique()
    .where(sql.ref('status'), 'in', ['queued', 'running'])
    .execute();

  await s
    .createTable('audit_logs')
    .addColumn('id', 'text', pk)
    .addColumn('actor_id', 'text', fk('users.id', 'set null', false))
    .addColumn('action', 'text', required)
    .addColumn('target_type', 'text', required)
    .addColumn('target_id', 'text', required)
    .addColumn('before_json', 'text')
    .addColumn('after_json', 'text')
    .addColumn('ip_hash', 'text')
    .addColumn('created_at', 'text', required)
    .execute();
  await s
    .createIndex('idx_audit_target')
    .on('audit_logs')
    .columns(['target_type', 'target_id', 'created_at'])
    .execute();
  await s
    .createIndex('idx_audit_actor')
    .on('audit_logs')
    .columns(['actor_id', 'created_at'])
    .execute();

  await s
    .createTable('ingestion_errors')
    .addColumn('id', 'text', pk)
    .addColumn('repository_id', 'text', fk('repositories.id', 'cascade', false))
    .addColumn('job_id', 'text', fk('sync_jobs.id', 'set null', false))
    .addColumn('code', 'text', required)
    .addColumn('path', 'text')
    .addColumn('message', 'text', required)
    .addColumn('resolved_at', 'text')
    .addColumn('created_at', 'text', required)
    .execute();
  await s
    .createIndex('idx_ingestion_errors_repo')
    .on('ingestion_errors')
    .columns(['repository_id', 'created_at'])
    .execute();

  await s
    .createTable('settings')
    .addColumn('key', 'text', pk)
    .addColumn('value_json', 'text', required)
    .addColumn('updated_by', 'text', fk('users.id', 'set null', false))
    .addColumn('updated_at', 'text', required)
    .execute();

  await s
    .createTable('sessions')
    .addColumn('id', 'text', pk)
    .addColumn('user_id', 'text', fk('users.id', 'cascade'))
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('csrf_secret', 'text', required)
    .addColumn('expires_at', 'text', required)
    .addColumn('created_at', 'text', required)
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations are schema-agnostic
async function down(db: Kysely<any>): Promise<void> {
  for (const table of [...TABLES_IN_CREATION_ORDER].reverse()) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}

export const initialMigration: Migration = { up, down };
export const INITIAL_TABLES: readonly string[] = TABLES_IN_CREATION_ORDER;
