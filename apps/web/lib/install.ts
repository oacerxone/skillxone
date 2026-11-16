/**
 * Web-side helpers over `@skillxone/installer`, which builds every command the site shows.
 * Nothing here is ever executed by the server.
 */
import { AGENTS } from '@skillxone/installer';

export type { InstallMethod, InstallPlan, InstallResult, InstallScope } from '@skillxone/installer';
export { buildInstallPlan } from '@skillxone/installer';

export const AGENT_IDS: readonly string[] = AGENTS.map((agent) => agent.id);

export const AGENT_INFO: Readonly<
  Record<string, { label: string; projectDir: string; globalDir: string }>
> = Object.fromEntries(
  AGENTS.map((agent) => [
    agent.id,
    { label: agent.label, projectDir: agent.projectDir, globalDir: agent.globalDir },
  ]),
);

export function isAgentId(value: string): boolean {
  return AGENT_IDS.includes(value);
}

export function agentLabel(id: string): string {
  return AGENT_INFO[id]?.label ?? id;
}
