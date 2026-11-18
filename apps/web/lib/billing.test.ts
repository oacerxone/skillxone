import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activeProSubscription,
  createSubscriptionRecord,
  grantsPro,
  migrateToLatest,
  openDatabase,
  upsertGitHubUser,
} from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';
import {
  BillingError,
  createProviderSubscription,
  parseSubscription,
  safeCheckoutUrl,
  verifyWebhookSignature,
  webhookSubscriptionId,
} from './billing';
import type { ProviderSubscription, RazorpayConfig } from './billing';
import { handleRazorpayWebhook } from './billing-webhook';

const SECRET = 'whsec_test_value';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');
const config: RazorpayConfig = {
  keyId: 'rzp_test_key',
  keySecret: 'test-secret-value',
  webhookSecret: SECRET,
  planId: 'plan_TEST123',
  priceLabel: '$5 / month',
};

describe('webhook signatures', () => {
  it('accepts the HMAC of the exact raw body and nothing else', () => {
    const body = '{"event":"subscription.activated"}';
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebhookSignature(`${body} `, sign(body), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), 'other-secret')).toBe(false);
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'not-hex', SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body).slice(0, 62), SECRET)).toBe(false);
  });
});

describe('provider data', () => {
  it('parses a subscription and rejects unexpected ids or statuses', () => {
    expect(
      parseSubscription({ id: 'sub_ABC123xyz', status: 'active', current_end: 1767225600 }),
    ).toEqual({
      id: 'sub_ABC123xyz',
      status: 'active',
      currentEnd: new Date('2026-01-01T00:00:00.000Z'),
      shortUrl: null,
    });
    expect(() => parseSubscription({ id: '../x', status: 'active' })).toThrow(BillingError);
    expect(() => parseSubscription({ id: 'sub_ABC123xyz', status: 'Active; drop' })).toThrow();
  });

  it('only follows https checkout links on Razorpay hosts', () => {
    expect(safeCheckoutUrl('https://rzp.io/i/abc')).toBe('https://rzp.io/i/abc');
    expect(safeCheckoutUrl('https://pages.razorpay.com/x')).toBe('https://pages.razorpay.com/x');
    expect(safeCheckoutUrl('http://rzp.io/i/abc')).toBeNull();
    expect(safeCheckoutUrl('https://rzp.io.evil.example/i/abc')).toBeNull();
    expect(safeCheckoutUrl('https://evilrazorpay.com/x')).toBeNull();
    expect(safeCheckoutUrl('javascript:alert(1)')).toBeNull();
    expect(safeCheckoutUrl(null)).toBeNull();
  });

  it('reads the subscription id from a webhook payload', () => {
    expect(
      webhookSubscriptionId({ payload: { subscription: { entity: { id: 'sub_ABC123xyz' } } } }),
    ).toBe('sub_ABC123xyz');
    expect(webhookSubscriptionId({ payload: {} })).toBeNull();
    expect(webhookSubscriptionId(null)).toBeNull();
  });

  it('creates a subscription with basic auth and never echoes error bodies', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const ok = await createProviderSubscription(config, 'user1', async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ id: 'sub_NEW123abc', status: 'created', short_url: 'https://rzp.io/i/x' }),
      );
    });
    expect(ok.shortUrl).toBe('https://rzp.io/i/x');
    expect(calls[0]!.url).toBe('https://api.razorpay.com/v1/subscriptions');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from('rzp_test_key:test-secret-value').toString('base64')}`,
    );
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ plan_id: 'plan_TEST123' });

    const failure = createProviderSubscription(
      config,
      'user1',
      async () => new Response('{"error":"secret details"}', { status: 400 }),
    );
    await expect(failure).rejects.toThrow('Razorpay refused the request');
    await expect(failure).rejects.not.toThrow(/secret details/);
  });
});

describe('webhook handling', () => {
  let handle: DatabaseHandle;
  let userId: string;
  const now = new Date('2026-06-01T00:00:00.000Z');

  beforeEach(async () => {
    handle = await openDatabase('file::memory:');
    await migrateToLatest(handle.db);
    const user = await upsertGitHubUser(
      handle.db,
      { githubId: 42, login: 'payer', avatarUrl: null, role: 'user' },
      now,
    );
    userId = user.id;
    await createSubscriptionRecord(handle.db, {
      userId,
      provider: 'razorpay',
      providerSubscriptionId: 'sub_ABC123xyz',
      planId: 'plan_TEST123',
      status: 'created',
      now,
    });
  });
  afterEach(async () => {
    await handle.close();
  });

  const deliver = (
    body: string,
    options: {
      signature?: string | null;
      eventId?: string | null;
      state?: ProviderSubscription | Error;
    } = {},
  ) => {
    let fetched = 0;
    const result = handleRazorpayWebhook({
      raw: body,
      signature: options.signature === undefined ? sign(body) : options.signature,
      eventId: options.eventId === undefined ? 'evt_1' : options.eventId,
      secret: SECRET,
      db: handle.db,
      fetchSubscription: async () => {
        fetched += 1;
        const state = options.state ?? {
          id: 'sub_ABC123xyz',
          status: 'active',
          currentEnd: new Date('2026-07-01T00:00:00.000Z'),
          shortUrl: null,
        };
        if (state instanceof Error) throw state;
        return state;
      },
      now,
    });
    return { result, fetched: () => fetched };
  };

  const body = JSON.stringify({
    event: 'subscription.charged',
    // The payload claims "halted"; the handler must use the fetched state instead.
    payload: { subscription: { entity: { id: 'sub_ABC123xyz', status: 'halted' } } },
  });

  it('applies the state fetched from Razorpay, not the payload, and grants Pro', async () => {
    const { result } = deliver(body);
    expect((await result).status).toBe(200);
    const sub = await activeProSubscription(handle.db, userId);
    expect(sub?.status).toBe('active');
    expect(sub?.current_end).toBe('2026-07-01T00:00:00.000Z');
  });

  it('refuses a bad signature and changes nothing', async () => {
    const { result, fetched } = deliver(body, { signature: sign('{}') });
    expect((await result).status).toBe(401);
    expect(fetched()).toBe(0);
    expect(await activeProSubscription(handle.db, userId)).toBeUndefined();
  });

  it('acknowledges a repeated delivery without processing it again', async () => {
    await deliver(body).result;
    const second = deliver(body);
    expect(await second.result).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(second.fetched()).toBe(0);
  });

  it('asks Razorpay to retry when the state cannot be fetched', async () => {
    const failed = deliver(body, { state: new Error('network down') });
    expect((await failed.result).status).toBe(502);
    // Not recorded, so the retry is processed.
    const retry = deliver(body);
    expect((await retry.result).status).toBe(200);
    expect(retry.fetched()).toBe(1);
  });

  it('requires an event id', async () => {
    expect((await deliver(body, { eventId: null }).result).status).toBe(400);
  });

  it('treats only paying, authorised or retrying subscriptions as Pro', () => {
    expect(['active', 'authenticated', 'pending'].every(grantsPro)).toBe(true);
    expect(['created', 'halted', 'cancelled', 'completed', 'expired'].some(grantsPro)).toBe(false);
  });
});
