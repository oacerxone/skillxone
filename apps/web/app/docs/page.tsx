import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-parts';
import { REPOSITORY_URL } from '@/lib/navigation';

export const metadata: Metadata = { title: 'Documentation' };

const DOCS = [
  [
    'docs/architecture/overview.md',
    'Architecture overview',
    'System shape, modules, ingestion, jobs and deployment modes.',
  ],
  [
    'docs/architecture/decisions.md',
    'Decision records',
    'Why SQLite, why no Redis, how ranking and licensing were decided.',
  ],
  ['docs/architecture/database-schema.md', 'Database schema', 'Every table, index and convention.'],
  [
    'docs/security/verification-policy.md',
    'Verification policy',
    'Scanners, severities, expiry and appeals.',
  ],
  [
    'docs/architecture/design-system.md',
    'Design system',
    'Tokens, components and accessibility targets.',
  ],
  ['docs/ROADMAP.md', 'Roadmap', 'Phases and the checks each must pass.'],
] as const;

export default function DocsPage() {
  return (
    <>
      <PageHeader title="Documentation" icon="book">
        Guides live in the repository so they are versioned with the code.
      </PageHeader>

      <ul className="grid max-w-3xl gap-3 sm:grid-cols-2">
        {DOCS.map(([path, title, summary]) => (
          <li key={path}>
            <a
              href={`${REPOSITORY_URL}/blob/main/${path}`}
              className="panel flex h-full flex-col gap-1 p-3 hover:bg-bg-subtle"
              rel="noopener noreferrer"
            >
              <span className="font-medium">{title}</span>
              <span className="text-[13px] leading-5 text-text-muted">{summary}</span>
            </a>
          </li>
        ))}
        <li>
          <Link
            href="/docs/api"
            className="panel flex h-full flex-col gap-1 p-3 hover:bg-bg-subtle"
          >
            <span className="font-medium">REST API</span>
            <span className="text-[13px] leading-5 text-text-muted">
              Planned public endpoints and what exists today.
            </span>
          </Link>
        </li>
      </ul>

      <div className="prose-skill mt-10">
        <h2 id="verification">Verification in brief</h2>
        <p>
          Each indexed version of a skill is identified by a commit and a content hash. Static
          scanners look for prompt injection, dangerous commands, credentials, data exfiltration,
          sensitive file access, vulnerable dependencies and integrity problems.
        </p>
        <ul>
          <li>Any open critical or high finding makes the version Flagged.</li>
          <li>
            Verified requires every required check to complete with no open medium finding, and it
            expires after 30 days.
          </li>
          <li>Everything else is Unverified, with the reason shown.</li>
        </ul>
        <p>
          When a skill&apos;s content changes, the new version starts Unverified. There is no
          numeric safety score. Static analysis has false positives and false negatives; a label is
          evidence, not a certificate.
        </p>
        <h2 id="ranking">Ranking in brief</h2>
        <p>
          Search relevance and quality are separate. Quality is a weighted mix of popularity
          (logarithmic, at most 18% of the score), recent star growth, maintenance, content
          freshness, documentation, metadata quality, security status and confirmed compatibility.
        </p>
        <ul>
          <li>
            A flagged skill&apos;s score is cut to a quarter and it never appears in Trending.
          </li>
          <li>
            Trend figures come only from star counts this site has recorded itself; nothing is
            estimated or back-filled.
          </li>
          <li>Each skill page lists the factors that count most for its position.</li>
        </ul>
      </div>
    </>
  );
}
