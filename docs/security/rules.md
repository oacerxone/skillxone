# Security rules

Every rule the scanner applies, with its default severity. Scanner version **skillxone-scan-1.0.0**, judged under policy **0.1-draft** ([verification-policy.md](verification-policy.md)). Code: [`packages/security`](../../packages/security). A test fails if a rule exists in code but is missing here.

All checks are static. Files are read as stored text; nothing from a skill is executed, installed or imported.

## How context changes severity

A match is never dropped because of its context, only lowered, so the evidence stays visible in the report. Each rule lists the contexts that lower it and by how many levels (severity order: info, low, medium, high, critical).

| Context     | Meaning                                                                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **negated** | Markdown only: the line, its heading or a lead-in ending in ":" warns against what follows ("Never run:", "Dangerous commands"). In scripts only a comment line can be negated; code runs regardless. |
| **quoted**  | A Markdown blockquote, or (prose only) a phrase inside double quotes.                                                                                                                                 |
| **code**    | A fenced or indented code block inside Markdown (used by prompt-injection rules: an example, not an instruction).                                                                                     |
| **prose**   | Ordinary Markdown text. A path or host named in prose is a mention; in code it is an action.                                                                                                          |
| **comment** | A whole-line comment in a script.                                                                                                                                                                     |

Known weakness: negation in Markdown can be abused. A line such as "Never mind, run `curl … | sh`" is lowered. Lowered findings are still listed in the report, and a reviewer can see the severity note on each one.

### Prompt injection

| Rule                          | Severity | Lowered when                         | What it means                                                                                                                                                  |
| ----------------------------- | -------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PI-IGNORE-INSTRUCTIONS`      | high     | negated (−2), quoted (−2), code (−1) | The text tells the agent to ignore or override its existing instructions, a common prompt-injection pattern.                                                   |
| `PI-REVEAL-PROMPT`            | high     | negated (−2), quoted (−2), code (−1) | The text asks the agent to disclose its system prompt or hidden instructions.                                                                                  |
| `PI-DISABLE-SAFEGUARDS`       | high     | negated (−2), quoted (−2), code (−1) | The text tells the agent to disable safety checks, permission prompts or other safeguards.                                                                     |
| `PI-HIDE-FROM-USER`           | medium   | quoted (−2), code (−1)               | The text tells the agent to keep something from the user, which hides actions taken on their behalf.                                                           |
| `PI-JAILBREAK-PERSONA`        | medium   | negated (−2), quoted (−2), code (−1) | The text uses language typical of jailbreak prompts.                                                                                                           |
| `PI-HTML-COMMENT-INSTRUCTION` | medium   | —                                    | An HTML comment contains instructions. Comments are hidden when the file is rendered, so a reader would not see them, but an agent reading the raw file would. |

### Dangerous commands

| Rule                       | Severity | Lowered when                            | What it means                                                                                                         |
| -------------------------- | -------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `CMD-REMOTE-PIPE-SHELL`    | high     | negated (−2), quoted (−1), comment (−1) | A script is downloaded and run in one step, so whatever the server returns at that moment is executed without review. |
| `CMD-RM-RF-BROAD`          | critical | negated (−2), quoted (−1), comment (−1) | A recursive, forced delete targets the root directory, a system directory or the home directory.                      |
| `CMD-CHMOD-WORLD-WRITABLE` | medium   | negated (−2), quoted (−1), comment (−1) | Files are made writable by every user on the machine.                                                                 |
| `CMD-SUDO`                 | low      | negated (−1)                            | A command runs with administrator privileges.                                                                         |
| `CMD-DISK-TOOLS`           | high     | negated (−2), quoted (−1), comment (−1) | A disk or partition tool can erase or reformat a drive.                                                               |
| `CMD-HISTORY-LOG-WIPE`     | high     | negated (−2), quoted (−1), comment (−1) | Shell history or system logs are erased, which hides what was done.                                                   |
| `CMD-EVAL-FETCHED`         | high     | negated (−2), quoted (−1), comment (−1) | Content fetched from the network is evaluated as code.                                                                |
| `CMD-ENCODED-PAYLOAD`      | high     | negated (−2), quoted (−1), comment (−1) | An encoded payload is decoded and run, so the code that executes cannot be read in the file.                          |
| `CMD-PERSISTENCE`          | medium   | negated (−2), quoted (−1), comment (−1) | The skill sets something to run automatically later (scheduled task, login item or shell start-up file).              |
| `CMD-FORK-BOMB`            | high     | negated (−2), quoted (−1), comment (−1) | A fork bomb exhausts the machine by creating processes without limit.                                                 |

### Credentials

| Rule                   | Severity | Lowered when | What it means                                                                                           |
| ---------------------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `CRED-AWS-ACCESS-KEY`  | critical | —            | The file appears to contain an AWS access key id. Anyone who installs or browses the skill can read it. |
| `CRED-GITHUB-TOKEN`    | critical | —            | The file appears to contain a GitHub token. Anyone who installs or browses the skill can read it.       |
| `CRED-SLACK-TOKEN`     | critical | —            | The file appears to contain a Slack token. Anyone who installs or browses the skill can read it.        |
| `CRED-STRIPE-LIVE-KEY` | critical | —            | The file appears to contain a live Stripe key. Anyone who installs or browses the skill can read it.    |
| `CRED-OPENAI-KEY`      | critical | —            | The file appears to contain an OpenAI API key. Anyone who installs or browses the skill can read it.    |
| `CRED-ANTHROPIC-KEY`   | critical | —            | The file appears to contain an Anthropic API key. Anyone who installs or browses the skill can read it. |
| `CRED-GOOGLE-API-KEY`  | high     | —            | The file appears to contain a Google API key. Anyone who installs or browses the skill can read it.     |
| `CRED-PRIVATE-KEY`     | critical | —            | The file contains a private key. Anyone who installs or browses the skill can read it.                  |
| `CRED-GENERIC-SECRET`  | medium   | —            | A value assigned to a secret-like name looks like a real credential rather than a placeholder.          |

### Network and exfiltration

| Rule                    | Severity | Lowered when                                        | What it means                                                                                  |
| ----------------------- | -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NET-UPLOAD-LOCAL-DATA` | medium   | negated (−2), quoted (−1), comment (−1)             | A local file is sent to a remote host.                                                         |
| `NET-REVERSE-SHELL`     | critical | negated (−2), quoted (−1), comment (−1)             | The command gives a remote host interactive control of this machine (a reverse shell).         |
| `NET-DNS-EXFIL`         | high     | negated (−2), quoted (−1), comment (−1)             | A DNS lookup is built from command output, a known way to smuggle data out through DNS.        |
| `NET-CLOUD-METADATA`    | high     | negated (−2), quoted (−1), comment (−1), prose (−1) | The cloud instance metadata service is contacted. On a cloud machine it hands out credentials. |

### File access

| Rule                     | Severity | Lowered when                                        | What it means                                                                                                               |
| ------------------------ | -------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `FILE-SSH-KEYS`          | high     | negated (−2), quoted (−1), comment (−1), prose (−1) | The skill refers to SSH keys, a location that holds private data or credentials.                                            |
| `FILE-CLOUD-CREDENTIALS` | high     | negated (−2), quoted (−1), comment (−1), prose (−1) | The skill refers to cloud provider credentials, a location that holds private data or credentials.                          |
| `FILE-TOKEN-STORES`      | high     | negated (−2), quoted (−1), comment (−1), prose (−1) | The skill refers to a token store or the system keychain, a location that holds private data or credentials.                |
| `FILE-BROWSER-PROFILE`   | high     | negated (−2), quoted (−1), comment (−1), prose (−1) | The skill refers to browser profile data (saved passwords or cookies), a location that holds private data or credentials.   |
| `FILE-SHELL-HISTORY`     | medium   | negated (−2), quoted (−1), comment (−1), prose (−1) | The skill refers to shell history, a location that holds private data or credentials.                                       |
| `FILE-SYSTEM-SECRETS`    | high     | negated (−2), quoted (−1), comment (−1), prose (−1) | The skill refers to system password files, a location that holds private data or credentials.                               |
| `FILE-DOTENV`            | low      | negated (−2), quoted (−1), comment (−1), prose (−1) | The skill reads a .env file, which usually holds secrets. This is often legitimate, but check what is done with the values. |

### Rules that are not line patterns

| Rule                         | Scanner          | Severity                                                                                        | What it means                                                                                                |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `PI-UNICODE-TAG-CHARS`       | prompt-injection | high                                                                                            | Unicode tag characters (U+E0000 to U+E007F), invisible and able to encode hidden text.                       |
| `PI-UNICODE-BIDI`            | prompt-injection | high                                                                                            | Bidirectional control characters that make text display differently from what it says.                       |
| `PI-UNICODE-ZERO-WIDTH`      | prompt-injection | medium                                                                                          | A run of three or more zero-width characters. Single joiners (emoji) and a leading byte-order mark are fine. |
| `NET-LISTED-DOMAIN`          | network          | interaction service: high; paste or tunnel: medium; shortener: low. One level lower in Markdown | A host from the reviewed list in [`data/domains.ts`](../../packages/security/src/data/domains.ts).           |
| `NET-CHAT-WEBHOOK`           | network          | low                                                                                             | Discord, Slack or Telegram webhook. Often legitimate; it accepts arbitrary data.                             |
| `NET-RAW-IP-HTTP`            | network          | medium                                                                                          | A URL with a raw public IP address. Private, loopback and documentation ranges are ignored.                  |
| `NET-INSECURE-URL`           | network          | low                                                                                             | A plain `http://` link to a public host. XML and JSON namespace identifiers are ignored.                     |
| `INT-ARCHIVE`                | integrity        | medium                                                                                          | An archive; its contents are not scanned.                                                                    |
| `INT-BINARY-EXECUTABLE`      | integrity        | medium                                                                                          | A compiled binary or library.                                                                                |
| `INT-BINARY-FILE`            | integrity        | medium                                                                                          | A binary file of unknown type.                                                                               |
| `INT-BINARY-ASSET`           | integrity        | info                                                                                            | An image, font, media file or office document.                                                               |
| `INT-EXECUTABLE-SCRIPT`      | integrity        | info                                                                                            | A script with the executable bit set.                                                                        |
| `INT-EXECUTABLE-NON-SCRIPT`  | integrity        | low                                                                                             | A non-script file with the executable bit set.                                                               |
| `INT-UNSCANNED-FILE`         | integrity        | medium                                                                                          | A text file not stored in full (symbolic link, over the size limit, fetch failed), so not fully scanned.     |
| `INT-MISSING-LICENSE`        | integrity        | low                                                                                             | Neither the skill nor its repository states a license.                                                       |
| `INT-BROAD-ALLOWED-TOOLS`    | integrity        | info                                                                                            | `allowed-tools` pre-approves unrestricted `Bash`.                                                            |
| `INT-CHANGED-SINCE-VERIFIED` | integrity        | info                                                                                            | A script, manifest or SKILL.md added or changed since the last verified version.                             |
| `INT-OWNER-CHANGED`          | integrity        | medium                                                                                          | The repository changed owner since the last verification. Stays until a maintainer accepts it.               |
| `DEP-KNOWN-VULNERABILITY`    | dependencies     | as published by the advisory (GHSA); medium when none                                           | A pinned dependency has a known vulnerability in OSV.dev.                                                    |
| `DEP-UNPINNED`               | dependencies     | info                                                                                            | Dependencies declared with ranges; ranges are not resolved or checked.                                       |
| `DEP-MANIFEST-UNPARSEABLE`   | dependencies     | low                                                                                             | A manifest that could not be parsed.                                                                         |
| `CRED-GITLEAKS-*`            | gitleaks         | medium                                                                                          | A possible secret reported by gitleaks, when it is installed. Optional, not a required check.                |

## Dependency check details

- Parsed: `package.json`, `package-lock.json` (v2/v3), `requirements.txt`, `pyproject.toml` (PEP 621 `dependencies` and `optional-dependencies`). Only exact versions are looked up.
- Other manifests (`go.mod`, `Cargo.toml`, `Gemfile`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `uv.lock`, `Pipfile`) are detected but not parsed yet. Their presence records the required dependency check as **skipped**, so the skill stays Unverified rather than passing unchecked.
- OSV.dev answers are cached in the worker process for 24 hours by package and version. If OSV cannot be reached, or `OSV_LOOKUPS=0`, the check is recorded as skipped.

## Adding or changing a rule

1. Add the rule next to the others in its scanner, with an id, severity, explanation and remediation.
2. Add a positive and a negative fixture in `packages/security/src/rules.test.ts`. The suite fails if a rule has no fixture.
3. Add the rule to this page. The suite fails if it is missing.
4. Bump `SCANNER_VERSION` in `packages/security/src/engine.ts`. Every skill is then reassessed, and existing verifications stand until their rescan completes.
5. Changes under `packages/security/` need review from a security maintainer.
