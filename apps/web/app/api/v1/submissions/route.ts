import { createSubmission, getSetting } from '@skillxone/database';
import { apiError } from '@/lib/api';
import { requestIpHash } from '@/lib/auth';
import { parseSubmissionBody, serializeSubmission } from '@/lib/community-api';
import { getDatabase } from '@/lib/db';
import { publicWrite } from '@/lib/write-route';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/submissions — suggest a GitHub repository for the catalog.
 * Body: { "repository": "owner/repo" | "https://github.com/owner/repo", "note"?: string }.
 * 201 with the new submission, or 200 with the existing one when it was already suggested.
 * A moderator reviews it before anything is indexed; nothing is fetched from GitHub here.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const checked = await publicWrite(request);
    if (!checked.ok) return checked.response;
    const parsed = parseSubmissionBody(checked.data);
    if (!parsed.ok) return apiError(400, 'INVALID_REQUEST', parsed.message);
    const { db } = await getDatabase();
    if ((await getSetting<boolean>(db, 'submissions_open')) === false) {
      return apiError(503, 'SUBMISSIONS_CLOSED', 'Submissions are closed at the moment.');
    }
    const result = await createSubmission(
      db,
      {
        ...parsed.value,
        submitterId: checked.session?.user.id ?? null,
        ipHash: await requestIpHash(request),
      },
      new Date(),
    );
    return Response.json(
      {
        data: serializeSubmission(result.submission),
        duplicate: !result.created,
        alreadyIndexed: result.alreadyIndexed,
      },
      { status: result.created ? 201 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Submission failed', error);
    return apiError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
  }
}
