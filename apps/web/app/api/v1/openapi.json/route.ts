import { openApiDocument } from '@/lib/openapi';

export const dynamic = 'force-static';

/** GET /api/v1/openapi.json — the OpenAPI 3.1 description of this API. */
export function GET(): Response {
  return Response.json(openApiDocument, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
