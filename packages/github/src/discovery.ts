import type { GitHubClient } from './client';
import { GitHubError } from './client';
import { extractRepoLinks, parseRepoRef } from './refs';
import type { RepoRef } from './refs';

/**
 * Discovery providers find repositories that may contain skills. They only produce
 * candidates; whether a candidate really has a SKILL.md is decided when it is synced.
 * To add a source, implement `DiscoveryProvider` and register it in the worker.
 */

export interface RepoCandidate extends RepoRef {
  /** Provider id, stored as the repository's `discovery_source` when first indexed. */
  source: string;
}

export interface DiscoveryReport {
  /** Human-readable notes: skipped providers, partial results. Never silently dropped. */
  notes: string[];
}

export interface DiscoveryProvider {
  id: string;
  discover(report: DiscoveryReport): AsyncIterable<RepoCandidate>;
}

/** Curated list of repositories, e.g. `catalog/seeds.json`. Invalid entries are reported. */
export function seedProvider(entries: readonly string[]): DiscoveryProvider {
  return {
    id: 'seed',
    async *discover(report) {
      for (const entry of entries) {
        const ref = parseRepoRef(entry);
        if (ref) yield { ...ref, source: 'seed' };
        else report.notes.push(`Ignored invalid seed entry: ${JSON.stringify(entry).slice(0, 80)}`);
      }
    },
  };
}

/** Repository search by topic or keyword. Public, unarchived repositories only. */
export function repoSearchProvider(
  client: GitHubClient,
  queries: readonly string[],
  maxPagesPerQuery = 2,
): DiscoveryProvider {
  return {
    id: 'repo-search',
    async *discover(report) {
      for (const query of queries) {
        try {
          for await (const page of client.searchRepositories(
            `${query} archived:false`,
            maxPagesPerQuery,
          )) {
            for (const repo of page) {
              if (repo.private) continue;
              const ref = parseRepoRef(repo.full_name);
              if (ref) yield { ...ref, source: 'repo-search' };
            }
          }
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          report.notes.push(`Repository search "${query}" stopped early: ${error.code}`);
          if (error.code === 'RATE_LIMITED') return;
        }
      }
    },
  };
}

/**
 * Code search for SKILL.md files. GitHub caps each query at 1000 results and about 10
 * requests per minute, so results are partitioned by path and this provider cannot claim
 * complete coverage. Without a token it reports that it was skipped.
 */
export function codeSearchProvider(
  client: GitHubClient,
  queries: readonly string[] = [
    'filename:SKILL.md path:skills',
    'filename:SKILL.md path:.claude/skills',
    'filename:SKILL.md path:.agents/skills',
  ],
): DiscoveryProvider {
  return {
    id: 'code-search',
    async *discover(report) {
      if (!client.authenticated) {
        report.notes.push('Code search skipped: it requires a GitHub token.');
        return;
      }
      for (const query of queries) {
        try {
          for await (const page of client.searchCode(query)) {
            for (const hit of page) {
              const ref = parseRepoRef(hit.repository.full_name);
              if (ref) yield { ...ref, source: 'code-search' };
            }
          }
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          report.notes.push(`Code search "${query}" stopped early: ${error.code}`);
          if (error.code === 'RATE_LIMITED') return;
        }
      }
    },
  };
}

/** Repositories linked from the README of known collection ("awesome list") repositories. */
export function collectionProvider(
  client: GitHubClient,
  collections: readonly string[],
): DiscoveryProvider {
  return {
    id: 'collection',
    async *discover(report) {
      for (const entry of collections) {
        const ref = parseRepoRef(entry);
        if (!ref) {
          report.notes.push(
            `Ignored invalid collection entry: ${JSON.stringify(entry).slice(0, 80)}`,
          );
          continue;
        }
        try {
          const repo = (await client.getRepo(ref)).data;
          if (!repo) continue;
          const head = await client.getBranchHead(ref, repo.default_branch);
          const readme = await client.fetchRawFile(ref, head, 'README.md', 1_000_000);
          const text = new TextDecoder().decode(readme.content);
          for (const linked of extractRepoLinks(text)) {
            if (
              linked.owner.toLowerCase() === ref.owner.toLowerCase() &&
              linked.repo.toLowerCase() === ref.repo.toLowerCase()
            ) {
              continue;
            }
            yield { ...linked, source: 'collection' };
          }
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          report.notes.push(`Collection ${ref.owner}/${ref.repo} could not be read: ${error.code}`);
          if (error.code === 'RATE_LIMITED') return;
        }
      }
    },
  };
}
