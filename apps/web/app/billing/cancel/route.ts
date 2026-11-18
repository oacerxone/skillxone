import { NextResponse } from 'next/server';
import { activeProSubscription, updateSubscriptionState, writeAudit } from '@skillxone/database';
import { providedCsrf, sessionFromRequest, siteEnv } from '@/lib/auth';
import { cancelProviderSubscription, razorpayConfig } from '@/lib/billing';
import { getDatabase } from '@/lib/db';
import { originAllowed, verifyCsrf } from '@/lib/security';

export const dynamic = 'force-dynamic';

const back = (request: Request, path: string) =>
  NextResponse.redirect(new URL(path, request.url), 303);

/** Cancels the user's Pro subscription at the end of the period already paid for. */
export async function POST(request: Request): Promise<Response> {
  const config = razorpayConfig();
  if (!config) return back(request, '/account');
  if (!originAllowed(request, siteEnv().SITE_URL)) return back(request, '/account');
  const form = await request.formData().catch(() => null);
  const session = await sessionFromRequest(request);
  if (!session) return back(request, '/auth/github/login?next=/account');
  if (!verifyCsrf(session.csrfSecret, providedCsrf(request, form))) {
    return back(request, '/account?billing=expired');
  }
  const { db } = await getDatabase();
  const current = await activeProSubscription(db, session.user.id);
  if (!current) return back(request, '/account');
  try {
    const state = await cancelProviderSubscription(config, current.provider_subscription_id);
    const now = new Date();
    await updateSubscriptionState(db, state.id, state, now);
    await writeAudit(
      db,
      {
        actorId: session.user.id,
        action: 'billing.cancel',
        targetType: 'user',
        targetId: session.user.id,
        after: { subscription: state.id, status: state.status },
      },
      now,
    );
    return back(request, '/account?billing=cancelled');
  } catch (error) {
    console.error('Cancel failed:', error instanceof Error ? error.message : 'unknown error');
    return back(request, '/account?billing=error');
  }
}
