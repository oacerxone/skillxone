# Architecture overview

Status: **proposed, awaiting approval** (Phase 0). Nothing described here is implemented yet.

Working name: `skillxone` (the folder name). The CLI name `skillforge` from the brief is reserved for the future CLI.

## 1. Research findings that shape the design

Checked against primary sources on 2026-11-16. Re-verify before Phase 6; these change.

| Topic         | Finding                                                                                                                                                                                                                                                                                                                                                                                          | Source                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Skill format  | A skill is a directory with `SKILL.md`: YAML frontmatter plus Markdown. Required: `name` (1-64 chars, `a-z0-9-`, no leading/trailing/double hyphen, must match the parent directory name) and `description` (max 1024). Optional: `license`, `compatibility` (max 500), `metadata` (string map), `allowed-tools` (space-separated, experimental). Optional `scripts/`, `references/`, `assets/`. | agentskills.io/specification                   |
| Claude Code   | Project: `.claude/skills/<name>/SKILL.md`. Personal: `~/.claude/skills/<name>/SKILL.md`. Folder name `synced` is reserved. Claude Code adds its own frontmatter extensions beyond the open spec.                                                                                                                                                                                                 | code.claude.com/docs/en/skills                 |
| Codex         | Repo: `.agents/skills` in every directory from CWD up to the repo root. User: `$HOME/.agents/skills`. Admin: `/etc/codex/skills`. Optional `agents/openai.yaml` per skill for UI metadata and invocation policy.                                                                                                                                                                                 | developers.openai.com/codex/skills             |
| Installer CLI | `skills` on npm (v1.8.1, MIT, `vercel-labs/skills`). `npx skills add <owner/repo[@ref]> -s <skill> -a <agent> [-g] [-y] [--copy]`. Agent ids `claude-code` and `codex`. `@ref` accepts a tag or full commit. Also `remove`, `update`, `check`, `list`. **Requires Node.js 22.20+.**                                                                                                              | vercel-labs/skills README and docs/commands.md |
| Content hash  | The CLI's `skills-lock.json` v2 defines a `computedHash`: SHA-256 over sorted `path NUL length NUL content` with CRLF normalised in text files, with published test vectors.                                                                                                                                                                                                                     | vercel-labs/skills README                      |
| Repo layouts  | The CLI finds skills under `skills/`, `skills/<category>/`, `.claude/skills/`, `.agents/skills/` and about 40 other agent-specific directories.                                                                                                                                                                                                                                                  | vercel-labs/skills docs/creating-skills.md     |

Consequences:

1. **We reuse the `skills` CLI for installation** rather than write our own installer. Our adapters generate its commands and also show the manual copy path.
2. **Verified installs pin the scanned commit**: `owner/repo@<sha>`. This is what makes "verified" mean "the exact version you install".
3. **We adopt the CLI's `computedHash` algorithm as our content hash**, validated against its test vectors, so a hash in our security report can be compared with a user's `skills-lock.json`.
4. Many real skills break the spec (name does not match the folder, names with spaces). The parser records spec violations as metadata-quality findings and still indexes the skill.

## 2. Local environment (inspected 2026-11-16)

Empty directory, not a git repository. macOS arm64, Node 22.16.0, npm 10.9.2, corepack 0.32.0, git 2.50.1, sqlite3 3.51.0. Not installed: pnpm, Docker, GitHub CLI.

Implications: pnpm comes from corepack. Docker Compose files can be written but **cannot be run or tested on this machine** until Docker is installed. Real-data ingestion needs a GitHub token supplied through `.env`. Running the `skills` CLI itself to validate generated commands needs Node 22.20 or later.

## 3. Shape of the system

A modular monolith: one web process, one worker entry point, one database file.

```
                 +---------------------------+
  browser  --->  | apps/web  (Next.js)       |  SSR pages, /api/v1, /admin
                 |  reads DB, never scans    |
                 +-------------+-------------+
                               |
                        packages/database  (Kysely: SQLite | PostgreSQL)
                               |
                 +-------------+-------------+
  cron/systemd ->| apps/worker (Node CLI)    |  enqueue + drain jobs
                 |  discovery -> parse ->    |
                 |  scan -> rank -> index    |
                 +-------------+-------------+
                               |
                          GitHub REST API, OSV.dev
```

- **The web app is read-mostly.** Its only writes are submissions, reports, admin actions and job enqueues. It never calls GitHub during a page request and never runs a scan.
- **The worker is the only heavy writer.** Cron (or a systemd timer) runs `worker enqueue <schedule>` and `worker drain`. The process exits when the queue is empty, so it uses no memory between runs. A long-running `worker serve` mode is offered for Docker.
- **Static mode** runs the same worker in GitHub Actions and then builds the same web app with `output: 'export'`.

### Stack and why

| Choice                                   | Purpose                                                                                                                                                                | Alternative considered                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, Node 22 LTS, pnpm workspaces | One language, strict types across packages                                                                                                                             | npm workspaces: weaker dependency isolation                                                                                      |
| Next.js 16 App Router                    | SSR for SEO, route handlers for the API, and `output: 'export'` for Mode C from one codebase. Standalone build idles at roughly 150-250 MB (to be measured in Phase 9) | Astro: lighter, but admin and interactive search need more hand-rolling. Hono + templating: smallest, least contributor-friendly |
| Kysely                                   | One set of table types and one migration set that runs on both SQLite and PostgreSQL                                                                                   | Drizzle: needs two parallel schema definitions, one per dialect                                                                  |
| better-sqlite3                           | Synchronous, fast, WAL, FTS5 included                                                                                                                                  | `node:sqlite`: still flagged experimental in Node 22                                                                             |
| Tailwind CSS v4 + Radix primitives       | Token-driven styling; accessible dialog, select, tabs                                                                                                                  | A full component kit: harder to keep original and compact                                                                        |
| unified (remark + rehype-sanitize)       | Markdown to sanitised HTML, raw HTML dropped                                                                                                                           | marked + DOMPurify: needs a DOM on the server                                                                                    |
| Zod                                      | Validation for API input, env and frontmatter                                                                                                                          | —                                                                                                                                |
| Vitest, Playwright, axe-core             | Unit/integration, end-to-end, accessibility                                                                                                                            | —                                                                                                                                |
| MiniSearch                               | Client-side search index for static mode only                                                                                                                          | Lunr, Pagefind                                                                                                                   |

Not used: Redis, a message broker, an external search service, any paid API, any LLM.

## 4. Module boundaries

Dependency rule: `apps/*` may depend on any package. Packages may depend only on packages listed to their right. `shared` depends on nothing. Enforced with ESLint `no-restricted-imports` and workspace `dependencies`.

| Package        | Responsibility                                                             | May import       |
| -------------- | -------------------------------------------------------------------------- | ---------------- |
| `shared`       | Types, constants, Result type, ids, hashing, shell quoting                 | —                |
| `database`     | Kysely instance, migrations, repositories (query modules), job queue       | shared           |
| `github`       | REST client, rate-limit budget, ETag cache, discovery providers            | shared           |
| `skill-parser` | Locate skills in a tree, parse and validate `SKILL.md`, extract references | shared           |
| `security`     | Rule engine, scanners, report builder, verification policy                 | shared           |
| `ranking`      | Signals, quality score, trending, explanations                             | shared           |
| `installer`    | Agent adapters, command generation                                         | shared           |
| `search`       | Search adapter interface and backends                                      | shared, database |
| `ui`           | Design tokens and presentational components                                | shared           |

`github`, `skill-parser`, `security`, `ranking` and `installer` are pure with respect to the database: they take data in and return data. Only `apps/worker` wires them to `database`. This keeps them unit-testable and lets the static build reuse them.

### Extension-point interfaces

```ts
// installer — add an agent by adding one file and registering it
interface AgentAdapter {
  id: string; // "claude-code"
  displayName: string;
  scopes: { project: string; global: string | null }; // install directories
  methods: InstallMethod[]; // "skills-cli" | "manual-copy"
  checkCompatibility(skill: SkillSummary): Compatibility; // ok | warnings[] | unsupported
  buildCommands(req: InstallRequest): InstallPlan; // install, update, uninstall, prerequisites, warnings
}

// github — discovery
interface DiscoveryProvider {
  id: string; // "seed" | "repo-search" | "code-search" | "submission" | "collection" | "recrawl"
  discover(ctx: DiscoveryContext): AsyncIterable<RepoCandidate>;
}

// security
interface Scanner {
  id: string;
  version: string;
  category: FindingCategory;
  scan(input: ScanInput, signal: AbortSignal): Promise<ScannerResult>; // findings | skipped(reason)
}
interface Rule {
  id: string;
  severity: Severity;
  appliesTo(file: SkillFile): boolean;
  match(file: SkillFile): RuleMatch[];
  explanation: string;
  remediation: string;
}

// ranking
interface Signal {
  id: string;
  compute(input: SignalInput): number /* 0..1 */;
  explain(input: SignalInput): string;
}

// search
interface SearchBackend {
  index(docs: SearchDoc[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  query(q: SearchQuery): Promise<SearchResult>;
  rebuild(): Promise<void>;
  healthy(): Promise<boolean>;
}

// database
interface JobQueue {
  enqueue(
    type: JobType,
    payload: unknown,
    opts?: { dedupeKey?: string; runAfter?: Date },
  ): Promise<string>;
  claim(workerId: string, types: JobType[], leaseMs: number): Promise<Job | null>;
  heartbeat(jobId: string, leaseMs: number): Promise<void>;
  complete(jobId: string, result: unknown): Promise<void>;
  fail(jobId: string, error: JobError): Promise<void>; // schedules retry with backoff or marks dead
}
```

## 5. Ingestion pipeline

```
discover -> resolve repo -> list tree -> locate skills -> fetch skill files -> parse -> hash
        -> upsert version (if hash changed) -> enqueue scan -> enqueue rank -> update search index
```

- **No git clones.** One Git Trees API call per repository (`recursive=1`) lists every path. File contents are then downloaded only for files inside skill directories, at the exact commit, from `raw.githubusercontent.com`, which does not consume the API quota. Downloads are streamed with per-file (512 KB) and per-skill (5 MB) caps; files beyond the caps are listed but not stored. Truncated trees fall back to per-directory listing.
- **Unchanged repositories cost one conditional request.** We store the ETag and default-branch head SHA; a `304` or an unchanged SHA ends the job.
- **Identity.** A repository is keyed by GitHub's numeric `id`, which survives renames and transfers. A skill is keyed by `(repository_id, directory path)`. A renamed directory is matched to its old record by content hash and recorded as a path change instead of a delete plus create.
- **Rate limits.** A budget object reads `x-ratelimit-*` headers, pauses the job until reset when low, and honours `retry-after` on secondary limits. Code search is treated as scarce: authenticated only, about 10 requests per minute, 1000 results per query, default branch only. Queries are partitioned by path and file size and the provider is optional.
- **Errors are data.** Every failure writes an `ingestion_errors` row attached to the repository and job, with a typed code (`RATE_LIMITED`, `NOT_FOUND`, `MALFORMED_FRONTMATTER`, `TREE_TRUNCATED`, …). Nothing is dropped silently.
- **Lifecycle.** `404` marks the repository `deleted` after two consecutive confirmations; `archived` is recorded from the API; a skill missing from the tree is marked `removed` and kept with its history.

## 6. Jobs without Redis

`sync_jobs` is the queue. A claim is one atomic `UPDATE … WHERE status='queued' AND run_after<=now … RETURNING` that sets a lease (`locked_by`, `locked_until`). A crashed worker's lease expires and the job is claimed again, so every processor must be idempotent. Retries use exponential backoff with jitter up to `max_attempts`, then `dead`. `dedupe_key` has a partial unique index over active jobs so the same repository is never queued twice.

SQLite write control: WAL mode, `busy_timeout=5000`, `synchronous=NORMAL`, short transactions, one worker process by default. Network I/O runs concurrently (`WORKER_CONCURRENCY`, default 4) but database writes go through a single in-process queue. The web process writes rarely and briefly.

## 7. SQLite or PostgreSQL

Workload: tens of thousands of skills, a few hundred thousand file and metric rows, read-heavy traffic, one batch writer.

|               | SQLite (default)                                      | PostgreSQL (optional)               |
| ------------- | ----------------------------------------------------- | ----------------------------------- |
| Memory        | In-process, a few MB of page cache                    | 100-300 MB more on a 2 GB box       |
| Operations    | One file; backup with `sqlite3 .backup` or Litestream | Service, users, `pg_dump`, upgrades |
| Reads         | Faster than a network round trip at this size         | Fine                                |
| Writes        | One writer at a time; fits a single worker            | Many concurrent writers             |
| Search        | FTS5 with BM25                                        | `tsvector` + GIN                    |
| Scaling limit | One host; no multi-node web tier                      | Multiple web and worker nodes       |

Decision: **SQLite is the default and the tested path. PostgreSQL is a supported adapter** for operators who need several web or worker nodes. To keep both honest we restrict ourselves to a common subset: text ids (ULID), ISO-8601 UTC text timestamps, integer booleans, JSON stored as text and parsed in the application, no dialect-specific SQL outside `packages/database/dialect/` and `packages/search/`. CI runs the migration and repository tests against both.

## 8. Deployment modes

|                         | A: VPS (primary)                     | B: Docker Compose                          | C: Static catalog                                                  |
| ----------------------- | ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| Runs                    | Node + systemd, Caddy or Nginx, cron | `app` container, volume, optional `worker` | Any static host                                                    |
| Database                | SQLite file                          | SQLite volume; PostgreSQL optional profile | SQLite inside the CI job, then discarded or cached                 |
| Ingestion and scans     | Cron on the same host                | Worker container                           | Scheduled GitHub Actions workflow                                  |
| Search                  | FTS5 on the server                   | FTS5 (Meilisearch optional profile)        | MiniSearch index, client-side                                      |
| Submissions and reports | Built in                             | Built in                                   | Links to GitHub issue templates                                    |
| Admin dashboard         | Yes                                  | Yes                                        | No                                                                 |
| REST API                | Yes                                  | Yes                                        | Static JSON files at the same paths for `GET` list and detail only |

Limits stated plainly:

- **1 GB VPS**: web and metadata sync work; scan concurrency 1; PostgreSQL and Meilisearch not supported.
- **Mode C** has no server: no submissions form, no rate limiting, no admin, no live data. Freshness equals the workflow schedule. Search quality is lower than FTS5 on large catalogs, and the index is downloaded by the browser, so it is sharded by first letter above a size threshold.
- **PHP-only shared hosting cannot run the worker or the Node server.** It can serve Mode C output. Hosts that offer a Node.js runtime (for example Passenger-based panels) get a separate documented path for Mode A without systemd, with cron supplied by the panel.
- GitHub Actions scheduled runs are best-effort and can be delayed or skipped by GitHub; the workflow is idempotent so a missed run only delays freshness.

## 9. Platform security summary

Detailed policy is in [verification-policy.md](../security/verification-policy.md). Platform controls:

- All repository content is untrusted. Markdown is rendered through a sanitising pipeline with raw HTML removed, links given `rel="nofollow noopener ugc"`, and images proxied or blocked by CSP.
- Submitted URLs must parse to `https://github.com/<owner>/<repo>` with a strict character set. The server never fetches a user-supplied URL; it calls the GitHub API with the parsed owner and repo, which removes the SSRF surface.
- SQL only through Kysely's parameterised builder. Shell commands are generated as argument arrays and quoted by one tested function; the web app never executes them.
- Admin: GitHub OAuth, allowlist of numeric GitHub user ids in the environment, `HttpOnly; Secure; SameSite=Lax` session cookie, CSRF token on every mutating request, every action written to `audit_logs`.
- Public write endpoints: Zod validation, per-IP token bucket in memory, body size limits.
- Headers: CSP with nonces, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- Tokens are read from the environment, never logged (logger redaction list), never returned by any endpoint.
- Webhooks are not used in the first release. If added, HMAC-SHA256 signature verification with constant-time comparison is mandatory.

## 10. Decisions needing approval

1. Project name (`skillxone` used as a placeholder).
2. License: **Apache-2.0** recommended over MIT. It adds an explicit patent grant and clearer contribution terms, which matter for a project whose core is security rules and that hopes for outside contributors. It is compatible with the MIT-licensed `skills` CLI we call. MIT would be simpler but gives contributors and users no patent clause.
3. Next.js + Kysely + SQLite stack as above.
4. Dynamic analysis: **interface and off-switch only in the beta; no sandbox executor shipped.** A safe sandbox on a small VPS is a project of its own, and static analysis is what the verification policy is defined on.
5. Installation through the existing `skills` CLI, pinned to the scanned commit.
