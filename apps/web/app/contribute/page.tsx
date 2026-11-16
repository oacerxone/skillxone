import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-parts';
import { REPOSITORY_URL } from '@/lib/navigation';

export const metadata: Metadata = { title: 'Contribute' };

export default function ContributePage() {
  return (
    <>
      <PageHeader title="Contribute">
        The marketplace is open source under Apache-2.0 and built to be extended.
      </PageHeader>
      <div className="prose-skill">
        <h2>Ways to help</h2>
        <ul>
          <li>
            <Link href="/submit">Submit a repository</Link> that contains skills.
          </li>
          <li>
            <Link href="/report">Report</Link> inaccurate information or a finding you believe is
            wrong.
          </li>
          <li>Improve the code: agent adapters, security rules, discovery, search, ranking.</li>
          <li>Run your own instance and tell us what was hard.</li>
        </ul>
        <h2>Run it locally</h2>
        <p>Node.js 22.12 or later and pnpm 10. No Docker, Redis or database server.</p>
        <pre>
          <code>{'pnpm install\npnpm dev'}</code>
        </pre>
        <h2>Before a pull request</h2>
        <pre>
          <code>{'pnpm lint\npnpm typecheck\npnpm test\npnpm build'}</code>
        </pre>
        <p>
          Read <a href={`${REPOSITORY_URL}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</a> for the
          full guide and <a href={`${REPOSITORY_URL}/blob/main/SECURITY.md`}>SECURITY.md</a> to
          report a vulnerability privately.
        </p>
      </div>
    </>
  );
}
