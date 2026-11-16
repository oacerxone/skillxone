# Indexing skills from GitHub

How the worker finds repositories, reads their skills and keeps them current.

## Quick start

```bash
pnpm worker discover
```

```bash
pnpm worker drain
```

`discover` queues one `sync_repo` job per repository in [`catalog/seeds.json`](../../catalog/seeds.json). `drain` runs queued jobs and exits. To index a single repository immediately:

```bash
pnpm worker sync owner/repo
```

To keep real data apart from the development fixtures, point the worker at another database for the run, for example `DATABASE_URL=file:./data/live.db pnpm worker drain`. To replace the fixtures instead, run `pnpm worker seed --remove-dev` first.

## GitHub token

Without a token GitHub allows 60 API requests per hour, enough for about 20 repositories on a first run. With `GITHUB_TOKEN` set in `.env` the limit is 5,000 per hour. Create a fine-grained personal access token with **public repositories, read-only** access; no other permission is needed. The token is sent only to `api.github.com`, never to the raw file host, and never appears in logs or error messages.

## What a sync costs

| Situation                                 | API requests | File downloads                      |
| ----------------------------------------- | ------------ | ----------------------------------- |
| Nothing changed (HTTP 304)                | 1            | 0                                   |
| Stars or description changed, same commit | 2            | 0                                   |
| New commit                                | 3            | every file in every skill directory |
| Repository not found                      | 1            | 0                                   |

File downloads use `raw.githubusercontent.com` at the exact commit and do not count against the API quota.

When the rate limit is reached the job is **parked** until the reset time GitHub reports. It is not counted as a failed attempt, and the rest of that run stops rather than hammering the limit.

## Discovery providers

| Provider      | Source                                                        | Needs a token                       |
| ------------- | ------------------------------------------------------------- | ----------------------------------- |
| `seed`        | `repositories` in `catalog/seeds.json`                        | No                                  |
| `repo-search` | GitHub repository search for `searchQueries` in the seed file | No (10 searches per minute without) |
| `code-search` | GitHub code search for `SKILL.md`                             | Yes                                 |
| `collection`  | GitHub links in the README of each `collections` entry        | No                                  |
| `recrawl`     | Repositories already indexed, least recently checked first    | No                                  |

```bash
pnpm worker discover --provider recrawl
```

GitHub code search returns at most 1,000 results per query and covers default branches only, so discovery is never complete. Coverage comes from the combination of seeds, search, collections and (from Phase 8) submissions.

To add a provider, implement `DiscoveryProvider` in `packages/github/src/discovery.ts` and register it in `apps/worker/src/processors.ts`.

## What gets stored

- One `repositories` row per GitHub repository, keyed by GitHub's numeric id so renames and transfers keep their history.
- One `skills` row per directory that contains a file named exactly `SKILL.md`. A repository can hold many.
- One `skill_versions` row per distinct content hash, with the commit it was read at.
- `skill_files` rows with text content for files up to 512 KB. Binary files, symlinks and larger files are listed with their size and Git blob id but their content is not stored.
- One `github_metrics_history` row per repository per day, which is what trend calculations will use.

A skill at the repository root owns only `SKILL.md` and the conventional folders (`scripts/`, `references/`, `assets/`, `agents/`, `examples/`, `templates/`), never the whole repository.

### Content hash

The hash follows the `computedHash` algorithm of the `skills` CLI's `skills-lock.json` (version 2) and is tested against its published vectors. When a file could not be downloaded in full, its Git blob id is hashed in its place and the version is marked `HASH_NOT_LOCK_COMPATIBLE`: the hash still changes whenever the file changes, but it cannot be compared with a lock file.

## Lifecycle rules

| Event                                      | Result                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Skill content changes                      | New version; the skill becomes Unverified and a scan is queued                               |
| Content reverts to an earlier state        | The earlier version row is reused                                                            |
| Skill directory renamed, content identical | Same skill record, new path, no new version                                                  |
| Skill directory removed                    | Marked `removed`, hidden from the catalog, history kept                                      |
| Repository renamed                         | Same record; skill URLs follow the new name; old names are remembered                        |
| Repository transferred to another owner    | Verification withdrawn from all its skills; rescans queued                                   |
| Repository not found once                  | Nothing visible changes; it is retried                                                       |
| Repository not found twice in a row        | Marked `deleted`; its skills are hidden, history kept                                        |
| Repository archived                        | Indexed and labelled as archived                                                             |
| Repository private                         | Not indexed                                                                                  |
| `SKILL.md` breaks the specification        | Still indexed; the problems are stored with the version                                      |
| File listing truncated by GitHub           | Listed directory by directory; if still incomplete, absent skills are not treated as deleted |

Every failure writes a row to `ingestion_errors` with a code and, where relevant, a path. Nothing is dropped silently.

## Safety

- Repository content is only ever read as data. Nothing is executed, imported, installed or cloned.
- Owner and repository names are validated against GitHub's naming rules before any URL is built, and requests go only to two fixed hosts.
- Frontmatter is parsed with a plain-types YAML schema, bounded alias expansion and size limits.
- Job payloads are validated again when a job runs, since they come from the database.

## Verified against real repositories

On 2026-11-16 the 12 seed repositories were indexed without a token: 36 API requests, 668 skills, 3,884 files, no ingestion errors. A second pass over the same 12 repositories took 15 requests: 9 answered "not modified" with one request each, and 3 whose star counts had changed took two each. No files were downloaded on the second pass.

## Known limits

- The automatic category is a keyword guess and is often wrong; it is stored as `auto` and can be overridden by a curator.
- The commit time of an individual skill is not fetched. The repository's last push time is used as the latest moment the skill could have changed.
- Symlinks are not followed.
- At most 500 skills per repository and 200 files per skill are indexed.
