## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## How it was tested

<!-- Commands you ran and what they showed. Include new tests for behaviour changes. -->

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass locally
- [ ] Browser-facing changes: `pnpm test:e2e` passes, including the accessibility checks
- [ ] Documentation the change makes wrong is updated

## Needs a security maintainer?

- [ ] This touches `packages/security`, `packages/installer`, authentication, sessions or CSRF, or `.github/workflows` (see GOVERNANCE.md)

## Data honesty

- [ ] No invented statistics, security results or history; fixtures stay in `packages/database/src/seed/dev-fixtures.ts`
