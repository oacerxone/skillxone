# Architecture decision records

All records are **proposed** until the Phase 0 plan is approved. Each is split into its own file under `docs/architecture/adr/` once accepted.

## ADR-001: Modular monolith with a separate worker entry point

**Context.** Target is a 1-2 vCPU, 2 GB VPS with no Redis, Docker or Kubernetes.
**Decision.** One Next.js process serves pages, API and admin. One Node CLI (`apps/worker`) runs ingestion, scanning and ranking, started by cron and exiting when idle. They share the database and nothing else.
**Consequences.** Heavy work never competes with requests inside one event loop. No inter-process messaging to operate. Scaling beyond one host requires the PostgreSQL adapter.

## ADR-002: SQLite by default, PostgreSQL as a supported adapter, through Kysely

**Context.** Read-heavy catalog, one batch writer, low-memory hosts. See the comparison in [overview.md](overview.md#7-sqlite-or-postgresql).
**Decision.** SQLite (WAL) is the default and primary tested path. Kysely gives one schema type set and one migration set for both dialects. A portable subset is enforced: text ULIDs, ISO text timestamps, integer booleans, JSON as text.
**Consequences.** We give up native JSON operators, arrays and `timestamptz`. Full-text search is the one dialect-specific area, isolated in `packages/search`. CI must run database tests on both.

## ADR-003: Database-backed job queue with leases

**Context.** Jobs must persist, retry, lock and recover without Redis.
**Decision.** `sync_jobs` with atomic claim, lease expiry, exponential backoff, dedupe keys and a dead state. Processors are idempotent. One worker process by default; network concurrency is configurable, database writes are serialised.
**Consequences.** Throughput is bounded by a single writer, which is far above what GitHub's rate limits allow anyway. At-least-once delivery, so idempotency is tested per processor.

## ADR-004: Read GitHub through the REST API, never clone

**Context.** Disk and memory are small; repository content is untrusted.
**Decision.** Use the Git Trees API to list paths and fetch only blobs inside skill directories, with size caps, ETag caching and a rate-limit budget. Code search is an optional, throttled discovery provider.
**Consequences.** No git binary dependency and no hooks or filters ever run. Very large trees can be truncated by the API and need a per-directory fallback. A token is required for useful throughput (5,000 requests per hour against 60 unauthenticated).

## ADR-005: Install through the existing `skills` CLI, pinned to the scanned commit

**Context.** `vercel-labs/skills` (MIT) already installs to Claude Code and Codex and many other agents, and accepts `owner/repo@<commit>`.
**Decision.** Agent adapters generate `npx skills add` commands and a manual-copy alternative. For a verified skill the default command pins the verified commit; an unpinned "latest" command is offered with a note that it is not what was assessed. The web app never executes commands. Arguments are validated against strict patterns and quoted by a single tested function.
**Consequences.** We depend on a third-party CLI's interface, so adapter tests include a contract test that runs `npx skills add --list` against a fixture and is re-checked on a schedule. The CLI needs Node 22.20 or later, which the install panel states as a prerequisite. The CLI sends anonymous telemetry unless `DISABLE_TELEMETRY=1`; the panel says so.

## ADR-006: Content hash compatible with `skills-lock.json`

**Decision.** `content_hash` uses the CLI's published `computedHash` algorithm and is tested against its three published vectors.
**Consequences.** Users can compare our report with their lock file. If upstream changes the algorithm we version ours (`hash_algo` in the report) instead of silently following.

## ADR-007: Static analysis only; verification is a policy outcome, not a score

**Decision.** As set out in [verification-policy.md](../security/verification-policy.md). Three public states, no numeric safety score, dynamic analysis off and unshipped in the beta.
**Consequences.** Lower detection ceiling, much lower operational risk and cost. The limits are stated on the site.

## ADR-008: Ranking separates relevance from quality

**Decision.**

- **Relevance** comes from the search backend (BM25 over name, description, owner, categories, body with field weights).
- **Quality** is a stored, query-independent score in 0..1: a weighted sum of signals, each normalised to 0..1.

| Signal                     | Default weight | Normalisation                                                           |
| -------------------------- | -------------- | ----------------------------------------------------------------------- |
| Popularity (stars)         | 0.18           | `log10(1+stars) / log10(1+cap)`, cap 50,000                             |
| Fork activity              | 0.05           | same form, cap 5,000                                                    |
| Recent star growth         | 0.12           | 30-day delta relative to `sqrt(stars)`; 0 until 7 days of history exist |
| Maintenance                | 0.15           | Decay on days since last push; archived = 0                             |
| Content freshness          | 0.10           | Decay on days since the skill's own content last changed                |
| Documentation completeness | 0.12           | Body length bands, examples present, references resolve                 |
| Metadata quality           | 0.10           | Spec-valid frontmatter, description quality, license present            |
| Security                   | 0.13           | Verified 1.0, unverified 0.5, flagged 0                                 |
| Verified compatibility     | 0.05           | Share of supported agents at `verified` or `declared` level             |

- **Gates applied after the sum:** a flagged skill's quality is multiplied by 0.25 and it is excluded from Trending, Verified and homepage sections; each community report a moderator has triaged as under review subtracts a small fixed amount up to a cap.
- **Search ordering** is `relevance × (0.6 + 0.4 × quality)`, so quality reorders close matches but cannot lift an irrelevant result.
- **Views:** Trending (star growth over 7 days, quality-gated), Rising (growth rate among repositories under a star threshold), Most popular, Recently updated, Newly added, Verified, Best maintained, and each of these per category.
- **Explanations:** every score stores its per-signal values; the detail page lists the top contributing signals in plain language.
- **History:** trends are computed only from `github_metrics_history` rows we captured. Until enough days exist the Trending and Rising views say so and fall back to a labelled "Recently active" ordering. No back-filled or estimated history.

**Consequences.** Lifetime stars contribute at most 18 percent. Weights are admin-configurable and versioned (`weights_version`), and changes are audit-logged.

## ADR-009: Authentication

**Decision.** Public browsing, search, install and API reads need no account. Submissions and reports are anonymous with rate limits and an optional GitHub login. Admin requires GitHub OAuth plus an environment allowlist of numeric GitHub ids; roles are `moderator` and `admin`. A single-admin bootstrap with `ADMIN_GITHUB_IDS` needs no database step.
**Consequences.** Self-hosters must register a GitHub OAuth app to use the admin dashboard. Without it the site runs read-only and is administered through worker CLI commands, which is documented.

## ADR-010: License Apache-2.0

**Decision.** Recommend Apache-2.0 for the marketplace code. Indexed skills keep their own licenses; we display each skill's detected license and never imply ours applies. Stored skill text is shown with attribution and a link to source, and a takedown report type exists.
**Alternative.** MIT: shorter and more familiar, no patent grant.

## ADR-011: One web codebase, static export as a build mode

**Decision.** Pages read through a `CatalogSource` interface. `BUILD_MODE=static` switches Next.js to `output: 'export'`, pre-renders list and detail pages from the database at build time, writes JSON files for read endpoints and a MiniSearch index, and replaces forms with links to GitHub issue templates.
**Consequences.** Every public page must be renderable without request-time data. Features that cannot be (admin, submissions, rate limiting) are excluded from the static build by route group, and a static-export test asserts the build succeeds and the output contains no server-only routes.

**Revised in Phase 9.** Next.js static export needs every page's route config to be a build-time literal and cannot read query parameters, while the server pages are request-time and filter by query string. Supporting both in one set of pages would have meant rewriting every page. Instead, Mode C is produced by `apps/web/scripts/export-static.ts`, a small generator inside the web app. It reuses the web app's sanitising Markdown pipeline, the installer package and the API serialisers, so content, commands and JSON shapes stay identical; only the page templates differ. The static Playwright suite (`pnpm test:static`) checks the output, including that no server-only route is exported.
