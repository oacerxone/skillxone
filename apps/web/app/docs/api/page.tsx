import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-parts';

export const metadata: Metadata = { title: 'REST API' };

const ENDPOINTS = [
  ['GET', '/api/health', 'Liveness and database check.', 'Available'],
  ['GET', '/api/v1/skills', 'List skills with filters and pagination.', 'Planned'],
  ['GET', '/api/v1/skills/:id', 'One skill.', 'Planned'],
  ['GET', '/api/v1/skills/:id/versions', 'Indexed versions of a skill.', 'Planned'],
  ['GET', '/api/v1/skills/:id/security', 'Security report for the current version.', 'Planned'],
  ['GET', '/api/v1/skills/:id/install', 'Install commands per agent.', 'Planned'],
  ['GET', '/api/v1/search', 'Ranked search.', 'Planned'],
  ['GET', '/api/v1/categories', 'Categories with counts.', 'Planned'],
  ['GET', '/api/v1/trending', 'Trending skills.', 'Planned'],
  ['GET', '/api/v1/repositories/:id', 'One repository.', 'Planned'],
  ['POST', '/api/v1/submissions', 'Suggest a repository.', 'Planned'],
  ['POST', '/api/v1/reports', 'Report a problem.', 'Planned'],
] as const;

export default function ApiDocsPage() {
  return (
    <>
      <PageHeader title="REST API">
        A versioned public API is planned. Only the health endpoint exists today; the rest of this
        table is the intended surface, not working functionality.
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
