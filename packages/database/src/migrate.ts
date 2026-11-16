import { Migrator } from 'kysely/migration';
import type { Kysely } from 'kysely';
import { migrationProvider } from './migrations';
import type { Database } from './types';

export interface MigrationOutcome {
  /** Names of migrations applied by this call, in order. Empty when already up to date. */
  applied: string[];
}

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly failedMigration: string | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

/** Applies all pending migrations. Safe to call repeatedly. */
export async function migrateToLatest(db: Kysely<Database>): Promise<MigrationOutcome> {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error, results } = await migrator.migrateToLatest();
  const failed = results?.find((r) => r.status === 'Error');
  if (error || failed) {
    throw new MigrationError(
      `Migration failed${failed ? ` at ${failed.migrationName}` : ''}`,
      failed?.migrationName,
      { cause: error },
    );
  }
  return {
    applied: (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName),
  };
}

/** Reverts every migration. Used by tests; not exposed through the CLI. */
export async function migrateDownAll(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({ db, provider: migrationProvider });
  for (;;) {
    const { error, results } = await migrator.migrateDown();
    if (error)
      throw new MigrationError('Rollback failed', results?.[0]?.migrationName, { cause: error });
    if (!results || results.length === 0) return;
  }
}
