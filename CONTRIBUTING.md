# Contributing

Thanks for helping. This project is early: check [docs/ROADMAP.md](docs/ROADMAP.md) for the current phase before starting anything large, and open an issue first for changes that touch architecture.

## Set up

Requirements: Node.js 22.12 or later and pnpm 10 (`corepack enable` provides it). No Docker, Redis or database server is needed.

```bash
git clone <your fork>
```

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` creates `.env` from `.env.example`, creates the SQLite database in `data/`, loads categories and development fixtures, and starts the site at http://localhost:3000. The fixtures are fake and the site says so in a banner.

## Before you open a pull request

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm build
```

All four run in CI and must pass.

## Pull requests

- Explain what changed and why. Link the issue if there is one.
- Include tests for behaviour changes.
- Update documentation that the change makes wrong.
- Keep the change focused; unrelated refactoring belongs in its own pull request.
- Changes to security rules, installation behaviour, authentication or workflows require review by a maintainer of that area.

## Where things go

See the layout table in [AGENTS.md](AGENTS.md) and the module boundaries in [docs/architecture/overview.md](docs/architecture/overview.md). Guides for adding an agent adapter, a security rule, a discovery provider or a ranking signal will be added with the packages they describe.

## Licensing of contributions

The project is licensed under Apache-2.0. By submitting a contribution you agree it is provided under that license (section 5 of the license). Do not submit code you do not have the right to contribute, and do not copy code or assets from other marketplaces.

## Reporting security problems

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
