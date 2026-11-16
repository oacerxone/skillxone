# Search and ranking

How results are found and ordered, how to operate the index, and measured performance. The reasoning behind the design is in [ADR-008](../architecture/decisions.md).

## Search

Search runs inside the database. There is no search service and no AI model.

| Database         | Backend                         | Behaviour                                                                           |
| ---------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| SQLite (default) | FTS5 virtual table `skills_fts` | Ranked by BM25, word stemming, prefix matching while typing                         |
| PostgreSQL       | Substring match                 | Correct but unranked; a `tsvector` backend can replace it behind the same interface |

Indexed fields and their weights: name 10, description 4, owner 2, repository 2, categories 2, `SKILL.md` body 1.

A search happens in two stages. The index returns its best 1,000 matches by relevance alone. Those are then re-ordered by `relevance × (0.6 + 0.4 × quality)`, so quality reorders close matches but a poor match is never lifted above a good one. Filters (agent, category, verification) and paging are applied to that ordered list.

If the index returns nothing, a plain substring match is used, so a search does not silently come back empty when the index has not been built or the term is a fragment inside a word.

### User input

Input is reduced to at most eight words of letters and digits. Each word is quoted before it reaches FTS5, which makes FTS5 operators (`AND`, `OR`, `NOT`, `NEAR`, `*`, `:`, `^`) in the input inert. Values are always bound parameters.

### Operating the index

The index is derived data and can be rebuilt at any time.

```bash
pnpm worker search-health
```

```bash
pnpm worker reindex
```

`search-health` runs FTS5's integrity check and compares the number of indexed skills with the number of active skills; it exits non-zero on a problem. `reindex` drops and rebuilds the index, which is also the repair for a damaged one. After each repository sync the worker re-indexes only that repository.

## Ranking

Quality is a stored, query-independent score from 0 to 1: a weighted sum of signals, each normalised to 0..1.

| Signal                  | Weight | Based on                                                              |
| ----------------------- | ------ | --------------------------------------------------------------------- |
| Popularity              | 0.18   | Stars, logarithmic, capped at 50,000                                  |
| Maintenance             | 0.15   | Days since the last push; archived scores 0                           |
| Security                | 0.13   | Verified 1, unverified 0.5, flagged 0                                 |
| Recent star growth      | 0.12   | Stars gained in 30 days relative to size; 0 without 7 days of history |
| Documentation           | 0.12   | Length of instructions, examples, no broken links                     |
| Content freshness       | 0.10   | Days since the skill's content changed                                |
| Metadata quality        | 0.10   | Follows the specification, description length, license stated         |
| Fork activity           | 0.05   | Forks, logarithmic                                                    |
| Confirmed compatibility | 0.05   | Share of agents with declared or verified support                     |

After the sum:

- A **flagged** skill's score is multiplied by 0.25, and it gets no trend score.
- Each open community report subtracts 0.03, up to 0.15.

Every score stores its per-signal values and a plain-language explanation. The skill page shows the three largest contributions, and `GET /api/v1/skills/:id` returns all of them.

### Trends use recorded history only

Each sync stores one row per repository per day in `github_metrics_history`. Star growth is the latest snapshot minus the most recent snapshot that is at least N days older. If no snapshot is old enough the growth is unknown: it is not interpolated, estimated or back-filled.

Until a repository has seven days of history its trend scores are zero. Until the catalog has seven days, the Trending page and `GET /api/v1/trending` say so and list skills by most recent content change instead (`"basis": "recent_activity"`).

### Sort orders

`recommended` (quality; the default when browsing), `relevance` (the default when searching), `popular`, `trending`, `rising`, `maintained`, `updated`, `newest`, `name`.

### Recomputing

```bash
pnpm worker rank
```

The worker also queues a ranking run after any sync that changed something. To add a signal, add it to `SIGNALS` and `DEFAULT_WEIGHTS` in `packages/ranking/src/index.ts` with tests; weights are normalised to sum to 1.

## Measured performance

```bash
pnpm bench:search
```

The benchmark builds a throwaway catalog of 20,000 synthetic skills in 2,000 repositories (a 234 MB database), then times the same code path the Explore page and the API use: index lookup, filtering, and loading one page of 30 results. The synthetic text uses a 40-word vocabulary, so nearly every skill matches every query word. That is a deliberate worst case; real queries are far more selective.

Measured on 2026-11-16: Apple M4, 10 cores, 16 GB RAM, Node 22.16, SQLite, 300 iterations each.

| Operation                                 | p50    | p95   |
| ----------------------------------------- | ------ | ----- |
| Search, one word that every skill matches | 22 ms  | 25 ms |
| Search, two words                         | 28 ms  | 44 ms |
| Search, prefix while typing               | 25 ms  | 34 ms |
| Search with three filters                 | 20 ms  | 26 ms |
| Search, rare term                         | 0.5 ms | 6 ms  |
| Suggestions                               | 4 ms   | 7 ms  |
| Browse, recommended order, first page     | 28 ms  | 33 ms |
| Browse, page 300                          | 45 ms  | 62 ms |

Setup at that size: ranking all 20,000 skills takes 0.4 s and building the index 0.9 s.

These numbers are from a fast development machine. A 1–2 vCPU VPS will be slower; it is measured in Phase 9, not assumed here.

## Known limits

- Very deep pages are the slowest path because the database sorts the whole filtered set. Page 300 of an unfiltered list is rarely requested; if it becomes a problem, keyset pagination is the fix.
- All skills in one repository share its popularity and growth, so a repository with hundreds of skills can fill a trend list.
- Search matches whole words and prefixes. A fragment from the middle of a word is found only by the substring fallback.
- On PostgreSQL results are filtered but not ranked by relevance.
