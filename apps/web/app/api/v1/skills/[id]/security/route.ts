import { apiHandler } from '@/lib/api';
import { serializeSecurity } from '@/lib/api-serialize';
import { loadSkillById } from '@/lib/api-skill';

export const dynamic = 'force-dynamic';

/** GET /api/v1/skills/:id/security — the public security report for the current version. */
export const GET = apiHandler(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const skill = await loadSkillById((await context.params).id);
    return skill instanceof Response ? skill : { data: serializeSecurity(skill) };
  },
);
