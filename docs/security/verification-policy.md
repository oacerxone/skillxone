# Verification policy

Policy version: **0.1-draft** (proposed, Phase 0). Published with the site; every report names the policy version it was judged under.

## What the labels mean

| State          | Meaning                                                                                                                                                                                                       | What it does not mean                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED**   | This exact version (commit SHA and content hash) completed every required check under the named policy version with no open finding at or above the blocking threshold, and the verification has not expired. | That the skill is safe. Static analysis misses things, and prompt injection in particular cannot be detected reliably. |
| **UNVERIFIED** | No completed assessment exists for the current version, or required checks were skipped, or the last verification expired.                                                                                    | That anything is wrong with it.                                                                                        |
| **FLAGGED**    | The current version has at least one open blocking finding, listed in the public report with file, line and explanation.                                                                                      | That the skill is malicious. A flag is a specific claim that can be appealed.                                          |

Lifecycle states, shown alongside: `PENDING` (queued), `SCANNING`, `COMPLETE`, `EXPIRED`, `FAILED` (the scanner errored or timed out; treated as UNVERIFIED).

There is no numeric safety score. Reports show counts by severity and the list of findings.

## Decision rule

Given the latest complete scan of the current version:

1. Any open `critical` or `high` finding → **FLAGGED**.
2. Else, if every **required** scanner ran to completion and there are no open `medium` findings → **VERIFIED**, expiring after 30 days (configurable).
3. Otherwise → **UNVERIFIED**, with the reason shown (open medium findings, a skipped required check, scan failure).

`low` and `info` findings never block. A finding an administrator has marked `false_positive` or `accepted` (with a recorded note) is not open.

Required scanners: prompt injection, dangerous commands, credentials, network and exfiltration, file access, repository integrity. The dependency scanner is required only when a dependency manifest exists; if OSV is unreachable it is recorded as skipped and the result is UNVERIFIED rather than a silent pass.

## Invalidation

A verification is bound to `(skill, content_hash, policy_version, scanner_version)`.

- **Content changes**: the new version starts UNVERIFIED and PENDING. The previous version's record remains in history. The install command for a verified skill pins the verified commit, so the label and the installed bytes match.
- **Expiry**: at `expires_at` the state becomes UNVERIFIED and EXPIRED, and a rescan is queued.
- **Policy or scanner change**: a new policy major version or scanner version queues reassessment of everything; existing verifications stand until their rescan completes or they expire.
- **Repository events**: an ownership transfer or rename revokes verification immediately pending rescan and adds an integrity finding (`medium`).
- **Manual revocation**: an administrator can revoke with a required reason; recorded in `verification_records` and `audit_logs`.

## Scanners

All scanning is static. Files are read as text; nothing from a repository is executed, imported, installed or rendered by the scanner.

| Scanner                  | Looks for                                                                                                                                                                                                                                                                                     | Method                                                                                                                                                                                    | Known limits                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Prompt injection         | Instructions to ignore or override system or developer instructions, reveal prompts or secrets, disable safeguards, act outside the skill's stated purpose, hide actions from the user; invisible Unicode (tag characters, bidi controls, zero-width runs); instructions inside HTML comments | Phrase and structure rules over Markdown text, with code blocks and quoted examples weighted lower                                                                                        | Paraphrase and indirection evade it. Skills that teach about prompt injection trigger it. |
| Dangerous commands       | `rm -rf` on broad paths, `curl … \| sh`, `chmod 777`, `sudo`, disk and partition tools, history and log wiping, `eval` of fetched content, encoded payloads piped to an interpreter, persistence (cron, launch agents, shell profiles)                                                        | Tokenised command patterns in scripts and fenced code. Context lowers severity: a command under a heading such as "Do not run" or scoped to a temp directory                              | Obfuscated or dynamically built commands                                                  |
| Credentials              | API keys, tokens, private keys committed in skill files                                                                                                                                                                                                                                       | Built-in high-precision patterns with entropy checks. Optional adapter to `gitleaks` when the binary is installed; its absence is recorded, not hidden. Excerpts are redacted in reports. | Custom secret formats                                                                     |
| Network and exfiltration | Commands and instructions that send local data out: `curl`/`wget` uploads, `nc`, DNS tricks, webhooks, paste sites, URL shorteners, raw IP hosts, non-HTTPS URLs                                                                                                                              | URL extraction plus a domain reputation list kept in the repository and reviewed by pull request                                                                                          | A legitimate-looking domain                                                               |
| Dependencies             | Known vulnerabilities in `package.json`, lockfiles, `requirements.txt`, `pyproject.toml` found inside the skill directory                                                                                                                                                                     | OSV.dev batch API; results cached by package and version                                                                                                                                  | Unpinned ranges are reported as `info`, not resolved                                      |
| File access              | Reads of `~/.ssh`, `~/.aws`, `~/.config/gcloud`, `.env`, keychains, browser profiles, shell history, agent credential stores                                                                                                                                                                  | Path patterns in commands and prose, severity raised when combined with a network finding in the same file                                                                                | Paths assembled at run time                                                               |
| Repository integrity     | Binaries and archives, executable bits, symlinks escaping the skill directory, missing license, owner or location change, changes to scripts or install instructions since the last verified version                                                                                          | Tree metadata and a diff against the previous version                                                                                                                                     | —                                                                                         |

### Severity

| Severity | Used for                                                                          |
| -------- | --------------------------------------------------------------------------------- |
| critical | Clear data exfiltration or destructive behaviour, live credentials                |
| high     | Strong injection patterns, remote code piped to a shell, sensitive-path reads     |
| medium   | Suspicious but context-dependent patterns, unexplained binaries, ownership change |
| low      | Hygiene: missing license, non-HTTPS links, unpinned dependencies                  |
| info     | Facts worth knowing: has executable scripts, requests broad `allowed-tools`       |

Every rule carries an id, severity, explanation and suggested remediation, and ships with positive and negative test fixtures. A rule cannot be merged without both.

## Report contents

Skill identity, commit SHA, content hash, scan timestamp, scanner version, policy version, each scanner that ran with its version, each check that was skipped and why, findings (rule id, severity, file, line range, excerpt, explanation, remediation, review status), resulting state, and verification expiry. Reports for past versions stay available.

## Resource limits

Scans run in the worker, never in a web request. Per scan: wall-clock timeout (default 60 s), per-file size cap, total size cap, regex execution guarded against catastrophic backtracking by using linear-time patterns and a per-rule time budget. Concurrency is `SCAN_CONCURRENCY` (default 1 on 1 GB, 2 on 2 GB). A timeout produces `FAILED`, never a pass.

## Dynamic analysis

Not part of this policy and not shipped in the beta. The `Scanner` interface allows a dynamic scanner later, and `DYNAMIC_ANALYSIS=off` is the default and the only supported value for now. If it is added it must run outside the application host's trust boundary: separate sandbox (container or microVM), no production credentials, no route to internal services, default-deny network, CPU, memory, process and time limits, read-only root, ephemeral filesystem. It would add evidence to reports; it would not be a requirement for VERIFIED until proven reliable.

## False positives and appeals

1. Anyone can file a `false_positive` report against a specific finding from the report page (no account needed), or open a GitHub issue using the appeal template.
2. A maintainer reviews within the published target (proposed: 7 days), and either marks the finding `false_positive` with a public note, adjusts the rule, or upholds it with a reason.
3. A fingerprint marked false positive stays suppressed for that skill across rescans until the matched content changes.
4. Rule changes go through pull request with required review from a security maintainer (CODEOWNERS on `packages/security/`).
5. Every decision is written to `audit_logs` and shown in the skill's verification history.

## Honest limits

This policy reduces risk and makes evidence visible. It does not certify behaviour. Heuristics produce both false positives and false negatives, a skill can fetch new instructions at run time, and a verified version says nothing about the next commit. The site says this next to every badge.
