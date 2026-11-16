import { createReport } from '@skillxone/database';
import { apiError } from '@/lib/api';
import { requestIpHash } from '@/lib/auth';
import { parseReportBody, serializeReport } from '@/lib/community-api';
import { getDatabase } from '@/lib/db';
import { publicWrite } from '@/lib/write-route';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/reports — report a problem with a skill or a security finding.
 * Body: { "type", "skillId"?, "findingId"?, "body", "contact"? }. 201 with the new report, or
 * 200 with your earlier open report of the same kind.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const checked = await publicWrite(request);
    if (!checked.ok) return checked.response;
    const parsed = parseReportBody(checked.data);
    if (!parsed.ok) return apiError(400, 'INVALID_REQUEST', parsed.message);
    const { db } = await getDatabase();
    const result = await createReport(
      db,
      {
        ...parsed.value,
        reporterId: checked.session?.user.id ?? null,
        ipHash: await requestIpHash(request),
      },
      new Date(),
    );
    if ('error' in result) {
      return apiError(
        400,
        'INVALID_REQUEST',
        result.error === 'unknown_skill'
          ? 'No skill has that id.'
          : 'No finding with that id belongs to the skill.',
      );
    }
    return Response.json(
      { data: serializeReport(result.report), duplicate: !result.created },
      { status: result.created ? 201 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Report failed', error);
    return apiError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
  }
}
