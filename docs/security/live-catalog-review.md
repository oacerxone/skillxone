# Live catalog scan: false-positive review

Phase 5 acceptance asks for a scan of the live seed catalog and a hand review of its findings. This page records what was found, how the rules were tuned, and what is still wrong. It describes one run on one date. It is evidence about the scanner, not a statement about any skill.

## The run

| Item               | Value                                                                               |
| ------------------ | ----------------------------------------------------------------------------------- |
| Date               | 2026-11-16                                                                          |
| Catalog            | 12 seed repositories from `catalog/seeds.json`, 668 skills, indexed without a token |
| Scanner and policy | `skillxone-scan-1.0.0`, policy `0.1-draft`                                          |
| Optional tools     | gitleaks not installed (recorded as skipped); OSV.dev lookups on                    |
| Time               | 668 scans plus one ranking job in about 6 seconds on an Apple M4 laptop             |
| Scan failures      | none (668 of 668 complete)                                                          |

Dependency coverage was thin: 11 skills ship a manifest (7 `requirements.txt`, 4 `package.json`). Between them they declare 1 exact version, which OSV.dev was asked about (no advisory), and 18 ranges, which are reported as `info` and not resolved.

## First pass: before tuning

41 high findings flagged 24 skills. Every critical, high and medium finding was read by hand in its file.

| Rule                     | High findings | Verdict                                                                                             |
| ------------------------ | ------------: | --------------------------------------------------------------------------------------------------- |
| `FILE-BROWSER-PROFILE`   |            16 | All false: the word "Cookies" in web-security advice and test-framework APIs                        |
| `CMD-REMOTE-PIPE-SHELL`  |            12 | All correct: vendor installers piped to a shell                                                     |
| `PI-DISABLE-SAFEGUARDS`  |             3 | All false: CLI flags documented as "skip confirmation prompt"                                       |
| `PI-IGNORE-INSTRUCTIONS` |             3 | All false: "override the default system prompt" (a setting), a defensive rule, and a quoted example |
| `FILE-CLOUD-CREDENTIALS` |             2 | False as high: a path named in prose, and a read of `~/.aws/config`, which holds no secrets         |
| `FILE-SSH-KEYS`          |             2 | False as high: code comments explaining a defence against reading `~/.ssh/id_rsa`                   |
| `NET-CLOUD-METADATA`     |             1 | False as high: the metadata address listed in a vulnerability reference                             |
| `NET-LISTED-DOMAIN`      |             1 | Correct match (`webhook.site`) in a documentation example                                           |
| `PI-REVEAL-PROMPT`       |             1 | False: "send it as a system message" in API documentation                                           |

**Blocking false-positive rate, first pass: 28 of 41 high findings (68%).** 16 of the 24 flagged skills were flagged only because of false positives.

## Changes made

Each change has a regression test in `packages/security/src/rules.test.ts`, written in our own words rather than copied from the skills.

- `FILE-BROWSER-PROFILE` now needs a browser profile path (`…/Default/Cookies`) or a file name that only browsers use (`logins.json`, `key4.db`, `cookies.sqlite`).
- `PI-DISABLE-SAFEGUARDS` no longer matches "skip confirmation prompt". It still matches disabling permission prompts, guardrails and safety checks.
- `PI-IGNORE-INSTRUCTIONS` ignores "override the default …" and "override instructions found in files" (a defence against injection).
- `PI-REVEAL-PROMPT` dropped the verbs "send" and "share" and the bare phrase "system message".
- `PI-JAILBREAK-PERSONA` ignores "jailbreak detection", "jailbreak attempts" and similar.
- A phrase in double quotes in prose is treated as a quotation.
- Whole-line script comments lower command, network and file-access findings by one level. A comment can be negated ("must not"), but code never is.
- File-access rules and `NET-CLOUD-METADATA` are one level lower in prose: naming a path is a mention, reading it in code is an action.
- `NET-LISTED-DOMAIN` is one level lower in Markdown than in scripts.
- `~/.aws/config` is no longer treated as a credential file; `~/.aws/credentials` still is.
- HTML comment markers inside inline code (`` `<!-- x -->` ``) are no longer treated as comments.

## Second pass: after tuning

| State      | Skills |
| ---------- | -----: |
| Verified   |    646 |
| Unverified |     14 |
| Flagged    |      8 |

**Blocking findings: 12 high, all `CMD-REMOTE-PIPE-SHELL`, all correct detections (0 false positives).** Every one is a vendor's official installer fetched from that vendor's own domain. They are flagged because the policy treats running unreviewed remote code as high severity, not because anything malicious was found. Maintainers can mark such findings `accepted` with a note, which the policy allows.

**Medium findings** (they keep a skill Unverified but do not flag it): 18 in total.

| Verdict | Count | Findings                                                                                                                                                                                                                                                           |
| ------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Correct |     7 | 3 files too large to scan in full; 1 bundled archive; 1 deploy script uploading a tarball; 1 documented `SCHTASKS /Create` example; 1 instruction never to tell the user that evidence was missing                                                                 |
| False   |    11 | 4 HTML comments in fill-in templates; 2 credential paths named in prose; 1 code comment naming `~/.ssh/id_rsa`; 1 metadata address in a reference list; 1 `webhook.site` documentation example; 1 detection regex quoted in code; 1 "don't narrate each tool call" |

**Medium false-positive rate, second pass: 11 of 18 (61%).** These cost verification (14 skills Unverified) but never produce a flag.

**Low findings:** 139. In a random sample of 18, 16 were accurate (plain-http links, real `sudo` commands). 2 were XML or JSON schema identifiers that are never fetched and should be added to the namespace ignore list.

## What this review does not show

- **False negatives.** The catalog contains no known-malicious skills, so this run says nothing about what the scanner misses. The positive fixtures show that each rule fires on its target pattern. Nothing shows the rules catch an attacker who is trying to evade them.
- **Overfitting.** The rules were tuned on the same catalog they were measured on. The second-pass numbers are therefore optimistic. A held-out set (new repositories added after this date) is the honest next measurement.
- **Evasion through negation.** Lowering severity for warning context can be abused (see [rules.md](rules.md#how-context-changes-severity)).
