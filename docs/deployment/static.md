# Mode C: static catalog

`pnpm export:static [dir]` writes the catalog as plain files that any static host can serve:

- a catalog page, category pages, and one detail page per skill (rendered SKILL.md through the same sanitiser as the server, install commands, security assessment)
- a search page that runs in the browser with a MiniSearch index (`search/index.json`)
- read-only JSON mirroring the API's GET routes, with `.json` appended: `api/v1/skills.json`, `api/v1/skills/<id>.json`, `api/v1/skills/<id>/security.json`, `api/v1/categories.json`

Links between pages are relative, so the folder works at a domain root or under a sub-path (for example a GitHub Pages project site).

## What it does not have

There is no server, so there are no submissions or reports (links go to the repository's issue templates instead), no accounts or admin, no rate limiting, and no live data: the site is as fresh as its last build. Detail pages contain no scripts. Only the search page loads two scripts from the same site, under a `script-src 'self'` Content Security Policy.

## Building on a schedule (GitHub Pages)

`.github/workflows/catalog.yml` runs daily (and on demand):

1. It restores the previous database from the Actions cache, so star history accumulates between runs.
2. It discovers and syncs the seed repositories, collections and previously indexed repositories, using the workflow's own token.
3. It expires verifications, scans unassessed skills, ranks and reindexes.
4. It exports and publishes to GitHub Pages.

To use it, enable Pages with "GitHub Actions" as the source in the repository settings. Scheduled workflows can be delayed or skipped by GitHub. The workflow is idempotent, so a missed run only delays freshness.

## Building by hand

```bash
pnpm worker migrate && pnpm worker seed && pnpm worker discover && pnpm worker drain
```

```bash
pnpm export:static out-static
```

Upload `out-static/` to your host. To preview locally: `node scripts/serve-static.mjs out-static 3300`.

## Size

With the 668-skill seed catalog the export is 19 MB, and the search index is 562 KB (155 KB gzipped). The browser downloads the whole index the first time someone searches. The index is not yet split into shards; past a few thousand skills that becomes the main cost of this mode.

## Tests

`pnpm test:static` exports the fixture catalog and runs Playwright against the folder, served by a plain file server: listing, detail pages, client-side search, the JSON mirror, the absence of server-only routes, and axe checks.
