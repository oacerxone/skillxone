import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import {
  createJobQueue,
  hasDevFixtures,
  migrateToLatest,
  openDatabase,
  removeDevFixtures,
  seedCategories,
  seedDevFixtures,
} from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { EnvError, loadRootEnvFile, parseEnv } from '@skillxone/shared';
import type { Env } from '@skillxone/shared';
import { baseProcessors, drainQueue } from './runner';

const HELP = `skillxone worker

Usage: pnpm worker <command> [options]

Commands:
  migrate                 Apply pending database migrations
  seed [--dev]            Load reference data (categories); --dev also loads fixtures
  seed --remove-dev       Delete all development fixtures
  status                  Show database and queue status
  enqueue <type>          Add a job  [--payload <json>] [--dedupe <key>] [--priority <n>]
  drain                   Run queued jobs until none are runnable, then exit  [--max <n>]
  help                    Show this message
`;

class UsageError extends Error {}

type Command = (args: string[], ctx: { env: Env; handle: DatabaseHandle }) => Promise<void>;

const commands: Record<string, Command> = {
  async migrate(_args, { handle }) {
    const { applied } = await migrateToLatest(handle.db);
    console.log(
      applied.length > 0
        ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
        : 'Database is up to date.',
    );
  },

  async seed(args, { env, handle }) {
    const { values } = parseArgs({
      args,
      options: { dev: { type: 'boolean' }, 'remove-dev': { type: 'boolean' } },
    });
    if (values['remove-dev']) {
      console.log(`Removed ${await removeDevFixtures(handle.db)} fixture repositories.`);
      return;
    }
    console.log(`Categories: ${await seedCategories(handle.db)} added.`);
    if (values.dev) {
      if (env.NODE_ENV === 'production' && !env.ALLOW_DEV_FIXTURES) {
        throw new UsageError(
          'Refusing to load development fixtures in production. Set ALLOW_DEV_FIXTURES=1 to override.',
        );
      }
      const summary = await seedDevFixtures(handle.db);
      console.log(
        `Development fixtures: ${summary.repositories} repositories and ${summary.skills} skills added.`,
      );
    }
  },

  async status(_args, { handle }) {
    const queue = createJobQueue(handle.db);
    const count = async (table: 'repositories' | 'skills' | 'categories') => {
      const row = await handle.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      return Number(row.n);
    };
    console.log(`Dialect:       ${handle.dialect}`);
    console.log(`Repositories:  ${await count('repositories')}`);
    console.log(`Skills:        ${await count('skills')}`);
    console.log(`Categories:    ${await count('categories')}`);
    console.log(`Dev fixtures:  ${(await hasDevFixtures(handle.db)) ? 'present' : 'none'}`);
    const counts = await queue.counts();
    const summary = Object.entries(counts)
      .map(([status, n]) => `${status}=${n}`)
      .join(' ');
    console.log(`Jobs:          ${summary || 'none'}`);
  },

  async enqueue(args, { handle }) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        payload: { type: 'string' },
        dedupe: { type: 'string' },
        priority: { type: 'string' },
      },
    });
    const type = positionals[0];
    if (!type) throw new UsageError('enqueue requires a job type.');
    let payload: unknown = {};
    if (values.payload !== undefined) {
      try {
        payload = JSON.parse(values.payload);
      } catch {
        throw new UsageError('--payload must be valid JSON.');
      }
    }
    const priority = values.priority === undefined ? 0 : Number(values.priority);
    if (!Number.isInteger(priority)) throw new UsageError('--priority must be an integer.');

    const result = await createJobQueue(handle.db).enqueue(type, payload, {
      dedupeKey: values.dedupe,
      priority,
    });
    console.log(
      result.created ? `Queued ${type} job ${result.id}` : `Already queued as ${result.id}`,
    );
  },

  async drain(args, { handle }) {
    const { values } = parseArgs({ args, options: { max: { type: 'string' } } });
    const maxJobs = values.max === undefined ? undefined : Number(values.max);
    if (maxJobs !== undefined && (!Number.isInteger(maxJobs) || maxJobs < 1)) {
      throw new UsageError('--max must be a positive integer.');
    }

    // Finish the current job on SIGINT/SIGTERM, then exit; systemd and Docker send SIGTERM.
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    const summary = await drainQueue(createJobQueue(handle.db), baseProcessors, {
      workerId,
      maxJobs,
      signal: controller.signal,
      onEvent(event) {
        if (event.kind === 'succeeded') console.log(`ok     ${event.job.type} ${event.job.id}`);
        else
          console.error(
            `${event.kind.padEnd(6)} ${event.job.type} ${event.job.id}: ${event.error}`,
          );
      },
    });
    console.log(
      `Done: ${summary.succeeded} succeeded, ${summary.retried} to retry, ${summary.dead} dead, ${summary.lost} lost.`,
    );
    if (summary.dead > 0) process.exitCode = 1;
  },
};

async function main(): Promise<void> {
  const [name = 'help', ...args] = process.argv.slice(2);
  if (name === 'help' || name === '--help' || name === '-h') {
    console.log(HELP);
    return;
  }
  const command = commands[name];
  if (!command) throw new UsageError(`Unknown command "${name}".`);

  loadRootEnvFile();
  const env = parseEnv();
  const handle = await openDatabase(env.DATABASE_URL);
  try {
    await command(args, { env, handle });
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageError || error instanceof EnvError) {
    console.error(error.message);
    if (error instanceof UsageError) console.error(`\n${HELP}`);
  } else if (
    error instanceof TypeError &&
    'code' in error &&
    String(error.code).startsWith('ERR_PARSE_ARGS')
  ) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
