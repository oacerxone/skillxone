import type { Kysely, Selectable } from 'kysely';
import { newId, toIso } from '@skillxone/shared';
import type { Database, SubscriptionsTable } from './types';

/**
 * Subscriptions for paid (Pro) accounts. Rows are created by our checkout route, so the
 * user a subscription belongs to always comes from our own session, never from data in a
 * webhook. Status values are the provider's, copied after fetching the provider's record.
 */

type Db = Kysely<Database>;
export type SubscriptionRow = Selectable<SubscriptionsTable>;

/** Provider statuses that grant Pro: paying, authorised and about to be charged, or retrying a failed charge. */
export const PRO_STATUSES: readonly string[] = ['active', 'authenticated', 'pending'];

export const grantsPro = (status: string): boolean => PRO_STATUSES.includes(status);

export async function createSubscriptionRecord(
  db: Db,
  input: {
    userId: string;
    provider: string;
    providerSubscriptionId: string;
    planId: string;
    status: string;
    now: Date;
  },
): Promise<SubscriptionRow> {
  const nowIso = toIso(input.now);
  const row: SubscriptionRow = {
    id: newId(input.now),
    user_id: input.userId,
    provider: input.provider,
    provider_subscription_id: input.providerSubscriptionId.slice(0, 100),
    plan_id: input.planId.slice(0, 100),
    status: input.status.slice(0, 40),
    current_end: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  await db.insertInto('subscriptions').values(row).execute();
  return row;
}

/** Copies the provider's current state onto our row. Unknown subscriptions are ignored. */
export async function updateSubscriptionState(
  db: Db,
  providerSubscriptionId: string,
  state: { status: string; currentEnd: Date | null },
  now: Date,
): Promise<SubscriptionRow | undefined> {
  await db
    .updateTable('subscriptions')
    .set({
      status: state.status.slice(0, 40),
      current_end: state.currentEnd ? toIso(state.currentEnd) : null,
      updated_at: toIso(now),
    })
    .where('provider_subscription_id', '=', providerSubscriptionId)
    .execute();
  return db
    .selectFrom('subscriptions')
    .selectAll()
    .where('provider_subscription_id', '=', providerSubscriptionId)
    .executeTakeFirst();
}

/** The user's most recent subscription, if any. */
export async function latestSubscription(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | undefined> {
  return db
    .selectFrom('subscriptions')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
}

/** The user's subscription that currently grants Pro, if any. */
export async function activeProSubscription(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | undefined> {
  return db
    .selectFrom('subscriptions')
    .selectAll()
    .where('user_id', '=', userId)
    .where('status', 'in', [...PRO_STATUSES])
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
}

/**
 * Records a webhook delivery id. Returns false if it was already recorded, so a repeated
 * delivery is acknowledged without being processed twice.
 */
export async function recordBillingEvent(db: Db, eventId: string, now: Date): Promise<boolean> {
  const id = eventId.slice(0, 100);
  const existing = await db
    .selectFrom('billing_events')
    .select('event_id')
    .where('event_id', '=', id)
    .executeTakeFirst();
  if (existing) return false;
  try {
    await db
      .insertInto('billing_events')
      .values({ event_id: id, received_at: toIso(now) })
      .execute();
    return true;
  } catch {
    // Another delivery of the same event won the race.
    return false;
  }
}
