# skillxone (working name)

An open-source, self-hostable marketplace for discovering, evaluating and installing AI agent skills hosted on GitHub. Initial agents: Claude Code and OpenAI Codex.

> **Status: Phase 4 of 10 — search and ranking work.**
> Working: the site, GitHub ingestion, ranked full-text search, quality ranking and a read-only REST API. Not built yet: the security scanner (every real skill is therefore shown as Unverified), working submissions, the admin dashboard and deployment packaging. See the [roadmap](docs/ROADMAP.md).

## What it will do

Discover → Evaluate → Verify → Install.

- Index `SKILL.md` skills from public GitHub repositories.
- Search and filter by keyword, category, agent and verification state.
- Publish a static-analysis security report for each indexed version, tied to an exact commit and content hash.
- Generate install commands for the open-source [`skills`](https://github.com/vercel-labs/skills) CLI, pinned to the assessed commit.
- Run on a small VPS with Node.js and SQLite. No Redis, Docker, managed database or paid API required. A static-export mode serves hosts that cannot run Node.

## Run it locally

Requirements: Node.js 22.12 or later and pnpm 10 (`corepack enable` provides pnpm).

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` creates `.env`, creates and migrates a SQLite database in `data/`, loads categories and clearly labelled development fixtures, and serves http://localhost:3000. Health check: http://localhost:3000/api/health.

Other commands:

| Command                         | Purpose                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `pnpm test`                     | Unit and integration tests                                  |
| `pnpm test:e2e`                 | Browser and accessibility tests (Playwright, axe-core)      |
| `pnpm lint` / `pnpm typecheck`  | Static checks                                               |
| `pnpm build`                    | Production build of the web app                             |
| `pnpm worker help`              | Worker CLI: `migrate`, `seed`, `status`, `enqueue`, `drain` |
| `pnpm worker seed --remove-dev` | Delete the development fixtures                             |
| `pnpm worker discover`          | Queue the seed repositories in `catalog/seeds.json`         |
| `pnpm worker drain`             | Run queued jobs (index repositories), then exit             |
| `pnpm worker sync owner/repo`   | Index one repository now                                    |

## Repository layout

| Path                    | Role                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `apps/web`              | Next.js site and API                                                          |
| `apps/worker`           | Command-line worker: migrations, seeds, queued jobs                           |
| `packages/shared`       | Types, ids, environment validation                                            |
| `packages/database`     | Schema, migrations, job queue (SQLite default, PostgreSQL adapter)            |
| `packages/github`       | GitHub REST client, rate limits, discovery providers                          |
| `packages/skill-parser` | Finds skills in a file listing, parses and validates `SKILL.md`, content hash |
| `packages/search`       | Full-text search backends (SQLite FTS5)                                       |
| `packages/ranking`      | Quality and trend scoring, pure functions                                     |
| `packages/ui`           | Design tokens                                                                 |
| `docs/`                 | Architecture, decisions, schema, security policy, design system, roadmap      |

## Documents

| Document                                                     | Contents                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [Architecture overview](docs/architecture/overview.md)       | System shape, stack, module boundaries, ingestion, jobs, deployment modes |
| [Decision records](docs/architecture/decisions.md)           | ADR-001 to ADR-011                                                        |
| [Database schema](docs/architecture/database-schema.md)      | Tables, indexes and conventions                                           |
| [Verification policy](docs/security/verification-policy.md)  | What Verified, Unverified and Flagged mean                                |
| [Design system](docs/architecture/design-system.md)          | Tokens, components, accessibility                                         |
| [Ingestion guide](docs/development/ingestion.md)             | Indexing real repositories: commands, costs, limits                       |
| [Search and ranking](docs/development/search-and-ranking.md) | How results are ordered, operating the index, measured speed              |
| [Roadmap](docs/ROADMAP.md)                                   | Phases with acceptance checks                                             |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md) and [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). Indexed skills remain under their own licenses.
