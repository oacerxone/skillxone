import type { Kysely } from 'kysely';
import type { Database } from '../types';

/**
 * The starting category taxonomy. This is real reference data, not a fixture: it is
 * loaded in every environment and can be edited later from the admin dashboard.
 * Ids are fixed strings so the seed is idempotent.
 */
export const DEFAULT_CATEGORIES = [
  ['development', 'Development', 'Writing, refactoring and reviewing code.'],
  ['testing', 'Testing & QA', 'Test generation, debugging and quality checks.'],
  ['devops', 'DevOps & Infrastructure', 'CI/CD, containers, cloud and deployment.'],
  ['data', 'Data & Analytics', 'Databases, data pipelines, analysis and visualisation.'],
  ['documentation', 'Documentation', 'Technical writing, READMEs and API references.'],
  ['design', 'Design & Frontend', 'UI, design systems, accessibility and assets.'],
  ['security', 'Security', 'Audits, threat modelling and secure coding.'],
  ['documents', 'Documents & Office', 'PDF, spreadsheets, slides and word processing.'],
  ['productivity', 'Productivity', 'Planning, project management and workflow automation.'],
  ['research', 'Research', 'Search, summarisation and literature review.'],
  ['agents', 'Agent Tooling', 'Skills that build, configure or extend agents and other skills.'],
  ['other', 'Other', 'Skills that do not fit another category.'],
] as const;

export async function seedCategories(db: Kysely<Database>): Promise<number> {
  let inserted = 0;
  for (const [index, [slug, name, description]] of DEFAULT_CATEGORIES.entries()) {
    const result = await db
      .insertInto('categories')
      .values({ id: `cat_${slug}`, slug, name, description, sort_order: index })
      .onConflict((oc) => oc.column('slug').doNothing())
      .executeTakeFirst();
    inserted += Number(result.numInsertedOrUpdatedRows ?? 0);
  }
  return inserted;
}
