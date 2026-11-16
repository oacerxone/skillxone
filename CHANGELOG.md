# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0-beta] - 2026-11-16

First beta. Not yet run in production; see "Known limitations".

### Added

- **Catalog and site**: browse, search (SQLite FTS5 with BM25), filter by category, agent and verification state; skill pages with sanitised SKILL.md, files, versions and security report; light and dark themes; WCAG 2.2 AA checked with axe on every page template.
- **GitHub ingestion**: seed, repository search, code search, collection and recrawl discovery; ETag-conditional requests; rate-limit parking; renames, transfers and deletions handled by repository id; content hashing compatible with `skills-lock.json` v2.
- **Ranking**: nine explained signals, logarithmic popularity, trends only from recorded history (at least 7 days), flagged skills reduced and never trending.
- **Security assessment**: seven static scanners (prompt injection, dangerous commands, credentials, network and exfiltration, dependencies via OSV.dev, file access, repository integrity) and an optional gitleaks adapter; verification policy 0.1-draft as code; expiry and rescans; reviewer decisions that follow a finding's fingerprint; public reports.
- **Installer**: Claude Code and Codex adapters checked against skills CLI 1.9.0 and both agents' documentation; CLI (symlink or copy) and manual methods; POSIX and PowerShell quoting; commands pinned to the verified commit; `GET /api/v1/skills/:id/install`.
- **Automation**: configurable schedules, `worker serve`, lease heartbeats, recovery from crashed workers, job pruning.
- **Community**: repository submissions and reports (`POST /api/v1/submissions`, `POST /api/v1/reports`), GitHub OAuth sign-in, sessions, CSRF protection, admin dashboard (submissions, reports, findings, skills, repositories, jobs, audit log, settings), audit log, OpenAPI 3.1 document.
- **Deployment**: VPS guide with systemd, Caddy and Nginx files; Dockerfile and Compose (worker and PostgreSQL profiles); static catalog export with client-side search and a scheduled GitHub Pages workflow; online backup and restore.
- **Project**: governance, contribution and extension guides, issue and pull request templates, CI (lint, types, unit, e2e, PostgreSQL, static export, Docker, installer contract), security workflow (audit, gitleaks, CodeQL), release workflow, Dependabot.

### Security

- Content-Security-Policy with per-request nonces; admin roles re-read from the allowlist on every request; SQLite write transactions take the lock up front. See [docs/security/platform-review.md](docs/security/platform-review.md).

### Known limitations

- Not run on a real Linux server; the systemd, Caddy and Nginx files are untested there. The Docker image and the installer contract test run only in CI (no Docker or Node 22.20 on the development machine). GitHub OAuth was tested against a fake GitHub only.
- Blocking findings on the seed catalog are all `curl … | sh` installers from the vendors' own domains; medium findings still have a 61% false-positive rate on the reviewed sample ([live-catalog-review.md](docs/security/live-catalog-review.md)). False negatives have not been measured.
- Dependency checks parse `package.json`, `package-lock.json`, `requirements.txt` and `pyproject.toml` only; other manifests leave a skill Unverified.
- The static export's search index is not sharded; it grows with the catalog (155 KB gzipped for 668 skills).
- MAINTAINERS.md and CODEOWNERS contain placeholders for the project owner to fill in, and SECURITY.md needs a fallback contact.
- Trend scores stay at zero until seven days of star history have been recorded.

[0.1.0-beta]: https://github.com/oacerxone/skillxone/releases/tag/v0.1.0-beta
