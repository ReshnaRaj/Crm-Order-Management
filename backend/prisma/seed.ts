/**
 * Demo data seed – run with `npm run prisma:seed`.
 *
 * Boots the real NestJS application context and writes data through the application's
 * own services, so seeded records follow exactly the same rules as real ones:
 *   - users via AuthService.register (Argon2 hashing, role rules)
 *   - customers + orders + line items via OrderSyncService (transactional, unique per store)
 *   - webhook logs via WebhooksService.receive + the real webhook processor
 *
 * Idempotent: re-running updates the same records and never creates duplicates.
 * The demo store is DISCONNECTED (no token), so it is never used for Shopify API calls.
 *
 * Environment:
 *   SEED_USER_EMAIL / SEED_USER_PASSWORD   demo login (default demo@example.com / Demo1234!)
 *   SEED_RESET=true                        delete the demo store's data first (demo store only)
 */
import { NestFactory } from '@nestjs/core';
import { OrderSource, StoreConnectionStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { OrderSyncService } from '../src/orders/order-sync.service';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersRepository } from '../src/users/users.repository';
import { WebhookProcessorService } from '../src/webhooks/webhook-processor.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { buildDemoOrders, DEMO_CURRENCY, DEMO_SHOP_DOMAIN, demoGid } from './seed-data';

const DEMO_EMAIL = (process.env.SEED_USER_EMAIL ?? 'demo@example.com').toLowerCase();
const DEMO_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Demo1234!';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  const log = { log: (msg: string) => console.log(`[seed] ${msg}`) };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);

    // ── Demo user ──
    const users = app.get(UsersRepository);
    let user = await users.findByEmail(DEMO_EMAIL);
    if (!user) {
      await app.get(AuthService).register({ name: 'Demo Admin', email: DEMO_EMAIL, password: DEMO_PASSWORD });
      user = (await users.findByEmail(DEMO_EMAIL))!;
      log.log(`Created demo user ${DEMO_EMAIL}`);
    }

    // ── Optional reset (demo store data only) ──
    if (process.env.SEED_RESET === 'true') {
      await prisma.webhookEvent.deleteMany({
        where: { OR: [{ shopDomain: DEMO_SHOP_DOMAIN }, { shopifyEventId: { startsWith: 'demo-' } }] },
      });
      await prisma.shopifyStore.deleteMany({ where: { shopDomain: DEMO_SHOP_DOMAIN } }); // cascades orders, items, customers
      log.log('Removed previous demo store data');
    }

    // ── Demo store (disconnected: never used for API calls) ──
    const store = await prisma.shopifyStore.upsert({
      where: { shopDomain: DEMO_SHOP_DOMAIN },
      update: {},
      create: {
        shopDomain: DEMO_SHOP_DOMAIN,
        shopifyStoreId: 'gid://shopify/Shop/7000000001',
        name: 'CRM Demo Store (sample data)',
        currency: DEMO_CURRENCY,
        connectionStatus: StoreConnectionStatus.DISCONNECTED,
        lastError: 'Sample data only. Connect your own Shopify development store to import real orders.',
        connectedById: user.id,
      },
    });

    // ── Customers, orders and line items through the real sync service ──
    const sync = app.get(OrderSyncService);
    const anchor = new Date();
    anchor.setUTCHours(0, 0, 0, 0);
    const orders = buildDemoOrders(anchor);
    const counts = { created: 0, updated: 0, skipped: 0 };
    for (const [i, order] of orders.entries()) {
      // a few orders are marked as created from the CRM, as they would be in real use
      const source = i % 12 === 5 ? OrderSource.CRM : OrderSource.SHOPIFY_IMPORT;
      const { action } = await sync.upsertFromShopify(store.id, order, source);
      counts[action]++;
    }
    log.log(`Orders: ${counts.created} created, ${counts.updated} updated, ${counts.skipped} unchanged`);

    // ── Webhook traffic through the real receiver + processor ──
    const webhooks = app.get(WebhooksService);
    const processor = app.get(WebhookProcessorService);
    const day = anchor.toISOString().slice(0, 10);
    const headers = (topic: string, id: string) => ({
      'x-shopify-webhook-id': `demo-${day}-${id}`,
      'x-shopify-shop-domain': DEMO_SHOP_DOMAIN,
      'x-shopify-topic': topic,
      'x-shopify-api-version': '2026-10',
      'x-shopify-triggered-at': new Date().toISOString(),
    });
    const newest = orders[orders.length - 1];
    const legacyId = (gid: string) => Number(gid.split('/').pop());
    const restAddress = (a: (typeof orders)[number]['billingAddress']) =>
      a
        ? { first_name: a.firstName, last_name: a.lastName, address1: a.address1, city: a.city, province: a.province, province_code: a.provinceCode, country: a.country, country_code: a.countryCode, zip: a.zip, phone: a.phone }
        : null;
    const restPayload = (o: (typeof orders)[number], overrides: Record<string, unknown> = {}) => ({
      id: legacyId(o.shopifyOrderId),
      admin_graphql_api_id: o.shopifyOrderId,
      name: o.orderNumber,
      created_at: o.orderDate.toISOString(),
      updated_at: new Date().toISOString(),
      cancelled_at: null,
      closed_at: null,
      currency: o.currency,
      email: o.email,
      financial_status: o.financialStatus?.toLowerCase(),
      current_subtotal_price: o.subtotal,
      current_total_tax: o.totalTax,
      current_total_discounts: o.totalDiscount,
      current_total_price: o.totalAmount,
      total_shipping_price_set: { shop_money: { amount: o.shippingAmount, currency_code: o.currency } },
      tags: o.tags.join(', '),
      customer: o.customer
        ? { id: legacyId(o.customer.shopifyCustomerId), first_name: o.customer.firstName, last_name: o.customer.lastName, email: o.customer.email, phone: o.customer.phone }
        : null,
      billing_address: restAddress(o.billingAddress),
      shipping_address: restAddress(o.shippingAddress),
      phone: o.phone,
      note: o.note,
      fulfillment_status: o.fulfillmentStatus === 'FULFILLED' ? 'fulfilled' : o.fulfillmentStatus === 'PARTIALLY_FULFILLED' ? 'partial' : null,
      line_items: o.lineItems.map((l) => ({
        id: legacyId(l.shopifyLineItemId),
        product_id: l.shopifyProductId ? legacyId(l.shopifyProductId) : null,
        variant_id: l.shopifyVariantId ? legacyId(l.shopifyVariantId) : null,
        title: l.productName,
        variant_title: l.variantName,
        sku: l.sku,
        quantity: l.quantity,
        price: l.unitPrice,
        total_discount: l.totalDiscount,
      })),
      ...overrides,
    });

    const events: { topic: string; id: string; payload: unknown; shop?: string }[] = [
      { topic: 'orders/create', id: 'create-newest', payload: restPayload(newest) },
      { topic: 'orders/updated', id: 'update-newest-paid', payload: restPayload(newest, { financial_status: 'paid' }) },
      { topic: 'orders/updated', id: 'update-fulfilled', payload: restPayload(orders[orders.length - 3], { fulfillment_status: 'fulfilled' }) },
      // re-delivery of the same webhook id -> acknowledged as duplicate, not stored twice
      { topic: 'orders/create', id: 'create-newest', payload: restPayload(newest) },
      // malformed payload -> permanently FAILED (visible in Webhook Logs, can be retried manually)
      { topic: 'orders/updated', id: 'malformed', payload: { note: 'payload without an order id' } },
      // event for a shop that is not connected -> SKIPPED
      { topic: 'orders/create', id: 'unknown-shop', payload: restPayload(orders[0], { id: 1, admin_graphql_api_id: demoGid('order', 9999) }), shop: 'not-connected-shop.myshopify.com' },
    ];
    let duplicates = 0;
    for (const e of events) {
      const h = headers(e.topic, e.id);
      if (e.shop) h['x-shopify-shop-domain'] = e.shop;
      const ack = await webhooks.receive({ expectedTopic: e.topic, headers: h, payload: e.payload });
      if (ack.duplicate) duplicates++;
    }
    await processor.waitForIdle();
    log.log(`Webhooks: ${events.length} deliveries sent, ${duplicates} recognised as duplicates`);

    // ── Report what the dashboard should show ──
    const summary = await app.get(OrdersService).summary();
    const customers = await prisma.customer.count({ where: { storeId: store.id } });
    const items = await prisma.orderItem.count({ where: { order: { storeId: store.id } } });
    log.log(
      `Demo store: ${customers} customers, ${await prisma.order.count({ where: { storeId: store.id } })} orders, ${items} line items`,
    );
    log.log(
      `Dashboard (all stores): total=${summary.totalOrders} pending=${summary.pendingOrders} fulfilled=${summary.fulfilledOrders} ` +
        `cancelled=${summary.cancelledOrders} sales=${summary.totalSales.map((s) => `${s.amount} ${s.currency}`).join(', ')}`,
    );
    log.log(`Login: ${DEMO_EMAIL} / ${process.env.SEED_USER_PASSWORD ? '(SEED_USER_PASSWORD)' : DEMO_PASSWORD}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
