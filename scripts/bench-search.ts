// Search benchmark on a generated catalog. Usage: pnpm bench:search [skills]
//
// Builds a throwaway SQLite database with synthetic repositories and skills, indexes and
// ranks them, then times the same code path the Explore page and the API use:
// full-text search, catalog filtering and hydration of one page of results.
// The data is synthetic and exists only for the duration of the run.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  listSkills,
  loadRankingFacts,
  migrateToLatest,
  openDatabase,
  saveRankingScores,
  seedCategories,
} from '../packages/database/src/index';
import { computeRanking } from '../packages/ranking/src/index';
import { createSearchBackend } from '../packages/search/src/index';

const TOTAL = Number(process.argv[2] ?? 20_000);
const SKILLS_PER_REPO = 10;
const WORDS = [
  'review',
  'deploy',
  'docker',
  'python',
  'testing',
  'security',
  'database',
  'frontend',
  'pipeline',
  'report',
  'design',
  'schema',
  'migration',
  'analytics',
  'writer',
  'planner',
  'checker',
  'builder',
  'kubernetes',
  'terraform',
  'markdown',
  'spreadsheet',
  'accessibility',
  'changelog',
  'commit',
  'refactor',
  'benchmark',
  'profile',
  'monitor',
  'incident',
  'release',
  'onboarding',
  'research',
  'summary',
  'translate',
  'invoice',
  'calendar',
  'notebook',
  'dataset',
  'prompt',
];
const CATEGORIES = [
  'development',
  'testing',
  'devops',
  'data',
  'documentation',
  'design',
  'security',
  'documents',
  'productivity',
  'research',
  'agents',
  'other',
];

// Small deterministic generator so every run builds the same catalog.
let seed = 42;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;

const dir = mkdtempSync(join(tmpdir(), 'skillxone-bench-'));
const file = join(dir, 'bench.db');
const handle = await openDatabase(`file:${file}`);
try {
  await migrateToLatest(handle.db);
  await seedCategories(handle.db);
  const now = new Date();
  const iso = now.toISOString();

  let started = performance.now();
  await handle.db.transaction().execute(async (trx) => {
    for (let r = 0; r < TOTAL / SKILLS_PER_REPO; r += 1) {
      const repoId = `repo_${r}`;
      await trx
        .insertInto('repositories')
        .values({
          id: repoId,
          github_id: r + 1,
          owner: `owner${r % 400}`,
          name: `${pick(WORDS)}-skills-${r}`,
          full_name_lower: `owner${r % 400}/skills-${r}`,
          stars: Math.floor(10 ** (random() * 5)),
          forks: Math.floor(random() * 300),
          pushed_at: new Date(now.getTime() - random() * 400 * 86_400_000).toISOString(),
          license_spdx: random() > 0.3 ? 'MIT' : null,
          discovery_source: 'benchmark',
          created_at: iso,
          updated_at: iso,
        })
        .execute();
      for (let k = 0; k < SKILLS_PER_REPO; k += 1) {
        const id = `skill_${r}_${k}`;
        const name = `${pick(WORDS)}-${pick(WORDS)}-${r}-${k}`;
        const description = `Helps with ${words(8)}.`;
        const body = `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\n${Array.from({ length: 12 }, () => `${words(18)}.`).join('\n\n')}\n\n\`\`\`bash\necho ${pick(WORDS)}\n\`\`\`\n`;
        await trx
          .insertInto('skills')
          .values({
            id,
            repository_id: repoId,
            path: `skills/${name}`,
            slug: `owner${r % 400}/skills-${r}/${name}`,
            name,
            description,
            current_version_id: `v_${id}`,
            verification_state: pick(['VERIFIED', 'UNVERIFIED', 'UNVERIFIED', 'FLAGGED'] as const),
            spec_valid: 1,
            license: 'MIT',
            first_indexed_at: iso,
            content_updated_at: iso,
            created_at: iso,
            updated_at: iso,
          })
          .execute();
        await trx
          .insertInto('skill_versions')
          .values({
            id: `v_${id}`,
            skill_id: id,
            commit_sha: 'a'.repeat(40),
            content_hash: id,
            name,
            indexed_at: iso,
          })
          .execute();
        await trx
          .insertInto('skill_files')
          .values({
            id: `f_${id}`,
            version_id: `v_${id}`,
            path: 'SKILL.md',
            blob_sha: id,
            size_bytes: body.length,
            kind: 'skill_md',
            content: body,
          })
          .execute();
        await trx
          .insertInto('skill_categories')
          .values({ skill_id: id, category_id: `cat_${pick(CATEGORIES)}`, source: 'auto' })
          .execute();
        await trx
          .insertInto('agent_compatibility')
          .values([
            { skill_id: id, agent_id: 'claude-code', level: 'inferred', updated_at: iso },
            {
              skill_id: id,
              agent_id: 'codex',
              level: random() > 0.2 ? 'inferred' : 'unsupported',
              updated_at: iso,
            },
          ])
          .execute();
      }
    }
  });
  const insertMs = performance.now() - started;

  started = performance.now();
  const facts = await loadRankingFacts(handle.db, now);
  await saveRankingScores(
    handle.db,
    facts.map((fact) => {
      const r = computeRanking(fact);
      return {
        skillId: fact.skillId,
        quality: r.quality,
        trending: r.trending,
        rising: r.rising,
        maintenance: r.maintenance,
        detail: { signals: r.signals, adjustments: r.adjustments },
        weightsVersion: r.weightsVersion,
        historyDays: fact.historyDays,
      };
    }),
    now,
  );
  const rankMs = performance.now() - started;

  const search = createSearchBackend(handle);
  started = performance.now();
  const indexed = await search.rebuild();
  const indexMs = performance.now() - started;

  const time = async (label: string, run: (i: number) => Promise<unknown>, iterations = 300) => {
    for (let i = 0; i < 20; i += 1) await run(i); // warm up
    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const t = performance.now();
      await run(i);
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    console.log(
      `${label.padEnd(46)} p50 ${percentile(samples, 50).toFixed(1).padStart(6)} ms   p95 ${percentile(samples, 95).toFixed(1).padStart(6)} ms   max ${samples[samples.length - 1]!.toFixed(1).padStart(6)} ms`,
    );
  };
  const searchPage = async (q: string, extra: Parameters<typeof listSkills>[1] = {}) => {
    const ids = await search.search(q);
    return listSkills(handle.db, { restrictToIds: ids, textMatched: true, pageSize: 30, ...extra });
  };

  console.log(
    `\nCatalog: ${indexed} skills in ${TOTAL / SKILLS_PER_REPO} repositories, database ${(statSync(file).size / 1e6).toFixed(0)} MB`,
  );
  console.log(
    `Machine: ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} cores, ${(totalmem() / 2 ** 30).toFixed(0)} GB RAM, Node ${process.version}`,
  );
  console.log(
    `Setup:   insert ${(insertMs / 1000).toFixed(1)} s, rank ${(rankMs / 1000).toFixed(1)} s, build index ${(indexMs / 1000).toFixed(1)} s\n`,
  );
  if (process.env.BENCH_PROFILE) {
    await time('  profile: index lookup only', (i) => search.search(WORDS[i % WORDS.length]!));
    const fixed = await search.search('review');
    await time('  profile: catalog filter + page only', () =>
      listSkills(handle.db, { restrictToIds: fixed, textMatched: true, pageSize: 30 }),
    );
  }
  await time('search, one common word (every skill matches)', (i) =>
    searchPage(WORDS[i % WORDS.length]!),
  );
  await time('search, two words', (i) =>
    searchPage(`${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]}`),
  );
  await time('search, prefix while typing', (i) =>
    searchPage(WORDS[i % WORDS.length]!.slice(0, 4)),
  );
  await time('search + filters (verified, category, agent)', (i) =>
    searchPage(WORDS[i % WORDS.length]!, {
      verification: 'VERIFIED',
      category: CATEGORIES[i % CATEGORIES.length],
      agent: 'codex',
    }),
  );
  await time('search, rare term (exact skill)', (i) =>
    searchPage(`${(i * 37) % (TOTAL / SKILLS_PER_REPO)} ${i % SKILLS_PER_REPO}`),
  );
  await time('browse, recommended order, page 1', () => listSkills(handle.db, { pageSize: 30 }));
  await time('browse, deep page (page 300)', () =>
    listSkills(handle.db, { pageSize: 30, page: 300 }),
  );
  await time('suggestions', (i) => search.suggest(WORDS[i % WORDS.length]!.slice(0, 3)));
} finally {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
}
