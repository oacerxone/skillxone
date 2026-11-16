# Installer

`packages/installer` turns a skill and a choice of agent, scope, method and shell into instructions a person can copy. It is pure: it builds text and never runs anything. The web app and `/api/v1/skills/:id/install` only display what it returns.

## What was checked, and when

Checked on 2026-11-16:

| Source                                                                                                           | What it settles                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| skills CLI 1.9.0, `docs/commands.md`                                                                             | `add`, `update` and `remove` syntax; `-g`, `-a`, `--skill`, `--copy`; quoting of names with spaces                                    |
| skills CLI 1.9.0, `docs/agents.md`                                                                               | Directories: Claude Code `.claude/skills/` and `~/.claude/skills/`; Codex `.agents/skills/` and `~/.agents/skills/`                   |
| skills CLI 1.9.0, `src/source-parser.ts`                                                                         | In `owner/repo@x`, a full commit SHA is a checkout pin, not a skill name                                                              |
| skills CLI 1.9.0, `src/sanitize.ts`                                                                              | How the installed folder is named (`cliFolderName` mirrors it)                                                                        |
| [Claude Code skills docs](https://code.claude.com/docs/en/skills)                                                | Same directories; names with control characters, `<`, `>` or surrounding spaces are refused; `/reload-skills` for a new skills folder |
| [Codex skills docs](https://learn.chatgpt.com/docs/build-skills) (moved from developers.openai.com/codex/skills) | Same directories; `name` and `description` are required; new skills are detected automatically                                        |

The CLI source was read, not run. Re-check these sources when `CLI_VERSION_CHECKED` changes.

## Safety rules

- Owner, repository and commit must match GitHub's own rules. They are rejected, never quoted.
- Skill names that pass validation are quoted for the chosen shell: POSIX single quotes, or PowerShell single quotes with doubled quotes, including typographic ones. Some names are refused outright: control or invisible characters, a leading dash (the CLI would read it as an option), surrounding spaces, or more than 128 characters.
- Tests run every quoted hostile name through `/bin/sh` and check that it comes back unchanged with nothing executed.
- When the current version is verified, the default install pins its commit, so the installed bytes match the assessment. The plan warns that `update` moves past the pin.

## Methods

| Method    | Instructions                                                                             |
| --------- | ---------------------------------------------------------------------------------------- |
| `symlink` | `npx skills add …` (the CLI's default, recommended by the CLI)                           |
| `copy`    | The same with `--copy`                                                                   |
| `manual`  | Steps: download the folder from GitHub at the pinned commit, copy it to the agent folder |

## Adding an agent

Add `src/agents/<agent>.ts` implementing `AgentAdapter` and list it in `src/agents/index.ts`. Nothing else names an agent. The extensibility test adds a dummy agent this way.

## Contract test

`packages/installer/src/contract.test.ts` runs the generated commands with the real CLI (`npx skills@1.9.0`) in a temporary project and home directory. It uses a local fixture skill as the source and checks that `SKILL.md` lands at the adapter's stated path, then that `remove` deletes it. It is opt-in because it downloads and runs the CLI:

```bash
SKILLS_CONTRACT=1 pnpm exec vitest run packages/installer/src/contract.test.ts
```

It needs Node.js 22.20 or later. CI runs it in the `installer-contract` job.
