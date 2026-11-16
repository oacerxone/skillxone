import { openDatabase } from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { loadRootEnvFile, parseEnv } from '@skillxone/shared';

/**
 * One database handle per server process. It is stored on `globalThis` so that
 * development hot reloads reuse the connection instead of opening a new one each time.
 */
const globalStore = globalThis as typeof globalThis & {
  __skillxoneDb?: Promise<DatabaseHandle>;
};

export function getDatabase(): Promise<DatabaseHandle> {
  if (!globalStore.__skillxoneDb) {
    loadRootEnvFile();
    const env = parseEnv();
    const opening = openDatabase(env.DATABASE_URL);
    // Do not cache a failed attempt: the next request should retry.
    opening.catch(() => {
      globalStore.__skillxoneDb = undefined;
    });
    globalStore.__skillxoneDb = opening;
  }
  return globalStore.__skillxoneDb;
}
