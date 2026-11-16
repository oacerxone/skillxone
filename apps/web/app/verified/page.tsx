import type { Metadata } from 'next';
import Link from 'next/link';
import { SkillListingPage } from '@/components/skill-listing-page';

export const metadata: Metadata = { title: 'Verified skills' };

export default async function VerifiedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <SkillListingPage
      title="Verified skills"
      intro={
        <>
          Skills whose current version passed every required check of the{' '}
          <Link href="/docs#verification" className="link">
            verification policy
          </Link>
          . Verified describes one exact version under a published policy. It is not a guarantee
          that a skill is safe.
        </>
      }
      query={{ verification: 'VERIFIED', sort: 'popular' }}
      basePath="/verified"
      rawPage={(await searchParams).page}
      emptyTitle="No verified skills yet"
    />
  );
}
