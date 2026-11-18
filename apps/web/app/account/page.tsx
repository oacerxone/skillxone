import type { Metadata } from 'next';
import Link from 'next/link';
import { latestSubscription, grantsPro } from '@skillxone/database';
import { PageHeader } from '@/components/page-parts';
import { currentSession } from '@/lib/auth';
import { billingEnabled, proPriceLabel } from '@/lib/billing';
import { getDatabase } from '@/lib/db';

export const metadata: Metadata = { title: 'Your account', robots: { index: false } };
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  cancelled:
    'Your subscription is cancelled. You keep Pro until the end of the period you paid for.',
  error: 'Razorpay could not complete that request. Please try again later.',
  expired: 'The form expired. Please try again.',
};

const STATUS_TEXT: Record<string, string> = {
  created: 'Waiting for payment',
  authenticated: 'Payment authorised',
  active: 'Active',
  pending: 'Payment retrying',
  halted: 'Stopped after failed payments',
  cancelled: 'Cancelled',
  completed: 'Ended',
  expired: 'Expired',
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const message = typeof params.billing === 'string' ? MESSAGES[params.billing] : undefined;
  const session = await currentSession();
  if (!session) {
    return (
      <>
        <PageHeader title="Your account" icon="info" />
        <p className="text-[14px]">
          <a href="/auth/github/login?next=/account" className="link">
            Sign in with GitHub
          </a>{' '}
          to see your account.
        </p>
      </>
    );
  }
  const { db } = await getDatabase();
  const subscription = billingEnabled() ? await latestSubscription(db, session.user.id) : undefined;
  const pro = subscription ? grantsPro(subscription.status) : false;

  return (
    <>
      <PageHeader title="Your account" icon="info">
        Signed in as <span className="font-medium text-text">{session.user.login}</span>.
      </PageHeader>
      {message && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-border bg-bg-subtle p-3 text-[13px]"
        >
          {message}
        </p>
      )}
      <section className="panel max-w-xl p-6" aria-labelledby="account-plan">
        <h2 id="account-plan" className="text-[16px] font-semibold">
          Plan: {pro ? 'Pro' : 'Free'}
        </h2>
        {subscription ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
            <dt className="text-text-muted">Subscription</dt>
            <dd>{STATUS_TEXT[subscription.status] ?? subscription.status}</dd>
            {subscription.current_end && (
              <>
                <dt className="text-text-muted">Paid until</dt>
                <dd>{subscription.current_end.slice(0, 10)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="mt-2 text-[14px] text-text-muted">No subscription.</p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {pro ? (
            <form action="/billing/cancel" method="post">
              <input type="hidden" name="csrf" value={session.csrf} />
              <button type="submit" className="btn">
                Cancel at the end of the period
              </button>
            </form>
          ) : billingEnabled() ? (
            <Link href="/pricing" className="btn btn-primary">
              Upgrade to Pro — {proPriceLabel()}
            </Link>
          ) : null}
          <form action="/auth/logout" method="post">
            <input type="hidden" name="csrf" value={session.csrf} />
            <button type="submit" className="btn">
              Sign out
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
