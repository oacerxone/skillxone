import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import {
  backupSqlite,
  createJobQueue,
  listJobs,
  restoreSqlite,
  hasDevFixtures,
  migrateToLatest,
  openDatabase,
  removeDevFixtures,
  seedCategories,
  seedDevFixtures,
} from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { join } from 'node:path';
import { EnvError, findWorkspaceRoot, loadRootEnvFile, parseEnv } from '@skillxone/shared';
import type { Env } from '@skillxone/shared';
import { GitHubClient, parseRepoRef } from '@skillxone/github';
import { createSearchBackend } from '@skillxone/search';
import { createDefaultScanners, createOsvClient } from '@skillxone/security';
import {
  DISCOVERY_PROVIDERS,
  createProcessors,
  loadSeedFile,
  runDiscovery,
  runRanking,
} from './processors';
import type { DiscoveryProviderId } from './processors';
import { drainQueue } from './runner';
import type { DrainSummary } from './runner';
import { enqueueDueSchedules, SCHEDULES, scheduleIntervals, scheduleStatus } from './schedules';
import { enqueueMissingScans, expireVerifications, scanVersion } from './scan';
import type { ScanDeps } from './scan';
import { syncRepository } from './sync';
import type { SyncDeps } from './sync';

const HELP = `skillxone worker

Usage: pnpm worker <command> [options]

Commands:
  migrate                 Apply pending database migrations
  seed [--dev]            Load reference data (categories); --dev also loads fixtures
  seed --remove-dev       Delete all development fixtures
  status                  Show database and queue status
  discover [--provider p] Queue sync jobs for candidate repositories
                          (seed | repo-search | code-search | collection | recrawl; default seed)
  sync <owner/repo>       Index one repository now and print the result
  rank                    Recompute quality and trend scores for every skill
  reindex                 Rebuild the search index (also repairs a damaged one)
  search-health           Check the search index
  scan <owner/repo/skill> Assess one skill now and print the result (static analysis only)
  scan --queue            Queue scans for every skill not yet assessed by this scanner version
  expire-verifications    End expired verifications and queue their rescans
  enqueue <type>          Add a job  [--payload <json>] [--dedupe <key>] [--priority <n>]
  schedule [--run <id>]   Queue the jobs of every due schedule (run from cron), or one schedule now
  drain                   Run queued jobs until none are runnable, then exit  [--max <n>]
  serve                   Run schedules and jobs continuously until stopped  [--poll <seconds>]
  jobs [--status s]       List recent jobs  [--limit <n>]
  backup [path]           Copy the SQLite database safely while it runs (default data/backups/)
  restore <path> --yes    Replace the database with a backup (stop the web app and worker first)
  help                    Show this message
`;

class UsageError extends Error {}

type Command = (args: string[], ctx: { env: Env; handle: DatabaseHandle }) => Promise<void>;

function syncDeps(env: Env, handle: DatabaseHandle): SyncDeps {
  return {
    db: handle.db,
    client: new GitHubClient({ token: env.GITHUB_TOKEN, userAgent: env.GITHUB_USER_AGENT }),
    queue: createJobQueue(handle.db),
    now: () => new Date(),
    limits: { downloadConcurrency: env.WORKER_CONCURRENCY },
  };
}

function scanDeps(env: Env, handle: DatabaseHandle): ScanDeps {
  return {
    db: handle.db,
    queue: createJobQueue(handle.db),
    now: () => new Date(),
    scanners: createDefaultScanners({
      osv: env.OSV_LOOKUPS ? createOsvClient({ userAgent: env.GITHUB_USER_AGENT }) : null,
      gitleaksBinary: env.GITLEAKS_PATH,
    }),
    timeoutMs: env.SCAN_TIMEOUT_SECONDS * 1000,
    verificationDays: env.VERIFICATION_DAYS,
  };
}

function printRateLimit(deps: SyncDeps): void {
  const { requests, notModified, remaining, limit } = deps.client.rateLimit;
  console.log(
    `GitHub API: ${requests} request(s), ${notModified} not modified, ${remaining ?? '?'} of ${limit ?? '?'} remaining${deps.client.authenticated ? '' : ' (unauthenticated)'}.`,
  );
}

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
    console.log('\nSchedules:');
    for (const item of await scheduleStatus(handle.db, new Date())) {
      const every = item.intervalMinutes === 0 ? 'off' : `every ${item.intervalMinutes} min`;
      console.log(
        `  ${item.id.padEnd(13)} ${every.padEnd(18)} last ${item.lastRun ?? 'never'}${item.nextRun ? `, next ${item.due ? 'now (due)' : item.nextRun}` : ''}`,
      );
    }
  },

  async schedule(args, { handle }) {
    const { values } = parseArgs({ args, options: { run: { type: 'string' } } });
    if (values.run && !SCHEDULES.some((s) => s.id === values.run)) {
      throw new UsageError(`--run must be one of: ${SCHEDULES.map((s) => s.id).join(', ')}.`);
    }
    const ran = await enqueueDueSchedules(
      { db: handle.db, queue: createJobQueue(handle.db), now: () => new Date() },
      scheduleIntervals(),
      values.run,
    );
    if (ran.length === 0) console.log('No schedule is due.');
    for (const item of ran) console.log(`${item.id}: ${item.enqueued} job(s) queued.`);
  },

  async jobs(args, { handle }) {
    const { values } = parseArgs({
      args,
      options: { status: { type: 'string' }, limit: { type: 'string' } },
    });
    const limit = values.limit === undefined ? 30 : Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1)
      throw new UsageError('--limit must be a positive integer.');
    for (const job of await listJobs(handle.db, { status: values.status, limit })) {
      console.log(
        `${job.createdAt}  ${job.status.padEnd(9)} ${job.type.padEnd(22)} attempts ${job.attempts}/${job.maxAttempts}${job.schedule ? `  [${job.schedule}]` : ''}${job.lastError ? `\n    ${job.lastError.split('\n')[0]!.slice(0, 160)}` : ''}`,
      );
    }
  },

  async backup(args, { env }) {
    const target =
      args[0] ??
      join(
        findWorkspaceRoot(),
        'data',
        'backups',
        `skillxone-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
      );
    const result = await backupSqlite(env.DATABASE_URL, target);
    console.log(`Backup written to ${result.path} (${result.bytes} bytes) and verified.`);
  },

  async serve(args, { env, handle }) {
    const { values } = parseArgs({ args, options: { poll: { type: 'string' } } });
    const pollSeconds = values.poll === undefined ? 30 : Number(values.poll);
    if (!Number.isInteger(pollSeconds) || pollSeconds < 1 || pollSeconds > 3600) {
      throw new UsageError('--poll must be between 1 and 3600 seconds.');
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    const deps = syncDeps(env, handle);
    const processors = createProcessors({
      ...deps,
      dialect: handle.dialect,
      scan: scanDeps(env, handle),
    });
    console.log(
      `Worker ${workerId} serving; polling every ${pollSeconds} s. Stop with Ctrl-C or SIGTERM.`,
    );
    const total: DrainSummary = { succeeded: 0, retried: 0, dead: 0, lost: 0, deferred: 0 };
    while (!controller.signal.aborted) {
      try {
        for (const item of await enqueueDueSchedules({
          db: handle.db,
          queue: deps.queue,
          now: () => new Date(),
        })) {
          console.log(`schedule ${item.id}: ${item.enqueued} job(s) queued`);
        }
        const summary = await drainQueue(deps.queue, processors, {
          workerId,
          signal: controller.signal,
          onEvent(event) {
            if (event.kind === 'succeeded') console.log(`ok     ${event.job.type} ${event.job.id}`);
            else
              console.error(
                `${event.kind.padEnd(6)} ${event.job.type} ${event.job.id}: ${event.error}`,
              );
          },
        });
        for (const key of Object.keys(total) as Array<keyof DrainSummary>)
          total[key] += summary[key];
      } catch (error) {
        // A database hiccup should not kill a long-running worker; log and try again.
        console.error('worker loop error:', error instanceof Error ? error.message : String(error));
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, pollSeconds * 1000);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    console.log(
      `Stopped: ${total.succeeded} succeeded, ${total.retried} to retry, ${total.deferred} deferred, ${total.dead} dead, ${total.lost} lost.`,
    );
  },

  async discover(args, { env, handle }) {
    const { values } = parseArgs({ args, options: { provider: { type: 'string' } } });
    const provider = values.provider ?? 'seed';
    if (!DISCOVERY_PROVIDERS.includes(provider as DiscoveryProviderId)) {
      throw new UsageError(`--provider must be one of: ${DISCOVERY_PROVIDERS.join(', ')}.`);
    }
    const deps = syncDeps(env, handle);
    const result = await runDiscovery(deps, loadSeedFile(), provider as DiscoveryProviderId);
    console.log(
      `${result.provider}: ${result.candidates} candidate(s), ${result.enqueued} newly queued.`,
    );
    for (const note of result.notes) console.log(`  note: ${note}`);
    if (deps.client.rateLimit.requests > 0) printRateLimit(deps);
  },

  async sync(args, { env, handle }) {
    const ref = args[0] ? parseRepoRef(args[0]) : null;
    if (!ref) throw new UsageError('sync requires a repository as owner/repo or a github.com URL.');
    const deps = syncDeps(env, handle);
    const summary = await syncRepository(deps, { ...ref, source: 'manual' });
    console.log(JSON.stringify(summary, null, 2));
    printRateLimit(deps);
  },

  async rank(_args, { handle }) {
    const summary = await runRanking(handle.db, new Date());
    console.log(
      `Ranked ${summary.skills} skill(s). Recorded history: ${summary.maxHistoryDays} day(s)` +
        (summary.maxHistoryDays < 7 ? ' (trend scores stay at zero until there are 7).' : '.'),
    );
  },

  async reindex(_args, { handle }) {
    const backend = createSearchBackend(handle);
    console.log(`Indexed ${await backend.rebuild()} skill(s) with the ${backend.name} backend.`);
  },

  async 'search-health'(_args, { handle }) {
    const health = await createSearchBackend(handle).health();
    console.log(
      `${health.ok ? 'OK' : 'PROBLEM'}: ${health.backend}, ${health.indexed} of ${health.expected} indexed. ${health.detail}`,
    );
    if (!health.ok) process.exitCode = 1;
  },

  async scan(args, { env, handle }) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { queue: { type: 'boolean' } },
    });
    const deps = scanDeps(env, handle);
    if (values.queue) {
      const result = await enqueueMissingScans(deps);
      console.log(
        `${result.candidates} skill(s) need assessment; ${result.enqueued} newly queued. Run \`pnpm worker drain\`.`,
      );
      return;
    }
    const slug = positionals[0]?.toLowerCase();
    if (!slug || !/^[a-z0-9._-]+\/[a-z0-9._-]+\/[a-z0-9._-]+$/.test(slug)) {
      throw new UsageError('scan requires a skill as owner/repo/skill, or --queue.');
    }
    const skill = await handle.db
      .selectFrom('skills')
      .select(['id', 'current_version_id'])
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!skill?.current_version_id) throw new UsageError(`No indexed skill named ${slug}.`);
    const summary = await scanVersion(
      deps,
      { skillId: skill.id, versionId: skill.current_version_id },
      { force: true },
    );
    console.log(JSON.stringify(summary, null, 2));
  },

  async 'expire-verifications'(_args, { env, handle }) {
    const result = await expireVerifications(scanDeps(env, handle));
    console.log(`Expired ${result.expired} verification(s); rescans queued.`);
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

  async drain(args, { env, handle }) {
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
    const deps = syncDeps(env, handle);
    const summary = await drainQueue(
      deps.queue,
      createProcessors({ ...deps, dialect: handle.dialect, scan: scanDeps(env, handle) }),
      {
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
      },
    );
    console.log(
      `Done: ${summary.succeeded} succeeded, ${summary.retried} to retry, ${summary.deferred} deferred, ${summary.dead} dead, ${summary.lost} lost.`,
    );
    if (deps.client.rateLimit.requests > 0) printRateLimit(deps);
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
  if (!command && name !== 'restore') throw new UsageError(`Unknown command "${name}".`);

  loadRootEnvFile();
  const env = parseEnv();
  if (name === 'restore') {
    // Runs without opening the database, so nothing holds the file being replaced.
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { yes: { type: 'boolean' } },
    });
    if (!positionals[0]) throw new UsageError('restore requires the path of a backup file.');
    if (!values.yes)
      throw new UsageError(
        'restore replaces the database. Stop the web app and worker, then add --yes.',
      );
    const result = await restoreSqlite(positionals[0], env.DATABASE_URL);
    console.log(
      `Restored ${result.restored}.${result.previous ? ` The previous database was kept as ${result.previous}.` : ''}`,
    );
    return;
  }
  const handle = await openDatabase(env.DATABASE_URL);
  try {
    await command!(args, { env, handle });
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
