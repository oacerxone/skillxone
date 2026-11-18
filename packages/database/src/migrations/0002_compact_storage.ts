import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Storage compaction.
 *
 * - `skill_files.content_encoding`: null for plain text, or `gzip-base64` when `content`
 *   holds gzip-compressed text encoded as base64. Text keeps the column portable across
 *   SQLite and PostgreSQL; the flag makes the encoding explicit, so no stored file can pass
 *   itself off as compressed data by starting with a marker.
 * - An index on `skill_versions.content_hash`, used to find identical copies of a skill in
 *   other repositories.
 * - Indexes on the foreign keys reached when a skill is deleted that lacked one
 *   (`verification_records.version_id` and `.scan_id`, `collection_skills.skill_id`,
 *   `reports.finding_id`). Without them, every deleted row scanned those whole tables.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations are schema-agnostic
async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('skill_files').addColumn('content_encoding', 'text').execute();
  await db.schema
    .createIndex('idx_skill_versions_content_hash')
    .on('skill_versions')
    .column('content_hash')
    .execute();
  await db.schema
    .createIndex('idx_verification_records_version')
    .on('verification_records')
    .column('version_id')
    .execute();
  await db.schema
    .createIndex('idx_verification_records_scan')
    .on('verification_records')
    .column('scan_id')
    .execute();
  await db.schema.createIndex('idx_reports_finding').on('reports').column('finding_id').execute();
  await db.schema
    .createIndex('idx_collection_skills_skill')
    .on('collection_skills')
    .column('skill_id')
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations are schema-agnostic
async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_collection_skills_skill').ifExists().execute();
  await db.schema.dropIndex('idx_reports_finding').ifExists().execute();
  await db.schema.dropIndex('idx_verification_records_scan').ifExists().execute();
  await db.schema.dropIndex('idx_verification_records_version').ifExists().execute();
  await db.schema.dropIndex('idx_skill_versions_content_hash').ifExists().execute();
  await db.schema.alterTable('skill_files').dropColumn('content_encoding').execute();
}

export const compactStorageMigration: Migration = { up, down };
