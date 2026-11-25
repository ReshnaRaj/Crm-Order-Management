import { decryptSecret } from '../src/common/utils/crypto.util';
import { OrderImportService } from '../src/shopify/order-import.service';
import { gql, hang, json, makeGqlOrder, SHOP, signedCallbackQuery, throttled } from './utils/fake-shopify';
import { connectStore, createShopifyTestApp, ShopifyTestContext, waitForSync } from './utils/shopify-test-app';
import { registerAndLogin, resetDatabase } from './utils/test-app';

describe('Shopify integration (e2e)', () => {
  let ctx: ShopifyTestContext;

  beforeAll(async () => {
    ctx = await createShopifyTestApp();
  });
  beforeEach(async () => {
    await ctx.app.get(OrderImportService).waitForIdle();
    await resetDatabase(ctx.prisma);
    ctx.fake.reset();
    ctx.sleeps.length = 0;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  describe('connection (OAuth)', () => {
    it('connects a store, encrypts the token and registers webhooks', async () => {
      const { token, redirect } = await connectStore(ctx);
      expect(redirect).toBe('https://crm.test/integrations/shopify?status=connected');

      const store = await ctx.prisma.shopifyStore.findUniqueOrThrow({ where: { shopDomain: SHOP } });
      expect(store.connectionStatus).toBe('CONNECTED');
      expect(store.shopifyStoreId).toBe('gid://shopify/Shop/1');
      expect(store.accessToken).not.toContain('shpat_');
      expect(decryptSecret(store.accessToken!, Buffer.from(process.env.ENCRYPTION_KEY!, 'base64'))).toBe(
        'shpat_fake_token',
      );
      expect(ctx.fake.webhooks.map((w) => w.topic).sort()).toEqual([
        'APP_UNINSTALLED',
        'ORDERS_CREATE',
        'ORDERS_UPDATED',
      ]);
      expect(ctx.fake.webhooks[0].uri).toMatch(/^https:\/\/crm-api\.test\/api\/webhooks\/shopify\//);

      const status = await ctx.http().get('/api/shopify/status').set(auth(token)).expect(200);
      expect(status.body.data.connected).toBe(true);
      expect(status.body.data.store.shopDomain).toBe(SHOP);
      expect(status.body.data.missingScopes).toEqual([]);
      expect(JSON.stringify(status.body)).not.toContain('accessToken');
    });

    it('builds an authorization URL with the configured scopes', async () => {
      const { token } = await registerAndLogin(ctx);
      const res = await ctx.http().get('/api/shopify/connect').query({ shop: 'crm-test' }).set(auth(token)).expect(200);
      const url = new URL(res.body.data.authorizationUrl);
      expect(url.host).toBe(SHOP);
      expect(url.pathname).toBe('/admin/oauth/authorize');
      expect(url.searchParams.get('scope')).toBe('read_orders,write_orders,read_products,read_customers');
      expect(url.searchParams.get('redirect_uri')).toBe('https://crm-api.test/api/shopify/callback');
    });

    it('rejects an invalid shop domain', async () => {
      const { token } = await registerAndLogin(ctx);
      const res = await ctx.http().get('/api/shopify/connect').query({ shop: 'evil.com/x' }).set(auth(token)).expect(400);
      expect(res.body.error.code).toBe('INVALID_SHOP_DOMAIN');
    });

    it('requires authentication to start connecting', async () => {
      await ctx.http().get('/api/shopify/connect').query({ shop: SHOP }).expect(401);
    });

    it('rejects a callback with an invalid HMAC', async () => {
      const res = await ctx
        .http()
        .get('/api/shopify/callback')
        .query({ code: 'x', shop: SHOP, state: 'abc', timestamp: '1', hmac: 'deadbeef' })
        .expect(302);
      expect(res.headers.location).toContain('reason=invalid_signature');
      expect(await ctx.prisma.shopifyStore.count()).toBe(0);
    });

    it('rejects a callback with an unknown state', async () => {
      const query = signedCallbackQuery({ code: 'x', shop: SHOP, state: 'forged', timestamp: '1' }, process.env.SHOPIFY_API_SECRET!);
      const res = await ctx.http().get('/api/shopify/callback').query(query).expect(302);
      expect(res.headers.location).toContain('reason=invalid_state');
    });

    it('reports a failed token exchange', async () => {
      ctx.fake.once('oauth', () => json({ error: 'invalid_request' }, 400));
      const { redirect } = await connectStore(ctx);
      expect(redirect).toContain('status=error');
      expect(redirect).toContain('reason=shopify_auth_failed');
    });

    it('marks the store INVALID_TOKEN when Shopify returns 401', async () => {
      const { token } = await connectStore(ctx);
      ctx.fake.once('CrmShop', () => json({ errors: 'Invalid API key or access token' }, 401));
      const res = await ctx.http().post('/api/shopify/verify').set(auth(token)).expect(502);
      expect(res.body.error.code).toBe('SHOPIFY_AUTH_FAILED');
      const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
      expect(store.connectionStatus).toBe('INVALID_TOKEN');
    });
  });

  describe('order import', () => {
    it('imports all orders across pages with customers and line items', async () => {
      const { token } = await connectStore(ctx);
      ctx.fake.orders = Array.from({ length: 23 }, () => makeGqlOrder({ lineItemCount: 2 }));

      const res = await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      expect(res.body.data.status).toBe('RUNNING');
      await waitForSync(ctx);

      expect(await ctx.prisma.order.count()).toBe(23);
      expect(await ctx.prisma.orderItem.count()).toBe(46);
      expect(await ctx.prisma.customer.count()).toBe(23);
      expect(ctx.fake.callsTo('CrmOrders')).toHaveLength(3); // 10 + 10 + 3 (cursor pagination)

      const run = await ctx.prisma.syncRun.findFirstOrThrow();
      expect(run).toMatchObject({ status: 'SUCCEEDED', ordersFetched: 23, ordersCreated: 23, ordersUpdated: 0 });
      const order = await ctx.prisma.order.findFirstOrThrow({ include: { items: true, customer: true } });
      expect(order.totalAmount.toString()).toBe('40');
      expect(order.currency).toBe('USD');
      expect(order.customer?.email).toMatch(/@example\.com$/);
      expect(order.source).toBe('SHOPIFY_IMPORT');
      const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
      expect(store.lastSyncAt).not.toBeNull();
    });

    it('does not duplicate orders when imported twice, and applies changes', async () => {
      const { token } = await connectStore(ctx);
      ctx.fake.orders = [makeGqlOrder(), makeGqlOrder()];
      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);

      ctx.fake.orders[0] = {
        ...ctx.fake.orders[0],
        displayFulfillmentStatus: 'FULFILLED',
        updatedAt: new Date(Date.UTC(2026, 5, 1)).toISOString(),
      };
      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);

      expect(await ctx.prisma.order.count()).toBe(2);
      expect(await ctx.prisma.orderItem.count()).toBe(2);
      const updated = await ctx.prisma.order.findFirstOrThrow({ where: { shopifyOrderId: ctx.fake.orders[0].id } });
      expect(updated.fulfillmentStatus).toBe('FULFILLED');
      const last = await ctx.prisma.syncRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } });
      expect(last).toMatchObject({ ordersCreated: 0, ordersUpdated: 2 });
    });

    it('imports orders without customer details when protected customer data is denied', async () => {
      const { token } = await connectStore(ctx);
      const order = makeGqlOrder({ customer: null, billingAddress: null, email: null });
      ctx.fake.once('CrmOrders', () =>
        json({
          data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [order] } },
          errors: [
            { message: 'This app is not approved to access the Customer object.', path: ['orders', 'nodes', 0, 'customer'], extensions: { code: 'ACCESS_DENIED' } },
            { message: 'Access denied for billingAddress field.', path: ['orders', 'nodes', 0, 'billingAddress'], extensions: { code: 'ACCESS_DENIED' } },
          ],
        }),
      );
      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);

      const run = await ctx.prisma.syncRun.findFirstOrThrow();
      expect(run.status).toBe('SUCCEEDED');
      const saved = await ctx.prisma.order.findFirstOrThrow({ include: { items: true } });
      expect(saved).toMatchObject({ customerId: null, customerName: null, billingAddress: null });
      expect(saved.items).toHaveLength(1);
      expect((await ctx.prisma.shopifyStore.findFirstOrThrow()).connectionStatus).toBe('CONNECTED');
    });

    it('follows line-item pagination for large orders', async () => {
      const { token } = await connectStore(ctx);
      const order = makeGqlOrder({ lineItemCount: 1 });
      order.lineItems.pageInfo = { hasNextPage: true, endCursor: 'c1' };
      ctx.fake.orders = [order];
      ctx.fake.extraLineItems.set(order.id, [
        { ...order.lineItems.nodes[0], id: 'gid://shopify/LineItem/extra1' },
        { ...order.lineItems.nodes[0], id: 'gid://shopify/LineItem/extra2' },
      ]);
      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);
      expect(await ctx.prisma.orderItem.count()).toBe(3);
    });

    it('retries when Shopify throttles and still completes', async () => {
      const { token } = await connectStore(ctx);
      ctx.fake.orders = [makeGqlOrder()];
      ctx.fake.once('CrmOrders', throttled);
      ctx.fake.once('CrmOrders', () => json({ errors: 'Too many requests' }, 429, { 'Retry-After': '2' }));

      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);

      expect(await ctx.prisma.order.count()).toBe(1);
      expect(ctx.fake.callsTo('CrmOrders')).toHaveLength(3);
      expect(ctx.sleeps).toContain(2000); // honoured Retry-After
      const run = await ctx.prisma.syncRun.findFirstOrThrow();
      expect(run.status).toBe('SUCCEEDED');
    });

    it('records a failed run when Shopify keeps failing', async () => {
      const { token } = await connectStore(ctx);
      for (let i = 0; i < 5; i++) ctx.fake.once('CrmOrders', () => json({ errors: 'boom' }, 503));

      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);

      const run = await ctx.prisma.syncRun.findFirstOrThrow();
      expect(run.status).toBe('FAILED');
      expect(run.errorMessage).toContain('SHOPIFY_SERVER_ERROR');
      expect(await ctx.prisma.order.count()).toBe(0);
    });

    it('fails the run on request timeouts after retries', async () => {
      const { token } = await connectStore(ctx);
      for (let i = 0; i < 3; i++) ctx.fake.once('CrmOrders', hang);
      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);
      const run = await ctx.prisma.syncRun.findFirstOrThrow();
      expect(run.status).toBe('FAILED');
      expect(run.errorMessage).toContain('SHOPIFY_TIMEOUT');
    }, 20_000);

    it('marks the store INVALID_TOKEN when the token is revoked mid-import', async () => {
      const { token } = await connectStore(ctx);
      ctx.fake.once('CrmOrders', () => json({ errors: 'Invalid API key or access token' }, 401));
      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);
      const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
      expect(store.connectionStatus).toBe('INVALID_TOKEN');
      const run = await ctx.prisma.syncRun.findFirstOrThrow();
      expect(run.errorMessage).toContain('SHOPIFY_AUTH_FAILED');
    });

    it('rejects a concurrent import while one is running', async () => {
      const { token } = await connectStore(ctx);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      ctx.fake.orders = [makeGqlOrder()];
      ctx.fake.once('CrmOrders', async () => {
        await gate;
        return 'passthrough' as const;
      });
      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      const res = await ctx.http().post('/api/shopify/sync-orders').set(auth(token)).expect(409);
      expect(res.body.error.code).toBe('SYNC_ALREADY_RUNNING');
      release();
      await waitForSync(ctx);
    });

    it('incremental sync only requests orders updated since the last sync', async () => {
      const { token } = await connectStore(ctx);
      ctx.fake.orders = [makeGqlOrder()];
      await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);

      await ctx.http().post('/api/shopify/sync-orders').set(auth(token)).expect(202);
      await waitForSync(ctx);
      const lastCall = ctx.fake.callsTo('CrmOrders').at(-1)!;
      expect(String(lastCall.variables.query)).toMatch(/^updated_at:>='/);
    });

    it('requires a connected store', async () => {
      const { token } = await registerAndLogin(ctx);
      const res = await ctx.http().post('/api/shopify/import-orders').set(auth(token)).expect(409);
      expect(res.body.error.code).toBe('SHOPIFY_NOT_CONNECTED');
    });
  });

  describe('products', () => {
    it('lists products from Shopify with the store currency', async () => {
      const { token } = await connectStore(ctx);
      const res = await ctx.http().get('/api/shopify/products').query({ search: 'wid' }).set(auth(token)).expect(200);
      expect(res.body.data.currency).toBe('USD');
      expect(res.body.data.products[0].variants[0]).toMatchObject({ id: 'gid://shopify/ProductVariant/1', price: '12.50' });
      expect(String(ctx.fake.callsTo('CrmProducts')[0].variables.query)).toContain('title:wid*');
    });
  });

  it('keeps unrelated operations working (sanity)', () => {
    expect(gql({ ok: true }).status).toBe(200);
  });
});
