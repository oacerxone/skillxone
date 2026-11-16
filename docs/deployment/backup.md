# Backup and restore

## SQLite (default)

```bash
pnpm worker backup
```

This writes `data/backups/skillxone-<time>.db` using SQLite's online backup API, so it is safe while the web app and worker are running. The copy is then verified with SQLite's integrity check, plus a check that it is a skillxone database. Give a path to write elsewhere: `pnpm worker backup /srv/backups/today.db`.

Restore:

```bash
pnpm worker restore data/backups/skillxone-<time>.db --yes
```

Stop the web app and worker first. The backup is verified before anything changes. The current database is kept next to the original as `<name>.before-restore-<time>`, so a restore can itself be undone.

The search index is part of the database. After restoring a backup from an older release, run `pnpm worker migrate` (and `pnpm worker reindex` if search looks wrong).

**Tested:** `packages/database/src/backup.test.ts` backs up a live database with uncheckpointed writes, damages the original, restores, and checks the data and the kept pre-restore copy. It also checks that a file that is not a skillxone database is refused.

## PostgreSQL

Use the standard tools:

```bash
pg_dump --format=custom --file=skillxone.dump "$DATABASE_URL"
```

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" skillxone.dump
```

## Off-site copies

A backup on the same disk does not survive the disk. Copy `data/backups/` to another machine or to object storage (for example with `rsync` or `rclone` from a nightly timer). Backups contain the catalog, the moderation history and the hashed sessions. They contain no GitHub tokens, which live only in `.env`.
