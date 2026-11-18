import { NextResponse } from 'next/server';
import { fetchProviderSubscription, razorpayConfig } from '@/lib/billing';
import { handleRazorpayWebhook } from '@/lib/billing-webhook';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Razorpay webhook. A server-to-server call authenticated by its HMAC signature, so there is
 * no session, origin or CSRF token to check. See lib/billing-webhook.ts.
 */
export async function POST(request: Request): Promise<Response> {
  const config = razorpayConfig();
  if (!config) {
    return NextResponse.json({ error: 'not configured' }, { status: 404 });
  }
  const { db } = await getDatabase();
  const result = await handleRazorpayWebhook({
    raw: await request.text(),
    signature: request.headers.get('x-razorpay-signature'),
    eventId: request.headers.get('x-razorpay-event-id'),
    secret: config.webhookSecret,
    db,
    fetchSubscription: (id) => fetchProviderSubscription(config, id),
    now: new Date(),
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'cache-control': 'no-store' },
  });
}
