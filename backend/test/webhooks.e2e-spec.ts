import { createHmac, randomUUID } from 'crypto';
import { OrderSyncService } from '../src/orders/order-sync.service';
import { WebhookProcessorService } from '../src/webhooks/webhook-processor.service';
import { SHOP } from './utils/fake-shopify';
import { connectStore, createShopifyTestApp, ShopifyTestContext } from './utils/shopify-test-app';
import { resetDatabase } from './utils/test-app';

const SECRET = 'test-webhook-secret';

function restOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 820982911946154500,
    admin_graphql_api_id: 'gid://shopify/Order/820982911946154500',
    name: '#9001',
    created_at: '2026-03-01T10:00:00-05:00',
    updated_at: '2026-03-01T10:00:00-05:00',
    cancelled_at: null,
    closed_at: null,
    financial_status: 'pending',
    fulfillment_status: null,
    currency: 'EUR',
    email: 'jon@example.com',
    current_subtotal_price: '199.00',
    current_total_tax: '19.90',
    current_total_discounts: '10.00',
    current_total_price: '213.90',
    total_shipping_price_set: { shop_money: { amount: '5.00', currency_code: 'EUR' } },
    tags: 'vip, wholesale',
    customer: { id: 115310627314723950, first_name: 'Jon', last_name: 'Snow', email: 'jon@example.com', phone: null },
    billing_address: { first_name: 'Jon', last_name: 'Snow', address1: '1 Wall', city: 'Winterfell', country_code: 'GB', zip: 'W1' },
    shipping_address: null,
    line_items: [
      { id: 866550311766439000, admin_graphql_api_id: 'gid://shopify/LineItem/866550311766439000', product_id: 632910392, variant_id: 808950810, title: 'Cloak', variant_title: 'Black', sku: 'CLK-1', quantity: 1, price: '199.00', total_discount: '10.00' },
    ],
    ...overrides,
  };
}

describe('Shopify webhooks (e2e)', () => {
  let ctx: ShopifyTestContext;
  let token: string;
  let processor: WebhookProcessorService;

  const send = (
    path: string,
    payload: unknown,
    opts: { topic?: string; webhookId?: string; shop?: string; secret?: string; hmac?: string | null; raw?: string } = {},
  ) => {
    const raw = opts.raw ?? JSON.stringify(payload);
    const hmac =
      opts.hmac === undefined ? createHmac('sha256', opts.secret ?? SECRET).update(raw).digest('base64') : opts.hmac;
    const req = ctx
      .http()
      .post(`/api/webhooks/shopify/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', opts.topic ?? (path === 'orders-create' ? 'orders/create' : path === 'orders-update' ? 'orders/updated' : 'app/uninstalled'))
      .set('X-Shopify-Shop-Domain', opts.shop ?? SHOP)
      .set('X-Shopify-Webhook-Id', opts.webhookId ?? randomUUID())
      .set('X-Shopify-Event-Id', randomUUID())
      .set('X-Shopify-API-Version', '2026-10');
    if (hmac !== null) req.set('X-Shopify-Hmac-Sha256', hmac);
    return req.send(raw);
  };

  const settle = () => processor.waitForIdle();
  const logs = (query: Record<string, unknown> = {}) =>
    ctx.http().get('/api/webhooks/logs').query(query).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await createShopifyTestApp();
    processor = ctx.app.get(WebhookProcessorService);
  });
  beforeEach(async () => {
    await processor.waitForIdle();
    jest.restoreAllMocks();
    await resetDatabase(ctx.prisma);
    ctx.fake.reset();
    ({ token } = await connectStore(ctx));
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  describe('HMAC verification', () => {
    it('accepts a correctly signed webhook and creates the order', async () => {
      const res = await send('orders-create', restOrder()).expect(200);
      expect(res.body.data).toMatchObject({ received: true, duplicate: false });
      await settle();

      const order = await ctx.prisma.order.findFirstOrThrow({ include: { items: true, customer: true } });
      expect(order).toMatchObject({
        shopifyOrderId: 'gid://shopify/Order/820982911946154500',
        orderNumber: '#9001',
        source: 'WEBHOOK',
        currency: 'EUR',
        financialStatus: 'PENDING',
        fulfillmentStatus: 'UNFULFILLED',
        tags: ['vip', 'wholesale'],
      });
      expect(order.totalAmount.toString()).toBe('213.9');
      expect(order.shippingAmount.toString()).toBe('5');
      expect(order.items[0]).toMatchObject({ shopifyVariantId: 'gid://shopify/ProductVariant/808950810', sku: 'CLK-1' });
      expect(order.items[0].totalPrice.toString()).toBe('189');
      expect(order.customer?.shopifyCustomerId).toBe('gid://shopify/Customer/115310627314723950');

      const event = await ctx.prisma.webhookEvent.findFirstOrThrow();
      expect(event).toMatchObject({ topic: 'orders/create', processingStatus: 'PROCESSED', retryCount: 0 });
      expect(event.processedAt).not.toBeNull();
    });

    it('rejects an invalid signature without storing anything', async () => {
      const res = await send('orders-create', restOrder(), { hmac: 'aW52YWxpZA==' }).expect(401);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
      expect(await ctx.prisma.webhookEvent.count()).toBe(0);
      expect(await ctx.prisma.order.count()).toBe(0);
    });

    it('rejects a missing signature', async () => {
      await send('orders-create', restOrder(), { hmac: null }).expect(401);
    });

    it('rejects a signature made with the wrong secret', async () => {
      await send('orders-create', restOrder(), { secret: 'not-the-secret' }).expect(401);
    });

    it('rejects a body modified after signing (signature covers the raw bytes)', async () => {
      const raw = JSON.stringify(restOrder());
      const hmac = createHmac('sha256', SECRET).update(raw).digest('base64');
      await send('orders-create', null, { raw: raw.replace('213.90', '0.01'), hmac }).expect(401);
      expect(await ctx.prisma.order.count()).toBe(0);
    });

    it('verifies against raw bytes, not re-serialised JSON (whitespace preserved)', async () => {
      const raw = JSON.stringify(restOrder(), null, 2);
      await send('orders-create', null, { raw }).expect(200);
    });

    it('rejects a topic sent to the wrong endpoint', async () => {
      const res = await send('orders-create', restOrder(), { topic: 'orders/updated' }).expect(400);
      expect(res.body.error.code).toBe('WEBHOOK_TOPIC_MISMATCH');
    });
  });

  describe('order updates', () => {
    it('updates an existing order and replaces its line items', async () => {
      await send('orders-create', restOrder()).expect(200);
      await settle();
      await send(
        'orders-update',
        restOrder({
          updated_at: '2026-03-02T10:00:00-05:00',
          fulfillment_status: 'fulfilled',
          financial_status: 'paid',
          line_items: [
            { id: 1, product_id: 1, variant_id: 2, title: 'Boots', quantity: 3, price: '50.00', total_discount: '0' },
          ],
        }),
      ).expect(200);
      await settle();

      expect(await ctx.prisma.order.count()).toBe(1);
      const order = await ctx.prisma.order.findFirstOrThrow({ include: { items: true } });
      expect(order).toMatchObject({ fulfillmentStatus: 'FULFILLED', financialStatus: 'PAID' });
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({ productName: 'Boots', quantity: 3 });
    });

    it('creates the order if the update arrives before the create', async () => {
      await send('orders-update', restOrder()).expect(200);
      await settle();
      expect(await ctx.prisma.order.count()).toBe(1);
    });

    it('ignores out-of-order (stale) updates', async () => {
      await send('orders-update', restOrder({ updated_at: '2026-03-05T00:00:00Z', fulfillment_status: 'fulfilled' })).expect(200);
      await settle();
      await send('orders-update', restOrder({ updated_at: '2026-03-04T00:00:00Z', fulfillment_status: null })).expect(200);
      await settle();
      const order = await ctx.prisma.order.findFirstOrThrow();
      expect(order.fulfillmentStatus).toBe('FULFILLED');
      const events = await ctx.prisma.webhookEvent.findMany();
      expect(events.every((e) => e.processingStatus === 'PROCESSED')).toBe(true);
    });

    it('marks the store disconnected on app/uninstalled', async () => {
      await send('app-uninstalled', { id: 1, domain: SHOP }).expect(200);
      await settle();
      const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
      expect(store.connectionStatus).toBe('DISCONNECTED');
      expect(store.accessToken).toBeNull();
    });

    it('skips events for shops that are not connected', async () => {
      await send('orders-create', restOrder(), { shop: 'other-shop.myshopify.com' }).expect(200);
      await settle();
      const event = await ctx.prisma.webhookEvent.findFirstOrThrow();
      expect(event.processingStatus).toBe('SKIPPED');
      expect(event.errorMessage).toContain('Unknown shop');
      expect(await ctx.prisma.order.count()).toBe(0);
    });
  });

  describe('duplicate handling', () => {
    it('acknowledges a re-delivered webhook without reprocessing it', async () => {
      const webhookId = randomUUID();
      await send('orders-create', restOrder(), { webhookId }).expect(200);
      await settle();
      const dup = await send('orders-create', restOrder(), { webhookId }).expect(200);
      expect(dup.body.data).toEqual({ received: true, duplicate: true });
      await settle();
      expect(await ctx.prisma.webhookEvent.count()).toBe(1);
      expect(await ctx.prisma.order.count()).toBe(1);
    });

    it('stores and processes concurrent duplicate deliveries exactly once', async () => {
      const webhookId = randomUUID();
      const spy = jest.spyOn(ctx.app.get(OrderSyncService), 'upsertFromShopify');
      const results = await Promise.all(Array.from({ length: 8 }, () => send('orders-create', restOrder(), { webhookId })));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.data.duplicate === false)).toHaveLength(1);
      await settle();
      expect(await ctx.prisma.webhookEvent.count()).toBe(1);
      expect(await ctx.prisma.order.count()).toBe(1);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('never creates duplicate orders when different deliveries race for the same order', async () => {
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => send('orders-create', restOrder())),
        ...Array.from({ length: 4 }, () => send('orders-update', restOrder())),
      ]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      await settle();
      expect(await ctx.prisma.webhookEvent.count()).toBe(8);
      expect(await ctx.prisma.order.count()).toBe(1);
      expect(await ctx.prisma.orderItem.count()).toBe(1);
      expect(await ctx.prisma.customer.count()).toBe(1);
      const statuses = await ctx.prisma.webhookEvent.findMany({ select: { processingStatus: true } });
      expect(statuses.every((s) => s.processingStatus === 'PROCESSED')).toBe(true);
    });

    it('does not duplicate a CRM-created order when its orders/create webhook arrives', async () => {
      const created = await ctx
        .http()
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          idempotencyKey: randomUUID(),
          customer: { firstName: 'A', lastName: 'B' },
          lineItems: [{ variantId: 'gid://shopify/ProductVariant/1', quantity: 1 }],
        })
        .expect(201);
      const legacyId = created.body.data.order.shopifyLegacyId as string;
      await send('orders-create', restOrder({ id: Number(legacyId), admin_graphql_api_id: `gid://shopify/Order/${legacyId}`, updated_at: new Date().toISOString() })).expect(200);
      await settle();
      expect(await ctx.prisma.order.count()).toBe(1);
    });
  });

  describe('failures, retry and recovery', () => {
    it('records a transient failure with a scheduled retry, then recovers', async () => {
      jest.spyOn(ctx.app.get(OrderSyncService), 'upsertFromShopify').mockRejectedValueOnce(new Error('db hiccup'));
      await send('orders-create', restOrder()).expect(200); // still acknowledged: event is persisted
      await settle();

      let event = await ctx.prisma.webhookEvent.findFirstOrThrow();
      expect(event).toMatchObject({ processingStatus: 'FAILED', retryCount: 1, errorMessage: 'db hiccup' });
      expect(event.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await ctx.prisma.order.count()).toBe(0);

      // not yet due -> recovery loop leaves it alone
      expect(await processor.recoverDue()).toBe(0);

      await ctx.prisma.webhookEvent.update({ where: { id: event.id }, data: { nextRetryAt: new Date(Date.now() - 1000) } });
      expect(await processor.recoverDue()).toBe(1);
      event = await ctx.prisma.webhookEvent.findFirstOrThrow();
      expect(event).toMatchObject({ processingStatus: 'PROCESSED', retryCount: 1, errorMessage: null });
      expect(await ctx.prisma.order.count()).toBe(1);
    });

    it('stops retrying after the maximum number of attempts', async () => {
      jest.spyOn(ctx.app.get(OrderSyncService), 'upsertFromShopify').mockRejectedValue(new Error('still broken'));
      await send('orders-create', restOrder()).expect(200);
      await settle();
      for (let i = 0; i < 5; i++) {
        await ctx.prisma.webhookEvent.updateMany({ where: { nextRetryAt: { not: null } }, data: { nextRetryAt: new Date(Date.now() - 1000) } });
        await processor.recoverDue();
      }
      const event = await ctx.prisma.webhookEvent.findFirstOrThrow();
      expect(event).toMatchObject({ processingStatus: 'FAILED', retryCount: 3, nextRetryAt: null }); // WEBHOOK_MAX_RETRIES=3
    });

    it('fails permanently (no retries) for an invalid payload', async () => {
      await send('orders-create', { name: 'no id' }).expect(200);
      await settle();
      const event = await ctx.prisma.webhookEvent.findFirstOrThrow();
      expect(event).toMatchObject({ processingStatus: 'FAILED', retryCount: 3, nextRetryAt: null });
      expect(event.errorMessage).toContain('Invalid order payload');
    });

    it('recovers events that were persisted but never dispatched (crash after ack)', async () => {
      const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
      await ctx.prisma.webhookEvent.create({
        data: {
          shopifyEventId: randomUUID(),
          shopDomain: SHOP,
          storeId: store.id,
          topic: 'orders/create',
          payload: restOrder(),
          receivedAt: new Date(Date.now() - 5 * 60_000),
        },
      });
      expect(await processor.recoverDue()).toBe(1);
      expect(await ctx.prisma.order.count()).toBe(1);
    });

    it('recovers events stuck in PROCESSING after a worker died', async () => {
      const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
      const e = await ctx.prisma.webhookEvent.create({
        data: {
          shopifyEventId: randomUUID(),
          shopDomain: SHOP,
          storeId: store.id,
          topic: 'orders/create',
          payload: restOrder(),
          processingStatus: 'PROCESSING',
          lockedAt: new Date(Date.now() - 10 * 60_000),
        },
      });
      await processor.recoverDue();
      expect((await ctx.prisma.webhookEvent.findUniqueOrThrow({ where: { id: e.id } })).processingStatus).toBe('PROCESSED');
    });

    it('does not let two workers process the same event concurrently', async () => {
      const spy = jest.spyOn(ctx.app.get(OrderSyncService), 'upsertFromShopify');
      const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
      const e = await ctx.prisma.webhookEvent.create({
        data: { shopifyEventId: randomUUID(), shopDomain: SHOP, storeId: store.id, topic: 'orders/create', payload: restOrder() },
      });
      const results = await Promise.all(Array.from({ length: 5 }, () => processor.process(e.id)));
      expect(results.filter((r) => r === 'PROCESSED')).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(4);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('webhook logs API', () => {
    it('requires authentication', async () => {
      await ctx.http().get('/api/webhooks/logs').expect(401);
    });

    it('lists, filters and shows details of events', async () => {
      await send('orders-create', restOrder()).expect(200);
      await send('orders-update', { bad: true }, { webhookId: 'wh-bad-1' }).expect(200);
      await settle();

      const all = await logs().expect(200);
      expect(all.body.data.meta.totalItems).toBe(2);
      expect(all.body.data.counts).toEqual({ PROCESSED: 1, FAILED: 1 });
      expect(all.body.data.items[0].payload).toBeUndefined(); // list omits payloads

      const failed = await logs({ status: 'FAILED' }).expect(200);
      expect(failed.body.data.items).toHaveLength(1);
      expect(failed.body.data.items[0]).toMatchObject({ shopifyEventId: 'wh-bad-1', topic: 'orders/updated' });

      const bySearch = await logs({ search: '820982911946154500' }).expect(200);
      expect(bySearch.body.data.items).toHaveLength(1);

      const details = await ctx
        .http()
        .get(`/api/webhooks/logs/${all.body.data.items[1].id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(details.body.data.payload).toBeDefined();
    });

    it('manually retries a failed event', async () => {
      jest.spyOn(ctx.app.get(OrderSyncService), 'upsertFromShopify').mockRejectedValueOnce(new Error('temporary'));
      await send('orders-create', restOrder()).expect(200);
      await settle();
      const event = await ctx.prisma.webhookEvent.findFirstOrThrow();
      const res = await ctx
        .http()
        .post(`/api/webhooks/logs/${event.id}/retry`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.status).toBe('PROCESSED');
      expect(await ctx.prisma.order.count()).toBe(1);

      // processed events cannot be retried
      await ctx.http().post(`/api/webhooks/logs/${event.id}/retry`).set('Authorization', `Bearer ${token}`).expect(409);
    });
  });
});
