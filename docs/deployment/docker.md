# Mode B: Docker Compose

One image serves both roles: the web app (the default command) and the worker (`pnpm worker serve`). SQLite lives on a named volume.

**Verification status:** the image build and its health check run in CI (`docker` job in `.github/workflows/ci.yml`). They were not run on the development machine, which has no Docker.

## Start

```bash
cp .env.example .env
```

Set at least `SITE_URL`, and `GITHUB_TOKEN` if you run the worker. Then:

```bash
docker compose up -d --build
```

The container migrates the database and loads reference data on start, then serves on port 3000 (`PORT` changes the host port). It reports its health from `/api/health`.

Add the worker, which runs schedules, syncs GitHub and scans skills:

```bash
docker compose --profile worker up -d
```

## PostgreSQL instead of SQLite

Set `POSTGRES_PASSWORD` in `.env`, and point the app at the database service:

```bash
DATABASE_URL=postgres://skillxone:<password>@postgres:5432/skillxone
```

Then add the profile: `docker compose --profile postgres --profile worker up -d`. SQLite is the default and the most tested path; see the architecture overview for when PostgreSQL is worth it.

## Development fixtures

The container does not load development fixtures. To try the site with them, run `docker compose exec app pnpm worker seed --dev` (refused when `NODE_ENV=production` unless `ALLOW_DEV_FIXTURES=1`).

## Backups

```bash
docker compose exec app pnpm worker backup
```

This writes to `/app/data/backups` on the volume. Copy it out with `docker compose cp app:/app/data/backups ./backups`. For PostgreSQL use `pg_dump` (see [backup.md](backup.md)).

## Updating

```bash
git pull && docker compose up -d --build
```

Migrations run on start. Back up first.
