import { listSkills } from '@skillxone/database';
import type { SkillQuery } from '@skillxone/database';
import { getDatabase } from '@/lib/db';
import { PageHeader, Pagination } from './page-parts';
import { EmptyState, SkillList } from './skill-list';

const PAGE_SIZE = 30;

/** Shared layout for the fixed listings: Verified, Trending and a single category. */
export async function SkillListingPage({
  title,
  intro,
  query,
  basePath,
  rawPage,
  emptyTitle,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  query: SkillQuery;
  basePath: string;
  rawPage: string | string[] | undefined;
  emptyTitle: string;
  children?: React.ReactNode;
}) {
  const parsed = Number.parseInt((Array.isArray(rawPage) ? rawPage[0] : rawPage) ?? '1', 10);
  const page = Number.isInteger(parsed) && parsed >= 1 && parsed <= 100_000 ? parsed : 1;
  const { db } = await getDatabase();
  const result = await listSkills(db, { ...query, page, pageSize: PAGE_SIZE });

  return (
    <>
      <PageHeader title={title}>{intro}</PageHeader>
      {children}
      <p className="mb-3 text-[13px] text-text-muted">
        {result.total} skill{result.total === 1 ? '' : 's'}
      </p>
      {result.items.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <SkillList skills={result.items} />
      )}
      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        hrefFor={(p) => (p > 1 ? `${basePath}?page=${p}` : basePath)}
      />
    </>
  );
}
