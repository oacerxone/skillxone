# Worker operations

The worker is the only process that calls GitHub, scans skills or does heavy writes. It reads jobs from the `sync_jobs` table. Delivery is at-least-once, and every job is idempotent.

## Two ways to run it

| Mode                  | Command                                                            | When                                                                                                                            |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Cron or systemd timer | `pnpm worker schedule && pnpm worker drain`, every 5 to 15 minutes | Small servers. Nothing stays in memory between runs.                                                                            |
| Long-running          | `pnpm worker serve [--poll 30]`                                    | Docker, or a process manager. It checks schedules and drains jobs every poll interval, and finishes the current job on SIGTERM. |

Both are safe to run at the same time as each other and as the web app.

## Schedules

A schedule is due when it has not queued jobs within its interval. Change an interval with `SCHEDULE_<ID>_MINUTES`; `0` turns the schedule off.

| Id             | Default | Queues                                                                         |
| -------------- | ------- | ------------------------------------------------------------------------------ |
| `trending`     | 6 hours | `discover` repo-search                                                         |
| `recent`       | 1 day   | `discover` seed, collection, code-search, and recrawl of repos older than 20 h |
| `full`         | 7 days  | `discover` recrawl of every repository, `reindex`                              |
| `ranking`      | 1 day   | `rank`                                                                         |
| `verification` | 1 hour  | `expire_verifications`, `enqueue_scans`                                        |
| `maintenance`  | 1 day   | `prune_jobs` (finished jobs older than 30 days)                                |

Run one schedule now: `pnpm worker schedule --run ranking`. Development fixtures are never rescanned or expired automatically.

## Inspecting

- `pnpm worker status`: counts, job states, each schedule's last and next run.
- `pnpm worker jobs [--status dead] [--limit 50]`: recent jobs with their last error.

## Failure behaviour (tested in `apps/worker/src/recovery.test.ts`)

- A worker that dies mid-job loses its lease. The next worker reclaims the job after the lease (5 minutes by default) and finishes it without duplicating skills, versions or scans.
- A long job renews its lease with a heartbeat every third of the lease, so it is not reclaimed while it is still running.
- Two workers on one database never run the same job.
- A web request that writes while the worker holds the write lock waits (SQLite busy timeout, 5 s) and then succeeds.
- When GitHub's rate limit runs out, the job is parked until the reset time without using an attempt, and the run stops (`apps/worker/src/sync.test.ts`).
- A job that fails is retried with exponential backoff. After its last attempt it is marked `dead` and listed by `pnpm worker jobs --status dead`.
