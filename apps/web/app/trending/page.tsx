import type { Metadata } from 'next';
import { metricsHistoryDays } from '@skillxone/database';
import { SkillListingPage } from '@/components/skill-listing-page';
import { getDatabase } from '@/lib/db';

export const metadata: Metadata = { title: 'Trending skills' };

/** Days of recorded star history required before a trend can be computed (ADR-008). */
const MIN_HISTORY_DAYS = 7;

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
      title={enoughHistory ? 'Trending skills' : 'Recently active skills'}
      intro="Trending is calculated from star growth this site has recorded itself. No history is estimated or back-filled."
      query={{ sort: 'updated' }}
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
