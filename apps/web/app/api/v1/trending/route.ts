import { listSkills, metricsHistoryDays } from '@skillxone/database';
import { apiHandler, parsePaging } from '@/lib/api';
import { serializePage } from '@/lib/api-serialize';
import { getDatabase } from '@/lib/db';
import { MIN_TREND_HISTORY_DAYS } from '@/lib/trending';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/trending
 * Trend order needs recorded star history. Until enough exists the response says so in
 * `basis` and is ordered by latest content change instead; nothing is estimated.
 */
export const GET = apiHandler(async (request: Request) => {
  const paging = parsePaging(new URL(request.url).searchParams);
  if (paging instanceof Response) return paging;
  const { db } = await getDatabase();
  const historyDays = await metricsHistoryDays(db);
  const enough = historyDays >= MIN_TREND_HISTORY_DAYS;
  const result = await listSkills(db, {
    sort: enough ? 'trending' : 'updated',
    page: paging.page,
    pageSize: paging.perPage,
  });
  return {
    basis: enough ? 'star_growth_7d' : 'recent_activity',
    historyDays,
    requiredHistoryDays: MIN_TREND_HISTORY_DAYS,
    ...serializePage(result),
  };
});
