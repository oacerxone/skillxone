import type { Metadata } from 'next';
import { metricsHistoryDays } from '@skillxone/database';
import { SkillListingPage } from '@/components/skill-listing-page';
import { getDatabase } from '@/lib/db';
import { MIN_TREND_HISTORY_DAYS as MIN_HISTORY_DAYS } from '@/lib/trending';

export const metadata: Metadata = { title: 'Trending skills' };

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { db } = await getDatabase();
  const days = await metricsHistoryDays(db);
  const enoughHistory = days >= MIN_HISTORY_DAYS;

  return (
    <SkillListingPage
      icon="flame"
      title={enoughHistory ? 'Trending skills' : 'Recently active skills'}
      intro="Trending is calculated from star growth this site has recorded itself. No history is estimated or back-filled."
      query={{ sort: enoughHistory ? 'trending' : 'updated' }}
      basePath="/trending"
      rawPage={(await searchParams).page}
      emptyTitle="No skills indexed yet"
    >
      {!enoughHistory && (
        <p
          role="note"
          className="mb-4 max-w-2xl rounded-sm bg-warning-bg px-3 py-2 text-[13px] text-warning-fg"
        >
          Not enough history yet: {days} of {MIN_HISTORY_DAYS} days recorded. Until then this list
          is ordered by the most recent content change.
        </p>
      )}
    </SkillListingPage>
  );
}
