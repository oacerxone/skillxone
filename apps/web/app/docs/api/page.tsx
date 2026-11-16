import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-parts';

export const metadata: Metadata = { title: 'REST API' };

const ENDPOINTS = [
  ['GET', '/api/health', 'Liveness and database check.', 'Available'],
  [
    'GET',
    '/api/v1/skills',
    'List skills: q, agent, verification, category, sort, page, per_page.',
    'Available',
  ],
  [
    'GET',
    '/api/v1/skills/:id',
    'One skill with files, compatibility and ranking signals.',
    'Available',
  ],
  ['GET', '/api/v1/skills/:id/versions', 'Indexed versions of a skill.', 'Available'],
  ['GET', '/api/v1/skills/:id/security', 'Security report for the current version.', 'Available'],
  [
    'GET',
    '/api/v1/skills/:id/install',
    'Install, update and uninstall instructions. Query: agent, scope (project|global), method (symlink|copy|manual), pin (true|false), shell (posix|powershell).',
    'Available',
  ],
  ['GET', '/api/v1/search', 'Ranked search; q is required.', 'Available'],
  ['GET', '/api/v1/suggest', 'Skill-name completions for a partial query.', 'Available'],
  ['GET', '/api/v1/categories', 'Categories with counts.', 'Available'],
  ['GET', '/api/v1/trending', 'Trending skills, with the basis used.', 'Available'],
  ['GET', '/api/v1/repositories/:id', 'One repository.', 'Available'],
  ['POST', '/api/v1/submissions', 'Suggest a GitHub repository (JSON body).', 'Available'],
  ['POST', '/api/v1/reports', 'Report a problem with a skill or finding (JSON body).', 'Available'],
  ['GET', '/api/v1/openapi.json', 'OpenAPI 3.1 description of this API.', 'Available'],
] as const;

export default function ApiDocsPage() {
  return (
    <>
      <PageHeader title="REST API">
        A versioned, read-only JSON API. No key is needed. Requests are rate limited (120 per minute
        by default) and report the limit in <code>X-RateLimit-*</code> headers. Errors use one
        shape: <code>{'{"error":{"code":"…","message":"…"}}'}</code>. Rows marked Planned do not
        exist yet.
      </PageHeader>
      <div
        className="panel max-w-4xl overflow-x-auto"
        role="region"
        aria-label="API endpoints"
        tabIndex={0}
      >
        <table className="w-full border-collapse text-left text-[13px] leading-5">
          <caption className="sr-only">API endpoints and their status</caption>
          <thead className="border-b border-border bg-bg-subtle text-[12px] text-text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Method
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Path
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Purpose
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map(([method, path, purpose, status]) => (
              <tr key={`${method} ${path}`} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 font-mono">{method}</td>
                <th scope="row" className="px-3 py-2 font-mono font-normal">
                  {path}
                </th>
                <td className="px-3 py-2 text-text-muted">{purpose}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-[12px] font-medium leading-4 ${
                      status === 'Available'
                        ? 'bg-verified-bg text-verified-fg'
                        : 'bg-unverified-bg text-unverified-fg'
                    }`}
                  >
                    {status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
