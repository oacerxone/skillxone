import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-parts';
import { REPOSITORY_URL } from '@/lib/navigation';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  return (
    <>
      <PageHeader title="About">
        An open-source, self-hostable index of AI agent skills hosted on GitHub.
      </PageHeader>
      <div className="prose-skill">
        <h2>What this is</h2>
        <p>
          Skills are folders with a <code>SKILL.md</code> file that teach a coding agent how to do a
          task. This site finds them in public GitHub repositories, shows what each one contains,
          and publishes a security assessment for the exact version it indexed.
        </p>
        <h2>How to read the labels</h2>
        <ul>
          <li>
            <strong>Verified</strong>: this exact version passed every required check of the
            published policy. It is not a guarantee of safety.
          </li>
          <li>
            <strong>Unverified</strong>: no completed assessment exists for the current version. It
            does not mean anything is wrong.
          </li>
          <li>
            <strong>Flagged</strong>: the current version has specific, documented findings that you
            can read and that the author can appeal.
          </li>
        </ul>
        <h2>What it is not</h2>
        <p>
          It is not a registry: skills stay in their authors&apos; repositories under their own
          licenses. It does not run skills, and it never executes install commands for you.
        </p>
        <h2>Project status</h2>
        <p>
          The project is in early development. Ingestion from GitHub, ranked search and the security
          scanner are not built yet; this build shows development fixtures. See the{' '}
          <a href={`${REPOSITORY_URL}/blob/main/docs/ROADMAP.md`}>roadmap</a> or{' '}
          <Link href="/contribute">how to contribute</Link>.
        </p>
      </div>
    </>
  );
}
