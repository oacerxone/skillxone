# Measurements

Recorded on 2026-11-16 on an Apple M4 laptop (macOS, Node.js 22.16), not on a Linux VPS. Absolute numbers on a small VPS will be slower; the memory profile should be similar. Re-measure on your own hardware before relying on these figures.

## Web process memory (production build, `next start`)

Catalog: the real 668-skill seed catalog (`data/live.db`). Load: 20 concurrent clients for 30 seconds, cycling through the home page, explore (plain, search and sorted), categories, trending, verified, 60 skill detail pages, and the skills, search and suggest API routes. RSS sampled once a second.

| Setting                                 | Idle after start | After first pages | Peak under load | 20 s after load | Throughput | p50 / p95 / p99 latency | Errors |
| --------------------------------------- | ---------------: | ----------------: | --------------: | --------------: | ---------: | ----------------------- | -----: |
| Default                                 |           123 MB |            142 MB |          409 MB |          181 MB |  107 req/s | 187 / 244 / 276 ms      |      0 |
| `NODE_OPTIONS=--max-old-space-size=192` |           125 MB |                 — |          258 MB |          170 MB |   96 req/s | 210 / 282 / 311 ms      |      0 |

For a 1 GB server, cap the V8 heap. The systemd unit sets `--max-old-space-size=256` and `MemoryMax=700M`. Twenty concurrent clients is far more than a small catalog site normally sees.

## Other timings

| Task                                               | Result                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| First ingestion of 12 seed repositories, no token  | 36 GitHub requests, 668 skills (Phase 3)                             |
| Security scan of 668 skills                        | about 6 seconds in total                                             |
| Static export of 668 skills                        | 3.7 seconds; 19 MB; search index 562 KB (155 KB gzipped)             |
| Search p95 on a generated 20,000-skill catalog     | see [search-and-ranking.md](../development/search-and-ranking.md)    |
| Fresh clone to serving, following [vps.md](vps.md) | install, migrate, seed and build in about 25 seconds on this machine |

## Not measured

- Docker image size and container memory (no Docker on this machine; the image is built in CI).
- A real 1 GB VPS.
