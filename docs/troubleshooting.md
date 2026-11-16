# Troubleshooting

Start with `pnpm worker status` (database, queue and schedules) and `curl -s localhost:3000/api/health`.

## Installing and starting

**`Invalid environment configuration: - NAME: …`** A value in `.env` does not pass validation. The message names the variable and the rule but never echoes the value. Compare with `.env.example`.

**`pnpm install` fails building `better-sqlite3`.** No prebuilt binary matched your platform, so it is compiling and needs build tools: `sudo apt-get install -y python3 make g++` (Debian/Ubuntu), or the Xcode command line tools on macOS.

**`corepack: command not found` or pnpm missing.** Node.js 22 ships corepack; run `corepack enable` (or `corepack enable --install-directory <dir>` without root). See step 2 of [the VPS guide](deployment/vps.md).

**Health check returns 503.** The database is unreachable or not migrated. Run `pnpm worker migrate`, and check that `DATABASE_URL` points where you expect (relative SQLite paths resolve from the repository root).

**The site shows a yellow "development fixtures" banner.** Fixture data is loaded. Remove it with `pnpm worker seed --remove-dev`. Production refuses to load fixtures unless `ALLOW_DEV_FIXTURES=1`.

## Catalog and GitHub

**No skills appear after setup.** The worker has not run. Run `pnpm worker discover && pnpm worker drain`, or check that the worker timer (`systemctl list-timers skillxone-worker.timer`) or `pnpm worker serve` is running.

**Jobs are `deferred` and nothing happens for an hour.** GitHub's rate limit ran out. Without a token you get 60 requests an hour; set `GITHUB_TOKEN` (public read-only) for 5,000. Jobs resume at the reset time without using up attempts.

**`pnpm worker jobs --status dead` lists failures.** Each line shows the last error. After fixing the cause, retry from the admin Jobs page or re-queue with `pnpm worker enqueue <type> --payload '<json>'`.

**A repository stopped updating.** Look at the admin Repositories page for its status and unresolved errors. `pnpm worker sync owner/repo` refreshes it now and prints what happened. Two missed checks in a row mark it unreachable; a rename or transfer is followed automatically (a transfer withdraws verification until rescanned).

## Search

**Search returns nothing or seems stale.** `pnpm worker search-health` checks the index; `pnpm worker reindex` rebuilds it (also the repair for a damaged index). The `full` schedule rebuilds weekly.

## Security states

**Everything is Unverified.** Scans have not run. Run `pnpm worker scan --queue && pnpm worker drain`. The `verification` schedule does this hourly.

**A skill is Unverified even though it has no findings.** A required check was skipped. The security tab lists skipped checks; usually the dependency check could not reach OSV.dev, or the skill ships a manifest format that is not parsed yet. Both are deliberate: an incomplete check never counts as a pass.

**A finding is a false positive.** A moderator marks it on the admin Security page with a public note. That queues a rescan, and the decision follows the finding until the matched content changes. If the rule itself is wrong, open an issue with the false-positive template.

**`Scan exceeded its 60 s time limit`.** The skill was marked FAILED (never passed). Raise `SCAN_TIMEOUT_SECONDS` if the worker host is slow, then `pnpm worker scan owner/repo/skill`.

## Sign-in and admin

**`/admin` says "Sign in required" and the sign-in link goes to an error page.** GitHub OAuth is not configured. Set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`; the OAuth app's callback must be `<SITE_URL>/auth/github/callback`.

**Signed in, but `/admin` says "No access".** Your numeric GitHub id is not in `ADMIN_GITHUB_IDS` or `MODERATOR_GITHUB_IDS`. Find it at `https://api.github.com/users/<login>` (the `id` field). Roles are re-read on every request, so changes apply after a restart without signing in again.

**Admin forms fail with "The form expired or did not come from this site".** The CSRF token or origin did not match. Reload the page. If it keeps happening, `SITE_URL` probably differs from the address in the browser (scheme, host or port), or the proxy rewrites the `Origin` header.

**Sign-in works locally but the cookie is not kept in production.** With an `https://` `SITE_URL` the session cookie is `Secure`, so the site must be served over HTTPS end to end at the browser.

## Database

**`database is locked`.** Another process held the write lock longer than the 5 s busy timeout. Check for a stuck worker (`ps`, `systemctl status skillxone-worker`). All write transactions take the lock up front, so this should only happen under a very long write.

**Restoring a backup.** Stop the web app and worker, then `pnpm worker restore <file> --yes`. The previous database is kept as `<name>.before-restore-<time>`. See [backup.md](deployment/backup.md).

## Static export

**Search on the static site says the index could not be loaded.** The host must serve `search/index.json` as JSON from the same origin. Open it directly to check; some hosts block dotfiles or need `.nojekyll` (included).
