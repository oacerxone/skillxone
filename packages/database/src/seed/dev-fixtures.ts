import type { Kysely } from 'kysely';
import { DEV_FIXTURE_SOURCE, systemClock, toIso } from '@skillxone/shared';
import type { Clock } from '@skillxone/shared';
import type { Database } from '../types';

/**
 * DEVELOPMENT-ONLY FIXTURES.
 *
 * These repositories and skills do not exist on GitHub. They let the UI be built before
 * ingestion exists (Phase 3). Every row is marked `discovery_source = 'dev-fixture'`,
 * uses a negative `github_id` (real ids are positive) and lives under the reserved-looking
 * owner `example-fixture`. Star counts and dates are invented and must never be presented
 * as real: the web app shows a banner whenever `hasDevFixtures()` is true.
 */

interface FixtureSkill {
  name: string;
  description: string;
  category: string;
  state: 'VERIFIED' | 'UNVERIFIED' | 'FLAGGED';
}

interface FixtureRepo {
  name: string;
  description: string;
  stars: number;
  license: string | null;
  skills: FixtureSkill[];
}

const OWNER = 'example-fixture';

const FIXTURES: FixtureRepo[] = [
  {
    name: 'starter-skills',
    description: 'Fixture repository with several skills in one tree.',
    stars: 1240,
    license: 'MIT',
    skills: [
      {
        name: 'commit-message-writer',
        description: 'Fixture skill: drafts conventional commit messages from a staged diff.',
        category: 'development',
        state: 'VERIFIED',
      },
      {
        name: 'unit-test-planner',
        description: 'Fixture skill: proposes test cases for a changed module before writing them.',
        category: 'testing',
        state: 'VERIFIED',
      },
      {
        name: 'changelog-updater',
        description: 'Fixture skill: keeps CHANGELOG.md in step with merged pull requests.',
        category: 'documentation',
        state: 'UNVERIFIED',
      },
    ],
  },
  {
    name: 'ops-skills',
    description: 'Fixture repository for infrastructure-related skills.',
    stars: 312,
    license: 'Apache-2.0',
    skills: [
      {
        name: 'dockerfile-reviewer',
        description: 'Fixture skill: reviews a Dockerfile for size and caching problems.',
        category: 'devops',
        state: 'UNVERIFIED',
      },
      {
        name: 'remote-setup-helper',
        description: 'Fixture skill: flagged example used to exercise the security report layout.',
        category: 'devops',
        state: 'FLAGGED',
      },
    ],
  },
  {
    name: 'single-skill',
    description: 'Fixture repository with one skill at the repository root and no license.',
    stars: 18,
    license: null,
    skills: [
      {
        name: 'spreadsheet-cleaner',
        description: 'Fixture skill: normalises headers and types in CSV and XLSX files.',
        category: 'documents',
        state: 'UNVERIFIED',
      },
    ],
  },
];

export interface FixtureSummary {
  repositories: number;
  skills: number;
}

/** Inserts the fixtures. Idempotent: existing fixture rows are left untouched. */
export async function seedDevFixtures(
  db: Kysely<Database>,
  clock: Clock = systemClock,
): Promise<FixtureSummary> {
  const now = toIso(clock());
  const summary: FixtureSummary = { repositories: 0, skills: 0 };

  await db.transaction().execute(async (trx) => {
    for (const [repoIndex, repo] of FIXTURES.entries()) {
      const repositoryId = `fixture_repo_${repo.name}`;
      const repoResult = await trx
        .insertInto('repositories')
        .values({
          id: repositoryId,
          github_id: -(repoIndex + 1),
          owner: OWNER,
          name: repo.name,
          full_name_lower: `${OWNER}/${repo.name}`,
          owner_type: 'Organization',
          description: repo.description,
          default_branch: 'main',
          license_spdx: repo.license,
          stars: repo.stars,
          discovery_source: DEV_FIXTURE_SOURCE,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .executeTakeFirst();
      summary.repositories += Number(repoResult.numInsertedOrUpdatedRows ?? 0);

      const rootOnly = repo.skills.length === 1;
      for (const skill of repo.skills) {
        const skillId = `fixture_skill_${repo.name}_${skill.name}`;
        const skillResult = await trx
          .insertInto('skills')
          .values({
            id: skillId,
            repository_id: repositoryId,
            path: rootOnly ? '' : `skills/${skill.name}`,
            slug: `${OWNER}/${repo.name}/${skill.name}`,
            name: skill.name,
            description: skill.description,
            license: repo.license,
            verification_state: skill.state,
            lifecycle_state: skill.state === 'UNVERIFIED' ? 'PENDING' : 'COMPLETE',
            spec_valid: 1,
            first_indexed_at: now,
            content_updated_at: now,
            created_at: now,
            updated_at: now,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .executeTakeFirst();
        summary.skills += Number(skillResult.numInsertedOrUpdatedRows ?? 0);

        await trx
          .insertInto('skill_categories')
          .values({ skill_id: skillId, category_id: `cat_${skill.category}`, source: 'curated' })
          .onConflict((oc) => oc.columns(['skill_id', 'category_id']).doNothing())
          .execute();
      }
    }
  });

  return summary;
}

/** True when any development fixture row is present. */
export async function hasDevFixtures(db: Kysely<Database>): Promise<boolean> {
  const row = await db
    .selectFrom('repositories')
    .select('id')
    .where('discovery_source', '=', DEV_FIXTURE_SOURCE)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** Removes every fixture row (skills and links are removed by cascade). */
export async function removeDevFixtures(db: Kysely<Database>): Promise<number> {
  const result = await db
    .deleteFrom('repositories')
    .where('discovery_source', '=', DEV_FIXTURE_SOURCE)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
