import { listCategories } from '@skillxone/database';
import { apiHandler } from '@/lib/api';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/v1/categories */
export const GET = apiHandler(
  async () => {
    const { db } = await getDatabase();
    return { data: await listCategories(db) };
  },
  { cacheSeconds: 300 },
);
