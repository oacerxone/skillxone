# Governance

skillxone is an open-source project run in the open. This page says who decides what and how.

## Roles

| Role                | Who                                                   | Can                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contributor         | Anyone who opens an issue, a pull request or a review | Propose any change                                                                                                                                                    |
| Maintainer          | Listed in [MAINTAINERS.md](MAINTAINERS.md)            | Review and merge pull requests, triage issues, cut releases                                                                                                           |
| Security maintainer | Maintainers marked as such in MAINTAINERS.md          | Everything a maintainer can, plus required review of `packages/security`, `packages/installer`, authentication and CI workflows; handle private vulnerability reports |
| Catalog moderator   | Operators of a deployment (not of this repository)    | Review submissions, reports and findings on their own site                                                                                                            |

Moderators of a self-hosted site are chosen by that site's operator (`ADMIN_GITHUB_IDS`, `MODERATOR_GITHUB_IDS`). They have no special standing in this repository.

## How decisions are made

- **Everyday changes** need one approving review from a maintainer other than the author, and green CI.
- **Changes that need a security maintainer's approval** (enforced through [CODEOWNERS](.github/CODEOWNERS)): security rules and the verification policy, install-command generation, authentication and sessions, GitHub Actions workflows.
- **Changes to the verification policy** ([docs/security/verification-policy.md](docs/security/verification-policy.md)) are proposed as a pull request that bumps the policy version, stay open for at least 7 days for comment, and need two maintainer approvals, one of them from a security maintainer.
- **Architecture changes** start as an issue or a new entry in [docs/architecture/decisions.md](docs/architecture/decisions.md).
- Maintainers seek consensus. If it cannot be reached, a simple majority of maintainers decides, and the reasoning is recorded in the pull request or issue.

## Becoming a maintainer

A contributor with a record of good reviews and merged work can be nominated by a maintainer. Existing maintainers approve by majority in a public issue. Maintainers who are inactive for six months are moved to an emeritus list and can return by asking.

## Conduct

Everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md). Maintainers enforce it.

## Changes to this document

Changes need approval from a majority of maintainers.
