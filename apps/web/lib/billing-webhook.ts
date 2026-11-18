import { recordBillingEvent, updateSubscriptionState } from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import { verifyWebhookSignature, webhookSubscriptionId } from './billing';
import type { ProviderSubscription } from './billing';

export const MAX_WEBHOOK_BYTES = 256 * 1024;

export interface WebhookInput {
  raw: string;
  signature: string | null;
  eventId: string | null;
  secret: string;
  db: DatabaseHandle['db'];
  /** Reads the subscription's current state from Razorpay. */
  fetchSubscription: (id: string) => Promise<ProviderSubscription>;
  now: Date;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Handles one Razorpay webhook delivery. The signature authenticates it; the state applied
 * is fetched from Razorpay, not read from the payload; a delivery id already processed is
 * acknowledged without doing anything; a failure answers non-2xx so Razorpay retries.
 */
export async function handleRazorpayWebhook(input: WebhookInput): Promise<WebhookResult> {
  if (input.raw.length > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: 'too large' } };
  if (!verifyWebhookSignature(input.raw, input.signature, input.secret)) {
    return { status: 401, body: { error: 'bad signature' } };
  }
  const eventId = input.eventId;
  if (!eventId || !/^[A-Za-z0-9_-]{1,100}$/.test(eventId)) {
    return { status: 400, body: { error: 'missing event id' } };
  }
  const seen = await input.db
    .selectFrom('billing_events')
    .select('event_id')
    .where('event_id', '=', eventId)
    .executeTakeFirst();
  if (seen) return { status: 200, body: { ok: true, duplicate: true } };

  let payload: unknown;
  try {
    payload = JSON.parse(input.raw);
  } catch {
    return { status: 400, body: { error: 'invalid json' } };
  }
  const subscriptionId = webhookSubscriptionId(payload);
  if (subscriptionId) {
    try {
      const state = await input.fetchSubscription(subscriptionId);
      await updateSubscriptionState(input.db, state.id, state, input.now);
    } catch (error) {
      console.error(
        'Webhook processing failed:',
        error instanceof Error ? error.message : 'unknown error',
      );
      return { status: 502, body: { error: 'try again' } };
    }
  }
  // Recorded only after processing, so a failed attempt is retried; processing is idempotent.
  await recordBillingEvent(input.db, eventId, input.now);
  return { status: 200, body: { ok: true } };
}
