import { NextResponse } from 'next/server';
import { activeProSubscription, createSubscriptionRecord, writeAudit } from '@skillxone/database';
import { providedCsrf, sessionFromRequest, siteEnv } from '@/lib/auth';
import {
  BillingError,
  billingEnabled,
  createProviderSubscription,
  razorpayConfig,
  safeCheckoutUrl,
} from '@/lib/billing';
import { getDatabase } from '@/lib/db';
import { originAllowed, verifyCsrf } from '@/lib/security';

export const dynamic = 'force-dynamic';

const back = (request: Request, path: string) =>
  NextResponse.redirect(new URL(path, request.url), 303);

/** Starts a Pro subscription for the signed-in user and sends them to Razorpay to pay. */
export async function POST(request: Request): Promise<Response> {
  const config = razorpayConfig();
  if (!config || !billingEnabled()) return back(request, '/pricing');
  if (!originAllowed(request, siteEnv().SITE_URL)) return back(request, '/pricing');
  const form = await request.formData().catch(() => null);
  const session = await sessionFromRequest(request);
  if (!session) return back(request, '/auth/github/login?next=/pricing');
  if (!verifyCsrf(session.csrfSecret, providedCsrf(request, form))) {
    return back(request, '/pricing?billing=expired');
  }

  const { db } = await getDatabase();
  if (await activeProSubscription(db, session.user.id)) return back(request, '/account');

  try {
    const subscription = await createProviderSubscription(config, session.user.id);
    const checkout = safeCheckoutUrl(subscription.shortUrl);
    if (!checkout) throw new BillingError('Razorpay returned no usable checkout link');
    const now = new Date();
    await createSubscriptionRecord(db, {
      userId: session.user.id,
      provider: 'razorpay',
      providerSubscriptionId: subscription.id,
      planId: config.planId,
      status: subscription.status,
      now,
    });
    await writeAudit(
      db,
      {
        actorId: session.user.id,
        action: 'billing.checkout',
        targetType: 'user',
        targetId: session.user.id,
        after: { subscription: subscription.id },
      },
      now,
    );
    return NextResponse.redirect(checkout, 303);
  } catch (error) {
    console.error('Checkout failed:', error instanceof Error ? error.message : 'unknown error');
    return back(request, '/pricing?billing=error');
  }
}
