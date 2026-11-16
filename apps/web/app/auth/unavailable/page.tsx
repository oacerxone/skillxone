import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Sign-in unavailable', robots: { index: false } };

const REASONS: Record<string, string> = {
  'not-configured':
    'This site has no GitHub sign-in configured. Browsing, search and installs work without an account.',
  state: 'The sign-in link expired or was opened in another browser. Start again.',
  github: 'GitHub did not complete the sign-in. Try again in a moment.',
  disabled: 'This account is disabled on this site.',
};

export default async function SignInUnavailable({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <div className="py-10">
      <h1 className="text-[24px] font-semibold leading-8">Sign-in did not complete</h1>
      <p className="mt-2 max-w-xl text-[15px] leading-6 text-text-muted">
        {REASONS[reason ?? ''] ?? REASONS['not-configured']}
      </p>
      <p className="mt-4 text-[15px]">
        <Link href="/" className="link">
          Back to the catalog
        </Link>
      </p>
    </div>
  );
}
