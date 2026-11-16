# Database schema

Status: **proposed** (Phase 0). Migrations are written in Kysely's schema builder in Phase 1; the DDL below is the dialect-neutral design they implement.

## Conventions

- `id`: `TEXT` ULID primary key, generated in the application. Sortable by creation time.
- Timestamps: `TEXT`, ISO-8601 UTC (`2026-11-16T09:30:00.000Z`). Compare lexically.
- Booleans: `INTEGER` 0 or 1. JSON: `TEXT`, parsed and validated in the application.
- Enumerations: `TEXT` with a `CHECK` constraint.
- Every foreign key is declared and indexed. `ON DELETE` is `CASCADE` for owned children and `RESTRICT` otherwise; records are soft-deleted through `status`, so cascades run only in admin purges.
- No triggers, no stored procedures, no dialect-specific column types.

## Tables

```sql
-- 1
CREATE TABLE repositories (
  id                TEXT PRIMARY KEY,
  github_id         INTEGER NOT NULL UNIQUE,          -- stable across renames and transfers
  owner             TEXT NOT NULL,
  name              TEXT NOT NULL,
  full_name_lower   TEXT NOT NULL UNIQUE,             -- "owner/name" lowercased
  owner_github_id   INTEGER,
  owner_type        TEXT CHECK (owner_type IN ('User','Organization')),
  previous_full_names TEXT NOT NULL DEFAULT '[]',     -- JSON array, rename/transfer trail
  description       TEXT,
  homepage_url      TEXT,
  default_branch    TEXT,
  head_sha          TEXT,
  license_spdx      TEXT,
  stars             INTEGER NOT NULL DEFAULT 0,
  forks             INTEGER NOT NULL DEFAULT 0,
  open_issues       INTEGER NOT NULL DEFAULT 0,
  is_archived       INTEGER NOT NULL DEFAULT 0,
  is_fork           INTEGER NOT NULL DEFAULT 0,
  pushed_at         TEXT,
  github_created_at TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','archived','deleted','disabled','unreachable')),
  discovery_source  TEXT NOT NULL,                    -- provider id that first found it
  etag              TEXT,
  last_synced_at    TEXT,
  last_sync_error   TEXT,
  missing_count     INTEGER NOT NULL DEFAULT 0,       -- consecutive 404s
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_repositories_status_synced ON repositories (status, last_synced_at);
CREATE INDEX idx_repositories_stars ON repositories (stars);

-- 2
CREATE TABLE skills (
  id                 TEXT PRIMARY KEY,
  repository_id      TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path               TEXT NOT NULL,                   -- skill directory, '' for repo root
  slug               TEXT NOT NULL UNIQUE,            -- URL id: owner/repo/skill-name, disambiguated
  name               TEXT NOT NULL,                   -- frontmatter name as written
  description        TEXT NOT NULL DEFAULT '',
  curated_title      TEXT,                            -- admin override, nullable
  curated_description TEXT,
  license            TEXT,
  compatibility_note TEXT,
  current_version_id TEXT REFERENCES skill_versions(id),
  verification_state TEXT NOT NULL DEFAULT 'UNVERIFIED'
                     CHECK (verification_state IN ('VERIFIED','UNVERIFIED','FLAGGED')),
  lifecycle_state    TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (lifecycle_state IN ('PENDING','SCANNING','COMPLETE','EXPIRED','FAILED')),
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','removed','hidden')),
  spec_valid         INTEGER NOT NULL DEFAULT 0,
  first_indexed_at   TEXT NOT NULL,
  content_updated_at TEXT,                            -- last time the content hash changed
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (repository_id, path)
);
CREATE INDEX idx_skills_state ON skills (status, verification_state);
CREATE INDEX idx_skills_content_updated ON skills (content_updated_at);
CREATE INDEX idx_skills_first_indexed ON skills (first_indexed_at);

-- 3
CREATE TABLE skill_versions (
  id               TEXT PRIMARY KEY,
  skill_id         TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  commit_sha       TEXT NOT NULL,                     -- repository commit the files were read at
  content_hash     TEXT NOT NULL,                     -- skills-lock computedHash algorithm
  tree_sha         TEXT,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  parse_errors_json TEXT NOT NULL DEFAULT '[]',
  dependencies_json TEXT NOT NULL DEFAULT '[]',       -- detected manifests and declared requirements
  file_count       INTEGER NOT NULL DEFAULT 0,
  total_bytes      INTEGER NOT NULL DEFAULT 0,
  has_scripts      INTEGER NOT NULL DEFAULT 0,
  has_binaries     INTEGER NOT NULL DEFAULT 0,
  committed_at     TEXT,
  indexed_at       TEXT NOT NULL,
  UNIQUE (skill_id, content_hash)
);
CREATE INDEX idx_skill_versions_skill_indexed ON skill_versions (skill_id, indexed_at);

-- 4
CREATE TABLE skill_files (
  id            TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,                        -- relative to the skill directory
  blob_sha      TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('skill_md','markdown','script','manifest','config','binary','other')),
  is_executable INTEGER NOT NULL DEFAULT 0,
  is_binary     INTEGER NOT NULL DEFAULT 0,
  content       TEXT,                                 -- text files under the size cap only; else NULL
  truncated     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (version_id, path)
);

-- 5
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 6
CREATE TABLE skill_categories (
  skill_id    TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('auto','curated')),
  PRIMARY KEY (skill_id, category_id)
);
CREATE INDEX idx_skill_categories_category ON skill_categories (category_id);

-- 7
CREATE TABLE agent_compatibility (
  skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL,                           -- adapter id, e.g. 'claude-code'
  level      TEXT NOT NULL CHECK (level IN ('declared','inferred','verified','unsupported')),
  evidence   TEXT,                                    -- why: path layout, frontmatter, manual check
  warnings_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, agent_id)
);
CREATE INDEX idx_agent_compat_agent ON agent_compatibility (agent_id, level);

-- 8
CREATE TABLE github_metrics_history (
  id            TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  captured_on   TEXT NOT NULL,                        -- YYYY-MM-DD, one row per repo per day
  stars         INTEGER NOT NULL,
  forks         INTEGER NOT NULL,
  open_issues   INTEGER NOT NULL,
  pushed_at     TEXT,
  UNIQUE (repository_id, captured_on)
);

-- 9
CREATE TABLE security_scans (
  id              TEXT PRIMARY KEY,
  skill_id        TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version_id      TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  commit_sha      TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  scanner_version TEXT NOT NULL,                      -- engine version
  policy_version  TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('PENDING','SCANNING','COMPLETE','FAILED')),
  outcome         TEXT CHECK (outcome IN ('PASS','FAIL','INCONCLUSIVE')),
  checks_run_json     TEXT NOT NULL DEFAULT '[]',     -- [{scanner, version, durationMs}]
  checks_skipped_json TEXT NOT NULL DEFAULT '[]',     -- [{scanner, reason}]
  error           TEXT,
  log             TEXT,                               -- admin-only scanner log, capped
  started_at      TEXT,
  finished_at     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_security_scans_skill ON security_scans (skill_id, created_at);
CREATE UNIQUE INDEX idx_security_scans_identity
  ON security_scans (version_id, scanner_version, policy_version);

-- 10
CREATE TABLE security_findings (
  id          TEXT PRIMARY KEY,
  scan_id     TEXT NOT NULL REFERENCES security_scans(id) ON DELETE CASCADE,
  rule_id     TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN
              ('prompt_injection','dangerous_command','credential','network_exfiltration',
               'dependency','file_access','integrity')),
  severity    TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  file_path   TEXT,
  line_start  INTEGER,
  line_end    INTEGER,
  excerpt     TEXT,                                   -- redacted for credential findings
  explanation TEXT NOT NULL,
  remediation TEXT NOT NULL,
  fingerprint TEXT NOT NULL,                          -- rule + file + normalised match, for suppression
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','false_positive','accepted')),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT
);
CREATE INDEX idx_security_findings_scan ON security_findings (scan_id);
CREATE INDEX idx_security_findings_open ON security_findings (status, severity);
CREATE INDEX idx_security_findings_fingerprint ON security_findings (fingerprint);

-- 11
CREATE TABLE verification_records (
  id            TEXT PRIMARY KEY,
  skill_id      TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version_id    TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  scan_id       TEXT REFERENCES security_scans(id),
  state         TEXT NOT NULL CHECK (state IN ('VERIFIED','UNVERIFIED','FLAGGED')),
  reason        TEXT NOT NULL,                        -- machine code: POLICY_PASS, CONTENT_CHANGED, EXPIRED, REVOKED...
  policy_version TEXT NOT NULL,
  decided_by    TEXT NOT NULL,                        -- 'system' or users.id
  note          TEXT,
  valid_from    TEXT NOT NULL,
  expires_at    TEXT,
  superseded_at TEXT                                  -- NULL on the current record
);
CREATE INDEX idx_verification_skill_current ON verification_records (skill_id, superseded_at);
CREATE INDEX idx_verification_expiry ON verification_records (expires_at);

-- 12
CREATE TABLE ranking_scores (
  skill_id        TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
  quality_score   REAL NOT NULL,                      -- 0..1, query-independent
  trending_score  REAL NOT NULL DEFAULT 0,
  rising_score    REAL NOT NULL DEFAULT 0,
  maintenance_score REAL NOT NULL DEFAULT 0,
  signals_json    TEXT NOT NULL,                      -- {signalId: {value, weight, explanation}}
  weights_version TEXT NOT NULL,
  history_days    INTEGER NOT NULL DEFAULT 0,         -- days of real metrics behind the trend
  computed_at     TEXT NOT NULL
);
CREATE INDEX idx_ranking_quality ON ranking_scores (quality_score);
CREATE INDEX idx_ranking_trending ON ranking_scores (trending_score);

-- 13
CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  curator_id  TEXT REFERENCES users(id),
  source_repository_id TEXT REFERENCES repositories(id),  -- when mirrored from a known collection repo
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 14
CREATE TABLE collection_skills (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  skill_id      TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  PRIMARY KEY (collection_id, skill_id)
);

-- 15
CREATE TABLE submissions (
  id              TEXT PRIMARY KEY,
  repo_full_name_lower TEXT NOT NULL,                 -- parsed and validated, never a raw URL
  repository_id   TEXT REFERENCES repositories(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','duplicate','requires_review')),
  submitter_id    TEXT REFERENCES users(id),
  submitter_ip_hash TEXT,                             -- salted hash, for abuse control only
  note            TEXT,
  review_note     TEXT,
  reviewed_by     TEXT REFERENCES users(id),
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_submissions_status ON submissions (status, created_at);
CREATE INDEX idx_submissions_repo ON submissions (repo_full_name_lower);

-- 16
CREATE TABLE reports (
  id            TEXT PRIMARY KEY,
  skill_id      TEXT REFERENCES skills(id) ON DELETE CASCADE,
  repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  finding_id    TEXT REFERENCES security_findings(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN
                ('security_concern','false_positive','inaccurate_metadata','duplicate','takedown','other')),
  body          TEXT NOT NULL,
  contact       TEXT,                                 -- optional, admin-only
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','triaged','resolved','dismissed')),
  reporter_id   TEXT REFERENCES users(id),
  reporter_ip_hash TEXT,
  resolution_note TEXT,
  resolved_by   TEXT REFERENCES users(id),
  resolved_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_reports_status ON reports (status, created_at);
CREATE INDEX idx_reports_skill ON reports (skill_id);

-- 17
CREATE TABLE sync_jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,                         -- discover, sync_repo, scan_skill, rank, reindex, expire_verifications...
  payload_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key   TEXT,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','running','succeeded','failed','dead','cancelled')),
  priority     INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after    TEXT NOT NULL,
  locked_by    TEXT,
  locked_until TEXT,
  last_error   TEXT,
  result_json  TEXT,
  schedule     TEXT,                                  -- name of the schedule that enqueued it
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX idx_sync_jobs_claim ON sync_jobs (status, run_after, priority);
CREATE INDEX idx_sync_jobs_type_finished ON sync_jobs (type, finished_at);
CREATE UNIQUE INDEX idx_sync_jobs_dedupe ON sync_jobs (dedupe_key)
  WHERE status IN ('queued','running');               -- partial index: supported by SQLite and PostgreSQL

-- 18
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  github_id     INTEGER NOT NULL UNIQUE,
  login         TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
  is_disabled   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

-- 19
CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),              -- NULL for system
  action      TEXT NOT NULL,                          -- e.g. verification.revoke
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_target ON audit_logs (target_type, target_id, created_at);
CREATE INDEX idx_audit_actor ON audit_logs (actor_id, created_at);
```

## Supporting tables

Needed by the design but not in the brief's list:

```sql
CREATE TABLE ingestion_errors (
  id            TEXT PRIMARY KEY,
  repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  job_id        TEXT REFERENCES sync_jobs(id) ON DELETE SET NULL,
  code          TEXT NOT NULL,                        -- RATE_LIMITED, MALFORMED_FRONTMATTER, TREE_TRUNCATED...
  path          TEXT,
  message       TEXT NOT NULL,
  resolved_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_ingestion_errors_repo ON ingestion_errors (repository_id, created_at);

CREATE TABLE settings (                               -- admin-editable: schedules, weights, flags
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL
);

CREATE TABLE sessions (                               -- admin and optional user login
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, csrf_secret TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
```

## Search index

Owned by `packages/search`, created by its own dialect-specific migration, rebuildable from `skills` at any time with `worker reindex`:

- SQLite: `CREATE VIRTUAL TABLE skills_fts USING fts5(name, description, owner, repo, categories, body, tokenize='porter unicode61')`, keyed by `skills.rowid`.
- PostgreSQL: a `skills_search` table with a `tsvector` column and a GIN index.

Because it is derived data, a corrupt index is repaired by dropping and rebuilding it. `healthy()` runs an integrity check and the admin Jobs page shows the result.

## Notes

- `skills.verification_state` and `lifecycle_state` are denormalised from the current `verification_records` row and latest `security_scans` row so list queries need no joins. They are written only by one function in `packages/database`, inside the same transaction as the source rows.
- `skills.current_version_id` and `skill_versions.skill_id` form a cycle; the migration creates `skills` first without the constraint and adds it after `skill_versions`. In SQLite the reference is enforced in the application layer and checked by a test, since `ALTER TABLE ADD CONSTRAINT` is unavailable there.
- Seed data: `packages/database/seed/dev/` holds fixtures whose rows carry `discovery_source='dev-fixture'`. The UI shows a banner whenever any such row exists, and a production start refuses to run with fixtures present unless `ALLOW_DEV_FIXTURES=1`.
- `ip_hash` columns store `HMAC(server secret, ip)` truncated, rotated with the secret. Raw IP addresses are not stored.
