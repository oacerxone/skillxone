import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listRepositoriesToRecrawl,
  loadRankingFacts,
  saveRankingScores,
} from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import {
  codeSearchProvider,
  collectionProvider,
  parseRepoRef,
  repoSearchProvider,
  seedProvider,
} from '@skillxone/github';
import type { DiscoveryProvider, RepoCandidate } from '@skillxone/github';
import { DEFAULT_WEIGHTS, computeRanking } from '@skillxone/ranking';
import type { RankingWeights } from '@skillxone/ranking';
import { createSearchBackend } from '@skillxone/search';
import { createDefaultScanners, createOsvClient } from '@skillxone/security';
import type { Scanner } from '@skillxone/security';
import { findWorkspaceRoot } from '@skillxone/shared';
import { baseProcessors } from './runner';
import type { ProcessorRegistry } from './runner';
import { enqueueMissingScans, expireVerifications, scanVersion } from './scan';
import { syncRepository } from './sync';
import type { SyncDeps } from './sync';

export interface SeedFile {
  repositories: string[];
  collections: string[];
  searchQueries: string[];
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Reads `catalog/seeds.json`. A missing or malformed file yields empty lists, not a crash. */
export function loadSeedFile(root: string = findWorkspaceRoot()): SeedFile {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'catalog', 'seeds.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      repositories: stringList(parsed.repositories),
      collections: stringList(parsed.collections),
      searchQueries: stringList(parsed.searchQueries),
    };
  } catch {
    return { repositories: [], collections: [], searchQueries: [] };
  }
}

export const DISCOVERY_PROVIDERS = [
  'seed',
  'repo-search',
  'code-search',
  'collection',
  'recrawl',
] as const;
export type DiscoveryProviderId = (typeof DISCOVERY_PROVIDERS)[number];

export interface DiscoverResult {
  provider: string;
  candidates: number;
  enqueued: number;
  notes: string[];
}

/** Runs one discovery provider and queues a sync job per candidate repository. */
export async function runDiscovery(
  deps: SyncDeps,
  seeds: SeedFile,
  providerId: DiscoveryProviderId,
  options: { recrawlOlderThanMs?: number; recrawlLimit?: number } = {},
): Promise<DiscoverResult> {
  const notes: string[] = [];
  const candidates: RepoCandidate[] = [];

  if (providerId === 'recrawl') {
    // Previously indexed repositories, least recently checked first.
    const due = await listRepositoriesToRecrawl(deps.db, {
      olderThan: new Date(deps.now().getTime() - (options.recrawlOlderThanMs ?? 20 * 60 * 60_000)),
      limit: options.recrawlLimit ?? 500,
    });
    for (const repo of due)
      candidates.push({ owner: repo.owner, repo: repo.name, source: 'recrawl' });
  } else {
    const providers: Record<Exclude<DiscoveryProviderId, 'recrawl'>, DiscoveryProvider> = {
      seed: seedProvider(seeds.repositories),
      'repo-search': repoSearchProvider(deps.client, seeds.searchQueries),
      'code-search': codeSearchProvider(deps.client),
      collection: collectionProvider(deps.client, seeds.collections),
    };
    for await (const candidate of providers[providerId].discover({ notes }))
      candidates.push(candidate);
  }

  let enqueued = 0;
  for (const candidate of candidates) {
    const key = `sync:${candidate.owner}/${candidate.repo}`.toLowerCase();
    const result = await deps.queue.enqueue(
      'sync_repo',
      { owner: candidate.owner, repo: candidate.repo, source: candidate.source },
      { dedupeKey: key, schedule: `discover:${providerId}` },
    );
    if (result.created) enqueued += 1;
  }
  return { provider: providerId, candidates: candidates.length, enqueued, notes };
}

export interface RankSummary {
  skills: number;
  /** Most days of recorded history for any repository; trends need at least seven. */
  maxHistoryDays: number;
}

/** Recomputes every skill's quality and trend scores from current data. */
export async function runRanking(
  db: DatabaseHandle['db'],
  now: Date,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): Promise<RankSummary> {
  const facts = await loadRankingFacts(db, now);
  const scores = facts.map((fact) => {
    const result = computeRanking(fact, weights);
    return {
      skillId: fact.skillId,
      quality: result.quality,
      trending: result.trending,
      rising: result.rising,
      maintenance: result.maintenance,
      detail: { signals: result.signals, adjustments: result.adjustments },
      weightsVersion: result.weightsVersion,
      historyDays: fact.historyDays,
    };
  });
  await saveRankingScores(db, scores, now);
  return {
    skills: scores.length,
    maxHistoryDays: facts.reduce((max, fact) => Math.max(max, fact.historyDays), 0),
  };
}

export interface ScanSettings {
  scanners?: readonly Scanner[];
  timeoutMs?: number;
  verificationDays?: number;
}

export function createProcessors(
  deps: SyncDeps & { dialect?: DatabaseHandle['dialect']; scan?: ScanSettings },
  seeds: SeedFile = loadSeedFile(),
): ProcessorRegistry {
  const search = createSearchBackend({ db: deps.db, dialect: deps.dialect ?? 'sqlite' });
  const scanDeps = {
    db: deps.db,
    queue: deps.queue,
    now: deps.now,
    scanners: deps.scan?.scanners ?? createDefaultScanners({ osv: createOsvClient() }),
    timeoutMs: deps.scan?.timeoutMs,
    verificationDays: deps.scan?.verificationDays,
  };
  return {
    ...baseProcessors,

    /** Static security assessment of one skill version (never executes its files). */
    async scan_skill(payload) {
      const data = payload as { skillId?: unknown; versionId?: unknown; force?: unknown };
      if (typeof data.skillId !== 'string' || typeof data.versionId !== 'string') {
        throw new Error('scan_skill payload needs a skillId and a versionId');
      }
      return scanVersion(
        scanDeps,
        { skillId: data.skillId, versionId: data.versionId },
        { force: data.force === true },
      );
    },

    /** End verifications past their expiry and queue rescans. */
    expire_verifications: () => expireVerifications(scanDeps),

    /** Queue scans for current versions not yet assessed by this scanner and policy. */
    enqueue_scans: () => enqueueMissingScans(scanDeps),

    /** Recompute ranking scores for the whole catalog. */
    rank: () => runRanking(deps.db, deps.now()),

    /** Re-index one repository's skills for search after a sync. */
    async index_repo(payload) {
      const repositoryId = (payload as { repositoryId?: unknown }).repositoryId;
      if (typeof repositoryId !== 'string') {
        throw new Error('index_repo payload needs a repositoryId');
      }
      return { indexed: await search.indexRepository(repositoryId) };
    },

    /** Drop and rebuild the whole search index. Also the repair for a damaged index. */
    async reindex() {
      return { indexed: await search.rebuild() };
    },

    async sync_repo(payload, { job }) {
      const data = payload as { owner?: unknown; repo?: unknown; source?: unknown };
      // Payloads come from the database; validate them again before they reach a URL.
      const ref = parseRepoRef(`${String(data.owner)}/${String(data.repo)}`);
      if (!ref) throw new Error('sync_repo payload does not name a valid repository');
      const source = typeof data.source === 'string' ? data.source.slice(0, 40) : 'unknown';
      return syncRepository(deps, { ...ref, source }, job.id);
    },

    async discover(payload) {
      const provider = (payload as { provider?: unknown }).provider;
      if (!DISCOVERY_PROVIDERS.includes(provider as DiscoveryProviderId)) {
        throw new Error(`Unknown discovery provider: ${String(provider).slice(0, 40)}`);
      }
      return runDiscovery(deps, seeds, provider as DiscoveryProviderId);
    },
  };
}
