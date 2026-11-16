# Guide for coding agents

Instructions for AI coding agents (and a quick orientation for humans) working in this repository.

## What this is

An open-source, self-hostable marketplace for AI agent skills hosted on GitHub. A modular monolith: one Next.js web app, one worker CLI, one database (SQLite by default). Read [docs/architecture/overview.md](docs/architecture/overview.md) before making structural changes and [docs/ROADMAP.md](docs/ROADMAP.md) to see which phase the project is in.

## Commands

```bash
pnpm install        # install dependencies
pnpm dev            # bootstrap (env, migrate, seed) then start the site on :3000
pnpm test           # all unit and integration tests (Vitest)
pnpm test:e2e       # browser and accessibility tests (Playwright; run `pnpm exec playwright install chromium` once)
pnpm lint           # ESLint, zero warnings allowed
pnpm typecheck      # TypeScript in every package
pnpm build          # production build of the web app
pnpm worker help    # worker CLI: migrate, seed, status, enqueue, drain
pnpm tokens         # regenerate packages/ui/src/tokens.css after editing tokens.ts
pnpm format         # Prettier
```

All four of `lint`, `typecheck`, `test` and `build` must pass before a change is done.

## Layout

| Path                    | Role                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web`              | Next.js app: pages, `/api`, later `/admin`. Reads the database; never scans or calls GitHub in a request. |
| `apps/worker`           | CLI that migrates, seeds and runs queued jobs. The only heavy writer.                                     |
| `packages/shared`       | Types, constants, ids, env validation. Imports no internal package.                                       |
| `packages/database`     | Kysely schema types, migrations, job queue, seeds.                                                        |
| `packages/github`       | GitHub client and discovery providers. Validates every owner/repo before it reaches a URL.                |
| `packages/skill-parser` | Pure functions: locate skills, parse `SKILL.md`, content hash. No I/O.                                    |
| `packages/search`       | Search backends. The only place with dialect-specific SQL besides the connection code.                    |
| `packages/ranking`      | Pure scoring functions. No I/O.                                                                           |
| `packages/security`     | Static scanners, rule engine and the verification policy as code. Reads stored text; executes nothing.    |
| `packages/ui`           | Design tokens and (later) presentational components.                                                      |

## Rules that are enforced

- **Package boundaries.** `eslint.config.js` lists which internal packages each package may import. Do not widen a boundary to make an import work; move the code instead.
- **Portable SQL only.** Text ULID ids, ISO-8601 UTC text timestamps, 0/1 integer booleans, JSON as text. No dialect-specific SQL outside `packages/database` connection code and `packages/search`. Never edit a released migration; add a new one.
- **Jobs are idempotent.** The queue delivers at least once. A processor must be safe to run twice.
- **Tokens are the source of colour.** Use token utilities (`bg-bg`, `text-text-muted`), not raw hex values. New text/background pairs go in `contrastPairs` so the contrast test covers them.

## Rules that need judgement

- Never invent data. No fabricated statistics, security results or history. Fixtures live only in `packages/database/src/seed/dev-fixtures.ts` and are marked `dev-fixture`.
- Treat everything from GitHub repositories as untrusted input. Never execute, import or render it unsanitised.
- Never build shell commands by concatenating strings, and never run install commands from the web app.
- Never log or return secrets. Environment errors name the variable, not the value.
- Do not mark anything Verified unless the published policy in [docs/security/verification-policy.md](docs/security/verification-policy.md) says so.
- Keep changes scoped. No unrelated refactoring. Add or update tests with every behaviour change.
- Changes to `packages/security`, `packages/installer`, authentication or CI workflows need human review.
