# Security policy

## Reporting a vulnerability in this software

Please report privately. Do not open a public issue or pull request for a suspected vulnerability.

Use GitHub's **Report a vulnerability** button under the repository's Security tab (private vulnerability reporting). <!-- TODO(maintainers): enable private vulnerability reporting when the repository is published, and add a fallback contact address here. -->

Include what you found, how to reproduce it, the affected version or commit, and the impact you expect. We aim to acknowledge reports within 3 working days and to give a first assessment within 10. We will credit you in the release notes unless you prefer otherwise. Please give us a reasonable period to release a fix before disclosing publicly.

## Reporting a problem with an indexed skill

A skill that looks malicious, or a security finding you believe is a false positive, is not a vulnerability in this software. Use the report action on the skill's page or the corresponding issue template. The process is described in [docs/security/verification-policy.md](docs/security/verification-policy.md).

## Supported versions

The project has not made a release yet. Until the first tagged release, only the `main` branch is supported.

## Scope notes for self-hosters

- Keep `.env` out of version control and readable only by the service user.
- The GitHub token needs read access to public repositories only.
- A "Verified" label reflects static analysis of one exact version under a published policy. It is not a guarantee that a skill is safe.
