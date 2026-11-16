import { apiHandler } from '@/lib/api';
import { getSearch } from '@/lib/search';

export const dynamic = 'force-dynamic';

/** GET /api/v1/suggest?q= — up to eight skill-name completions. */
export const GET = apiHandler(
  async (request: Request) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 100);
    if (q.trim().length < 2) return { data: [] };
    const suggestions = await (await getSearch()).suggest(q, 8);
    return {
      data: suggestions.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description.slice(0, 160),
      })),
    };
  },
  { cacheSeconds: 30 },
);
