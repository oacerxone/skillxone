import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Paid accounts. A subscription row is created when a signed-in user starts checkout and is
 * then kept in step with the payment provider, whose own record is the source of truth.
 * `billing_events` remembers delivered webhook ids so a repeated delivery is ignored.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations are schema-agnostic
async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('subscriptions')
    .addColumn('id', 'text', (c) => c.primaryKey().notNull())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('provider', 'text', (c) => c.notNull())
    .addColumn('provider_subscription_id', 'text', (c) => c.notNull().unique())
    .addColumn('plan_id', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('current_end', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('idx_subscriptions_user')
    .on('subscriptions')
    .columns(['user_id', 'created_at'])
    .execute();
  await db.schema
    .createTable('billing_events')
    .addColumn('event_id', 'text', (c) => c.primaryKey().notNull())
    .addColumn('received_at', 'text', (c) => c.notNull())
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations are schema-agnostic
async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('billing_events').ifExists().execute();
  await db.schema.dropTable('subscriptions').ifExists().execute();
}

export const billingMigration: Migration = { up, down };
export const BILLING_TABLES: readonly string[] = ['subscriptions', 'billing_events'];
