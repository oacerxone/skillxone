import { assertDatabaseReady } from '@skillxone/database';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Liveness and database check for reverse proxies, Docker and uptime monitors.
 * The response deliberately carries no configuration, paths or error details.
 */
export async function GET(): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const { db } = await getDatabase();
    await assertDatabaseReady(db);
    return Response.json({ status: 'ok', database: 'ok' }, { headers });
  } catch {
    return Response.json({ status: 'error', database: 'unavailable' }, { status: 503, headers });
  }
}
