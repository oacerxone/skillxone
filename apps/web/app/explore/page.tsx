import type { Metadata } from 'next';
import Link from 'next/link';
import { searchTerms } from '@skillxone/database';
import { ExploreFilters } from '@/components/explore-filters';
import { PageHeader, Pagination } from '@/components/page-parts';
import { EmptyState, SkillCards, SkillList } from '@/components/skill-list';
import { viewerAccess } from '@/lib/billing';
import {
  cachedAgentIds,
  cachedCategories,
  cachedLicenses,
  cachedSearch,
} from '@/lib/catalog-cache';
import {
  buildExploreQuery,
  parseExploreParams,
  stripProFilters,
  toSkillQuery,
  usesProFilters,
} from '@/lib/search-params';

export const metadata: Metadata = { title: 'Explore skills' };

const PAGE_SIZE = 30;

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = parseExploreParams(await searchParams);
  const access = await viewerAccess();
  // Pro filters are removed before the query (and its cache), never after.
  const filters = access.locked ? stripProFilters(requested) : requested;
  const proRequested = access.locked && usesProFilters(requested);
  const [result, agents, categories, licenses] = await Promise.all([
    cachedSearch(toSkillQuery(filters, PAGE_SIZE)),
    cachedAgentIds(),
    cachedCategories(),
    cachedLicenses(),
  ]);
  const terms = searchTerms(filters.q);
  const now = new Date();
  const hasFilters = Boolean(
    filters.q ||
    filters.agent ||
    filters.verification ||
    filters.category ||
    filters.minStars ||
    filters.license ||
    filters.noScripts ||
    filters.updatedDays,
  );
  const firstShown = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastShown = firstShown + result.items.length - (result.total === 0 ? 0 : 1);

  return (
    <>
      <PageHeader title="Explore skills" icon="compass">
        Search every indexed skill by name, description, repository or instructions, then narrow the
        results.
      </PageHeader>

      <ExploreFilters
        filters={filters}
        agents={agents}
        categories={categories.map(({ slug, name }) => ({ slug, name }))}
        licenses={licenses}
        locked={access.locked}
      />

      {proRequested && (
        <p
          role="note"
          className="mt-4 rounded-lg border border-border bg-bg-subtle p-3 text-[13px] text-text"
        >
          Advanced filters were not applied: they are part of{' '}
          <Link href="/pricing" className="link">
            skillxone Pro
          </Link>
          {access.signedIn ? '' : ' (sign in, then upgrade)'}. These results use your search,
          category and verification filters only.
        </p>
      )}

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-[13px] text-text-muted">
          {result.total === 0
            ? 'No skills match'
            : `Showing ${firstShown}–${lastShown} of ${result.total} skill${result.total === 1 ? '' : 's'}`}
          {filters.q && (
            <>
              {' '}
              for <span className="font-medium text-text">“{filters.q}”</span>
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <Link href="/explore" className="link text-[13px]">
              Clear filters
            </Link>
          )}
          <nav aria-label="Layout" className="flex gap-1">
            <Link
              href={`/explore${buildExploreQuery(filters, { view: 'list' })}`}
              className="chip"
              aria-current={filters.view === 'list' ? 'true' : undefined}
            >
              List
            </Link>
            <Link
              href={`/explore${buildExploreQuery(filters, { view: 'cards' })}`}
              className="chip"
              aria-current={filters.view === 'cards' ? 'true' : undefined}
            >
              Cards
            </Link>
          </nav>
        </div>
      </div>

      {result.items.length === 0 ? (
        <EmptyState title="No skills match these filters">
          Try a shorter search or{' '}
          <Link href="/explore" className="link">
            clear the filters
          </Link>
          .
        </EmptyState>
      ) : filters.view === 'cards' ? (
        <SkillCards skills={result.items} terms={terms} now={now} />
      ) : (
        <SkillList skills={result.items} terms={terms} now={now} />
      )}

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        hrefFor={(page) => `/explore${buildExploreQuery(filters, { page })}`}
      />
    </>
  );
}
