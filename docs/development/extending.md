# Extending skillxone

Short guides for the four common extensions. Each one names the only places you need to touch; if you find yourself editing elsewhere, the boundary is probably wrong, so open an issue first.

## Add an agent

1. Read the agent's own skill documentation and the skills CLI's agent table, and note the project and user directories.
2. Add `packages/installer/src/agents/<agent>.ts` implementing `AgentAdapter`: id (the skills CLI's `-a` value), label, directories, the docs URL you checked, the "after installing" note, and a `compatibility()` check.
3. List it in `packages/installer/src/agents/index.ts`.
4. Run the tests: the snapshot suite covers the new agent automatically (review the new snapshots), and the contract test runs it against the real CLI in CI.
5. If the parser should infer compatibility for it, extend `inferAgentCompatibility` in `packages/skill-parser`.

## Add a security rule

Changes here need a security maintainer's review.

1. Add the rule next to similar ones in `packages/security/src/scanners/`, with an id, severity, explanation and remediation. Write the pattern in linear time: bounded gaps (`[^\n]{0,N}`), no nested quantifiers.
2. Decide which contexts lower it (`softenWhen`). Lower, never drop: the evidence stays in the report.
3. Add a positive and a negative fixture in `packages/security/src/rules.test.ts`.
4. Add the rule to `docs/security/rules.md`. A test fails if you forget.
5. Bump `SCANNER_VERSION` in `packages/security/src/engine.ts`, so the catalog is reassessed.
6. If you can, scan a real catalog (`pnpm worker scan --queue && pnpm worker drain`) and read what the rule finds.

## Add a discovery provider

1. Implement `DiscoveryProvider` in `packages/github/src/discovery.ts`. It yields `{ owner, repo, source }` candidates and never fetches repository content itself. Validate every owner and repo with `parseRepoRef`.
2. Add its id to `DISCOVERY_PROVIDERS` in `apps/worker/src/processors.ts` and wire it in `runDiscovery`.
3. To run it on a schedule, add it to a schedule in `apps/worker/src/schedules.ts`.
4. Test it with the fake GitHub in `apps/worker/src/test-support.ts`. Count API calls, because rate limits are the real constraint.

## Add a ranking signal

1. Add a `Signal` to `SIGNALS` in `packages/ranking/src/index.ts`: a value from 0 to 1 and a plain-language explanation that never claims more than the data shows.
2. Give it a weight in `DEFAULT_WEIGHTS`, keeping the sum at 1, and bump `WEIGHTS_VERSION`.
3. If it needs new facts, load them in `packages/database/src/ranking-data.ts`, from recorded data only.
4. Add tests in `packages/ranking/src/ranking.test.ts`, and update `docs/development/search-and-ranking.md`.
