import { apiError, apiHandler } from '@/lib/api';
import { loadSkillById } from '@/lib/api-skill';
import { AGENT_IDS, buildInstallPlan } from '@/lib/install';
import type { InstallMethod, InstallScope } from '@/lib/install';

export const dynamic = 'force-dynamic';

const SCOPES: readonly InstallScope[] = ['project', 'global'];
const METHODS: readonly InstallMethod[] = ['symlink', 'copy', 'manual'];

/**
 * GET /api/v1/skills/:id/install?agent=claude-code&scope=project&method=symlink&pin=true&shell=posix
 *
 * Returns the install, update and uninstall instructions the skill page shows. The server
 * only builds text; it never runs a command. `pin=true` (the default) pins to the verified
 * commit and is ignored when the current version is not verified.
 */
export const GET = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const skill = await loadSkillById((await context.params).id);
    if (skill instanceof Response) return skill;

    const params = new URL(request.url).searchParams;
    const agent =
      params.get('agent') ?? skill.agents.find((id) => AGENT_IDS.includes(id)) ?? AGENT_IDS[0]!;
    const scope = (params.get('scope') ?? 'project') as InstallScope;
    const method = (params.get('method') ?? 'symlink') as InstallMethod;
    const shell = params.get('shell') ?? 'posix';
    const pin = params.get('pin') ?? 'true';
    if (!AGENT_IDS.includes(agent))
      return apiError(400, 'INVALID_REQUEST', `agent must be one of: ${AGENT_IDS.join(', ')}.`);
    if (!SCOPES.includes(scope))
      return apiError(400, 'INVALID_REQUEST', 'scope must be project or global.');
    if (!METHODS.includes(method))
      return apiError(400, 'INVALID_REQUEST', 'method must be symlink, copy or manual.');
    if (shell !== 'posix' && shell !== 'powershell')
      return apiError(400, 'INVALID_REQUEST', 'shell must be posix or powershell.');
    if (pin !== 'true' && pin !== 'false')
      return apiError(400, 'INVALID_REQUEST', 'pin must be true or false.');

    const verifiedCommit =
      skill.verificationState === 'VERIFIED' ? skill.currentVersion?.commitSha : undefined;
    const plan = buildInstallPlan({
      owner: skill.owner,
      repo: skill.repo,
      skillPath: skill.path,
      skill: {
        name: skill.name,
        hasDescription: skill.description.trim().length > 0,
        specValid: skill.specValid,
      },
      agent,
      scope,
      method,
      shell,
      commitSha: pin === 'true' ? verifiedCommit : undefined,
    });
    return {
      data: {
        skillId: skill.id,
        verification: skill.verificationState,
        supportedAgents: skill.agents.filter((id) => AGENT_IDS.includes(id)),
        isFixture: skill.repository.isFixture,
        ...(plan.ok ? { plan } : { plan: null, refused: plan.reason }),
      },
    };
  },
);
