import type { Migration, MigrationProvider } from 'kysely/migration';
import { initialMigration } from './0001_initial';
import { compactStorageMigration } from './0002_compact_storage';
import { billingMigration } from './0003_billing';

/**
 * Migrations are registered in code rather than discovered on disk, so they work the
 * same under tsx, a bundler and a static build. Names sort lexically in run order.
 * Never edit a released migration; add a new one.
 */
export const migrations: Record<string, Migration> = {
  '0001_initial': initialMigration,
  '0002_compact_storage': compactStorageMigration,
  '0003_billing': billingMigration,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
