import { apiHandler, parsePaging } from '@/lib/api';
import { serializePage } from '@/lib/api-serialize';
import { searchSkills } from '@/lib/search';
import { parseExploreParams, toSkillQuery } from '@/lib/search-params';

export const dynamic = 'force-dynamic';

/** GET /api/v1/skills?q=&agent=&verification=&category=&sort=&page=&per_page= */
export const GET = apiHandler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if (paging instanceof Response) return paging;
  // The same validation as the Explore page: unknown filter values are ignored.
  const filters = parseExploreParams(Object.fromEntries(params));
  const result = await searchSkills({
    ...toSkillQuery(filters, paging.perPage),
    page: paging.page,
  });
  return serializePage(result);
});
