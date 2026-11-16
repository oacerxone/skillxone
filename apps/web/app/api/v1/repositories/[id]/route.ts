import { getRepositorySummary } from '@skillxone/database';
import { apiHandler, isValidId, notFound } from '@/lib/api';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/v1/repositories/:id */
export const GET = apiHandler(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    if (!isValidId(id)) return notFound('Repository');
    const { db } = await getDatabase();
    const repository = await getRepositorySummary(db, id);
    return repository ? { data: repository } : notFound('Repository');
  },
  { cacheSeconds: 300 },
);
