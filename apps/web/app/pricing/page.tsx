import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-parts';
import { billingEnabled, proPriceLabel, viewerAccess } from '@/lib/billing';
import { currentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'skillxone is free to search, with security reports for every skill. Pro adds advanced filters for finding the right skill faster.',
};

export const dynamic = 'force-dynamic';

const FREE = [
  'Search every indexed skill',
  'Categories, collections, trending and verified lists',
  'Full security report and verification status for every skill',
  'Pinned install commands',
  'The public JSON API and the skillxone skills',
];

const PRO = [
  'Filter by agent (Claude Code, Codex and more)',
  'Filter by repository stars and licence',
  'Instructions-only skills (no scripts)',
  'Recently updated: last 30, 90 or 365 days',
  'Rising and best-maintained sorts',
];

const MESSAGES: Record<string, string> = {
  error: 'Razorpay could not start the checkout. Nothing was charged; please try again.',
  expired: 'The form expired. Please try again.',
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const message = typeof params.billing === 'string' ? MESSAGES[params.billing] : undefined;
  const enabled = billingEnabled();
  const access = await viewerAccess();
  const session = enabled ? await currentSession() : null;

  return (
    <>
      <PageHeader title="Pricing" icon="sparkles">
        Searching skills and reading their security reports is free and stays free. Pro is for
        people who search often and want to narrow results quickly.
      </PageHeader>

      {message && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-border bg-bg-subtle p-3 text-[13px]"
        >
          {message}
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel p-6" aria-labelledby="plan-free">
          <h2 id="plan-free" className="text-[18px] font-semibold">
            Free
          </h2>
          <p className="mt-1 text-[28px] font-semibold tracking-tight">$0</p>
          <ul className="mt-4 space-y-2 text-[14px] text-text-muted">
            {FREE.map((item) => (
              <li key={item}>✓ {item}</li>
            ))}
          </ul>
          <Link href="/explore" className="btn mt-6">
            Start searching
          </Link>
        </section>

        <section className="panel border-accent p-6" aria-labelledby="plan-pro">
          <h2 id="plan-pro" className="text-[18px] font-semibold">
            Pro
          </h2>
          <p className="mt-1 text-[28px] font-semibold tracking-tight">{proPriceLabel()}</p>
          <p className="text-[13px] text-text-muted">Everything in Free, plus:</p>
          <ul className="mt-4 space-y-2 text-[14px] text-text-muted">
            {PRO.map((item) => (
              <li key={item}>✓ {item}</li>
            ))}
          </ul>
          <div className="mt-6">
            {!enabled ? (
              <p className="text-[13px] text-text-muted">
                Pro is not available yet. Until it is, every filter is free for everyone.
              </p>
            ) : access.pro ? (
              <Link href="/account" className="btn btn-primary">
                You have Pro — manage it
              </Link>
            ) : session ? (
              <form action="/billing/checkout" method="post">
                <input type="hidden" name="csrf" value={session.csrf} />
                <button type="submit" className="btn btn-primary">
                  Upgrade with Razorpay
                </button>
                <p className="mt-2 text-[12px] text-text-muted">
                  Payment happens on Razorpay’s secure page. Cancel any time from your account; you
                  keep Pro until the end of the period you paid for.
                </p>
              </form>
            ) : (
              <a href="/auth/github/login?next=/pricing" className="btn btn-primary">
                Sign in with GitHub to upgrade
              </a>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
