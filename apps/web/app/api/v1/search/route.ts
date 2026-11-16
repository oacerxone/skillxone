import { apiHandler, badRequest, parsePaging } from '@/lib/api';
import { serializePage } from '@/lib/api-serialize';
import { searchSkills } from '@/lib/search';
import { parseExploreParams, toSkillQuery } from '@/lib/search-params';

export const dynamic = 'force-dynamic';

/** GET /api/v1/search?q= — like /skills, but a query is required. */
export const GET = apiHandler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if (paging instanceof Response) return paging;
  const filters = parseExploreParams(Object.fromEntries(params));
  if (!filters.q) return badRequest('"q" is required.');
  const result = await searchSkills({
    ...toSkillQuery(filters, paging.perPage),
    page: paging.page,
  });
  return { query: filters.q, ...serializePage(result) };
});
