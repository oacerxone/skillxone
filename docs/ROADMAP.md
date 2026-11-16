# Implementation roadmap

Each phase ends with a report (files changed, features, tests run with results, limitations, security notes, deployment implications) and waits for approval. A phase is complete only when its acceptance checks pass when actually run.

Standing checks for every phase from 1 onward: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass locally and in CI.

## Phase 0 — Research and architecture

Deliverables: [overview](architecture/overview.md), [decisions](architecture/decisions.md), [database schema](architecture/database-schema.md), [verification policy](security/verification-policy.md), [design system](architecture/design-system.md), this roadmap.

Acceptance: documents are mutually consistent; open decisions are listed; plan approved.

## Phase 1 — Foundation

- pnpm workspace, strict TypeScript, ESLint with package-boundary rules, Prettier, Vitest.
- `packages/shared`, `packages/database` (Kysely, migrations for all tables, SQLite adapter, job queue), `packages/ui` tokens.
- `apps/web` shell: layout, navigation, theme toggle, health endpoint. `apps/worker` CLI skeleton.
- `.env.example`, env validation, `pnpm bootstrap` (install, copy env, migrate, load dev fixtures).
- CI workflow: install, lint, typecheck, test, build. Actions pinned by commit SHA, read-only permissions.
- Root files: README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, AGENTS.md, CLAUDE.md.

Acceptance:

- Fresh clone to running dev server with two commands, no Docker.
- Migrations apply to an empty SQLite file, and re-running them is a no-op (test).
- Job queue tests: atomic claim under two concurrent claimers, lease expiry reclaim, backoff, dedupe, dead after max attempts.
- Token contrast test passes for both themes.
- ESLint fails on a deliberate cross-boundary import (test fixture).

## Phase 2 — Public marketplace UI

- Homepage, Explore, Categories, Trending, Verified, Collections, skill detail, install panel (static adapter stubs), submit and report forms (UI only), docs and about pages.
- Runs on dev fixtures, with a visible "development data" banner.

Acceptance:

- Playwright: navigate home → search → detail → copy command, on desktop and 375 px.
- axe-core: no serious or critical violations on each template in light and dark.
- Filters round-trip through the URL (reload preserves state).
- Markdown sanitiser tests: script tags, event handlers, `javascript:` URLs, raw HTML and data URIs are neutralised.

## Phase 3 — GitHub ingestion

- `packages/github`: client, rate-limit budget, ETag cache, retries; providers for seeds, repository search, code search, known collections, submissions, recrawl.
- `packages/skill-parser`: locator, frontmatter parsing, spec validation, reference and dependency extraction, content hash.
- Worker processors: `discover`, `sync_repo`. Ingestion errors recorded.

Acceptance:

- Parser tests: valid, missing frontmatter, bad YAML, name mismatch, multiple skills per repository, nested categories, oversized file, binary file.
- Content hash matches the three upstream test vectors.
- Client tests against recorded responses: pagination, 304, primary and secondary rate limit, 404, 5xx with backoff, truncated tree.
- Lifecycle tests: rename, transfer (same `github_id`), deletion after two misses, archived, skill directory renamed, skill removed.
- Live run with a real token against at least 10 seed repositories; second run makes only conditional requests for unchanged repositories (request counts reported).

Needs: a GitHub token in `.env` (fine-grained, public read-only).

## Phase 4 — Search and ranking

- `packages/search`: FTS5 backend, rebuild and health check. `packages/ranking`: signals, quality score, trending from history, explanations.
- Daily metrics snapshot job. API: `/api/v1/skills`, `/search`, `/categories`, `/trending`.

Acceptance:

- Search tests: prefix match, field weighting, filters combined, pagination stability, hostile query strings.
- Corrupt-index test: integrity failure is detected and `reindex` restores it.
- Ranking tests: a flagged high-star skill ranks below a verified mid-star skill for the same relevance; views with under 7 days of history show the fallback label.
- p95 search under 50 ms on a generated 20,000-skill catalog on the development machine (measured and reported, with the machine noted).

## Phase 5 — Security assessment

- `packages/security`: rule engine, seven scanners, report builder, policy evaluator. Worker `scan_skill` and `expire_verifications`. Public report page and `/api/v1/skills/:id/security`.

Acceptance:

- Every rule has positive and negative fixtures; suite passes.
- Policy tests: state for each combination of findings and skipped checks; content change invalidates; expiry; scanner or policy version bump queues rescans.
- Timeout test produces FAILED, not VERIFIED. Pathological-input test stays within the time budget.
- OSV adapter tested against recorded responses and an unreachable-service case (recorded as skipped).
- A scan of the live seed catalog completes; a sample of findings is reviewed by hand and the false-positive rate of that sample is reported.

Status: done. Rules: [security/rules.md](security/rules.md). Live review: [security/live-catalog-review.md](security/live-catalog-review.md). Periodic `enqueue_scans` and `expire_verifications` runs are wired up in Phase 7 (schedules); until then run `pnpm worker scan --queue` and `pnpm worker expire-verifications`.

## Phase 6 — Installation support

- `packages/installer`: Claude Code and Codex adapters, command builder, quoting, compatibility checks. Install panel wired to real data. `/api/v1/skills/:id/install`.
- Re-verify the `skills` CLI interface and both agents' documentation before coding.

Acceptance:

- Snapshot tests for every agent × scope × pinned/unpinned × method combination.
- Quoting tests with hostile names (spaces, quotes, `$()`, backticks, newlines, leading dashes); invalid owner or repository is rejected, not quoted.
- Contract test: generated commands run with the real `skills` CLI in a temporary directory and the skill appears at the adapter's stated path. Requires Node 22.20 or later; if unavailable the test is reported as not run.
- Adding a third dummy agent in a test touches only `packages/installer/agents/`.

Status: done. `packages/installer` checked against skills CLI 1.9.0 and both agents' documentation on 2026-11-16 ([installer notes](development/installer.md)). The contract test is opt-in (`SKILLS_CONTRACT=1`) and runs in the CI `installer-contract` job. It was not run on the development machine, which has Node 22.16.

## Phase 7 — Automation

- Schedules (trending 6 h, recent daily, full weekly, ranking daily, verification expiry), all configurable. `worker enqueue`, `worker drain`, `worker serve`, `worker status`. Admin Jobs page.

Acceptance:

- Kill the worker mid-job; the next run reclaims and finishes without duplicates (test).
- Two workers started together do not process the same job (test).
- Lock-contention test: web writes succeed while the worker is writing.
- Rate-limit exhaustion parks jobs until reset instead of failing them.

Status: done, except the Admin Jobs page. It needs authentication, so it ships with the admin area in Phase 8. Its data (`listJobs`) and `pnpm worker jobs` / `pnpm worker status` exist now. See [worker operations](development/worker.md).

## Phase 8 — Community contribution

- Submission and report endpoints with validation, rate limiting and duplicate detection. Admin dashboard modules: overview, repositories, skills, security, submissions, jobs, settings. GitHub OAuth, sessions, CSRF, audit log.
- CONTRIBUTING, GOVERNANCE, MAINTAINERS, CODEOWNERS, issue and pull request templates, extension guides, OpenAPI document.
- Workflows: security (dependency audit, secret scan, CodeQL), dependency updates, release.

Acceptance:

- Every admin route and endpoint returns 401 or 403 without a valid session and role (table-driven test over the route list).
- CSRF test: mutating request without token is rejected.
- Duplicate submission returns the existing record. Malformed and non-GitHub URLs are rejected.
- OpenAPI document validates and matches the implemented routes (test).

Status: done. The GitHub OAuth flow is tested against a fake GitHub only; no OAuth app was available on the development machine. MAINTAINERS.md and CODEOWNERS hold placeholders for the project owner to fill in. The security and release workflows have not run yet, because the repository has not been pushed.

## Phase 9 — Deployment

- Mode A guide with systemd unit, Caddy and Nginx configs, cron, log rotation, backup, update, rollback. Mode B Dockerfile and Compose with optional profiles. Mode C static export and scheduled catalog workflow.

Acceptance:

- Production build starts and serves from a clean checkout following the guide verbatim.
- Static export builds, contains detail pages and a search index, and client-side search returns results (Playwright against the exported folder).
- Idle and under-load memory of the web process measured and recorded.
- Docker: image builds and health check passes. **Requires Docker, which is not installed on the current machine**; verified in CI instead, or reported as not run.
- Backup and restore round trip tested.

Status: done, with one item not run here. Following [the VPS guide](deployment/vps.md) verbatim from a fresh clone found and fixed three bugs: a `.gitignore` rule that had kept a source file out of git, an `.env.example` that failed its own validation, and a missing directory in the corepack step. After the fixes the build serves. Static export, backup and restore, and memory measurements are done ([measurements.md](deployment/measurements.md)). The Docker image is built and health-checked in CI only, because this machine has no Docker. The systemd, Caddy and Nginx files have not been run on a Linux server.

## Phase 10 — Hardening and beta

- Security review of the platform against the threat list, dependency audit, load test on a representative catalog, Core Web Vitals measurement, full accessibility pass, complete end-to-end suite, troubleshooting guide, CHANGELOG, tagged `v0.1.0-beta`.

Acceptance: all suites green; no open critical or high issues from the review; measured numbers published in the docs with the test conditions.

Status: done. Review: [platform-review.md](security/platform-review.md) (two medium findings fixed: a missing CSP and stale admin roles; the remaining accepted risks are listed). Load and Core Web Vitals: [measurements.md](deployment/measurements.md). Troubleshooting: [troubleshooting.md](troubleshooting.md). [CHANGELOG](../CHANGELOG.md). Tagged `v0.1.0-beta` locally, not pushed.

## Deferred beyond beta

Custom `skillforge` CLI, dynamic analysis sandbox, webhooks, non-GitHub sources, user accounts beyond admin and optional login, reviews and ratings.

## Known risks

| Risk                                                       | Mitigation                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GitHub code search limits make global discovery incomplete | Seeds, known collections, repository search by topic, and submissions carry discovery; coverage is reported, not claimed |
| Upstream `skills` CLI changes flags                        | Contract test on a schedule; adapters versioned                                                                          |
| Heuristic scanners flag legitimate skills                  | Conservative blocking threshold, fixtures, appeal process, per-finding suppression                                       |
| Dual-dialect support rots                                  | CI matrix on SQLite and PostgreSQL from Phase 1                                                                          |
| Scope is large for one stream of work                      | Phases are independently shippable; Mode C can go public after Phase 6                                                   |
