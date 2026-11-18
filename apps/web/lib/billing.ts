import { createHmac, timingSafeEqual } from 'node:crypto';
import { activeProSubscription } from '@skillxone/database';
import { currentSession, oauthConfig, siteEnv } from './auth';
import { getDatabase } from './db';

/**
 * Pro accounts through Razorpay Subscriptions.
 *
 * - Checkout: a signed-in user starts a subscription; we store it against their account and
 *   send them to Razorpay's hosted payment page. No card data ever reaches this site.
 * - Webhooks prove they come from Razorpay with an HMAC over the raw body. Even then we do
 *   not trust the state they carry: we fetch the subscription from Razorpay's API and copy
 *   its current status, so late or repeated deliveries cannot leave a stale state behind.
 * - Pro features are gated only when billing and sign-in are both configured. Otherwise
 *   nobody could pay, so everything stays open.
 */

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  planId: string;
  priceLabel: string;
}

export function razorpayConfig(): RazorpayConfig | null {
  const env = siteEnv();
  if (
    !env.RAZORPAY_KEY_ID ||
    !env.RAZORPAY_KEY_SECRET ||
    !env.RAZORPAY_WEBHOOK_SECRET ||
    !env.RAZORPAY_PLAN_ID
  ) {
    return null;
  }
  return {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    planId: env.RAZORPAY_PLAN_ID,
    priceLabel: env.PRO_PRICE_LABEL,
  };
}

/** True when people can actually sign in and pay, which is when Pro features are gated. */
export function billingEnabled(): boolean {
  return razorpayConfig() !== null && oauthConfig() !== null;
}

export const proPriceLabel = (): string => siteEnv().PRO_PRICE_LABEL;

export interface ViewerAccess {
  /** Billing and sign-in are configured. */
  billing: boolean;
  signedIn: boolean;
  pro: boolean;
  /** Pro-only features must be withheld from this viewer. */
  locked: boolean;
}

/** What the current visitor may use. Reads the session only when billing is on. */
export async function viewerAccess(): Promise<ViewerAccess> {
  if (!billingEnabled()) return { billing: false, signedIn: false, pro: false, locked: false };
  const session = await currentSession();
  if (!session) return { billing: true, signedIn: false, pro: false, locked: true };
  const { db } = await getDatabase();
  const pro = (await activeProSubscription(db, session.user.id)) !== undefined;
  return { billing: true, signedIn: true, pro, locked: !pro };
}

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export interface ProviderSubscription {
  id: string;
  status: string;
  currentEnd: Date | null;
  shortUrl: string | null;
}

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{6,40}$/;
export const isSubscriptionId = (value: unknown): value is string =>
  typeof value === 'string' && SUBSCRIPTION_ID.test(value);

/** Validates the parts of a Razorpay subscription entity we use. */
export function parseSubscription(value: unknown): ProviderSubscription {
  const entity = (value ?? {}) as Record<string, unknown>;
  if (!isSubscriptionId(entity.id)) throw new BillingError('Unexpected subscription id');
  const status = typeof entity.status === 'string' ? entity.status.slice(0, 40) : '';
  if (!/^[a-z_]{1,40}$/.test(status)) throw new BillingError('Unexpected subscription status');
  const end = Number(entity.current_end);
  return {
    id: entity.id,
    status,
    currentEnd: Number.isFinite(end) && end > 0 ? new Date(end * 1000) : null,
    shortUrl: typeof entity.short_url === 'string' ? entity.short_url : null,
  };
}

/** Razorpay's hosted checkout links live on these hosts only. */
export function safeCheckoutUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowed = host === 'rzp.io' || host === 'razorpay.com' || host.endsWith('.razorpay.com');
    return parsed.protocol === 'https:' && allowed ? parsed.toString() : null;
  } catch {
    return null;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const API = 'https://api.razorpay.com/v1';

async function call(
  config: RazorpayConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  fetchImpl: FetchLike = fetch,
): Promise<unknown> {
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
  let response: Response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BillingError('Razorpay could not be reached');
  }
  // Error bodies are not echoed: they may repeat request details.
  if (!response.ok) throw new BillingError('Razorpay refused the request', response.status);
  return response.json().catch(() => {
    throw new BillingError('Razorpay returned an unreadable response');
  });
}

export async function createProviderSubscription(
  config: RazorpayConfig,
  userId: string,
  fetchImpl?: FetchLike,
): Promise<ProviderSubscription> {
  const result = await call(
    config,
    'POST',
    '/subscriptions',
    {
      plan_id: config.planId,
      // Monthly renewals for up to ten years; the customer can cancel at any time.
      total_count: 120,
      quantity: 1,
      customer_notify: 1,
      notes: { skillxone_user: userId },
    },
    fetchImpl,
  );
  return parseSubscription(result);
}

export async function fetchProviderSubscription(
  config: RazorpayConfig,
  id: string,
  fetchImpl?: FetchLike,
): Promise<ProviderSubscription> {
  if (!isSubscriptionId(id)) throw new BillingError('Unexpected subscription id');
  return parseSubscription(await call(config, 'GET', `/subscriptions/${id}`, undefined, fetchImpl));
}

/** Cancels at the end of the paid period, so the customer keeps what they paid for. */
export async function cancelProviderSubscription(
  config: RazorpayConfig,
  id: string,
  fetchImpl?: FetchLike,
): Promise<ProviderSubscription> {
  if (!isSubscriptionId(id)) throw new BillingError('Unexpected subscription id');
  return parseSubscription(
    await call(
      config,
      'POST',
      `/subscriptions/${id}/cancel`,
      { cancel_at_cycle_end: 1 },
      fetchImpl,
    ),
  );
}

/** Checks Razorpay's `X-Razorpay-Signature`: hex HMAC-SHA256 of the raw body. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** The subscription id a webhook payload refers to, if any. */
export function webhookSubscriptionId(payload: unknown): string | null {
  const root = (payload ?? {}) as { payload?: { subscription?: { entity?: { id?: unknown } } } };
  const id = root.payload?.subscription?.entity?.id;
  return isSubscriptionId(id) ? id : null;
}
