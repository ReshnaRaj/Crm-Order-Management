import { randomUUID } from 'crypto';
import { OrderCreationService } from '../src/orders/order-creation.service';
import { hang, json } from './utils/fake-shopify';
import { connectStore, createShopifyTestApp, ShopifyTestContext } from './utils/shopify-test-app';
import { resetDatabase } from './utils/test-app';

describe('Order creation (e2e)', () => {
  let ctx: ShopifyTestContext;
  let token: string;

  const body = (overrides: Record<string, unknown> = {}) => ({
    idempotencyKey: randomUUID(),
    customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    billingAddress: { address1: '1 Main St', city: 'Springfield', countryCode: 'us', zip: '12345' },
    lineItems: [{ variantId: 'gid://shopify/ProductVariant/1', quantity: 2 }],
    note: 'Phone order',
    ...overrides,
  });

  const post = (payload: object) =>
    ctx.http().post('/api/orders').set('Authorization', `Bearer ${token}`).send(payload);

  beforeAll(async () => {
    ctx = await createShopifyTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.fake.reset();
    ({ token } = await connectStore(ctx));
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates the order in Shopify and persists it locally', async () => {
    const payload = body({ shippingLine: { title: 'Courier', amount: '5.00' } });
    const res = await post(payload).expect(201);

    expect(res.body.data).toMatchObject({ status: 'SUCCEEDED', replayed: false });
    expect(res.body.data.order).toMatchObject({ source: 'CRM', financialStatus: 'PENDING' });
    expect(res.body.data.order.items[0]).toMatchObject({ quantity: 2, shopifyVariantId: 'gid://shopify/ProductVariant/1' });

    const [call] = ctx.fake.callsTo('CrmOrderCreate');
    const order = call.variables.order as Record<string, any>;
    expect(order.financialStatus).toBe('PENDING');
    expect(order.tags).toEqual(['crm', `crm-ref-${payload.idempotencyKey}`]);
    expect(order.customer).toEqual({ toUpsert: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' } });
    expect(order.billingAddress).toMatchObject({ countryCode: 'US', firstName: 'Ada', lastName: 'Lovelace' });
    expect(order.shippingAddress).toEqual(order.billingAddress); // defaults to billing
    expect(order.shippingLines[0].priceSet).toEqual({ shopMoney: { amount: '5.00', currencyCode: 'USD' } });
    expect((call.variables.options as Record<string, unknown>).sendReceipt).toBe(false);

    expect(await ctx.prisma.order.count()).toBe(1);
    const reqRow = await ctx.prisma.orderCreationRequest.findFirstOrThrow();
    expect(reqRow).toMatchObject({ status: 'SUCCEEDED', orderId: res.body.data.order.id });

    const list = await ctx.http().get('/api/orders').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.data.items[0].id).toBe(res.body.data.order.id);
  });

  it('associates an existing CRM customer by Shopify id', async () => {
    const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
    const customer = await ctx.prisma.customer.create({
      data: { storeId: store.id, shopifyCustomerId: 'gid://shopify/Customer/77', name: 'Ada Lovelace' },
    });
    await post(body({ customer: { existingCustomerId: customer.id, firstName: 'Ada', lastName: 'Lovelace' } })).expect(201);
    const order = ctx.fake.callsTo('CrmOrderCreate')[0].variables.order as Record<string, unknown>;
    expect(order.customer).toEqual({ toAssociate: { id: 'gid://shopify/Customer/77' } });
  });

  describe('validation', () => {
    it.each([
      ['no line items', { lineItems: [] }],
      ['invalid variant id', { lineItems: [{ variantId: '123', quantity: 1 }] }],
      ['zero quantity', { lineItems: [{ variantId: 'gid://shopify/ProductVariant/1', quantity: 0 }] }],
      ['invalid email', { customer: { firstName: 'A', lastName: 'B', email: 'nope' } }],
      ['missing customer name', { customer: { email: 'a@b.co' } }],
      ['bad country code', { billingAddress: { address1: 'x', city: 'y', countryCode: 'USA' } }],
      ['negative shipping', { shippingLine: { title: 'x', amount: '-1' } }],
      ['missing idempotency key', { idempotencyKey: undefined }],
    ])('rejects %s with 400 and does not call Shopify', async (_label, overrides) => {
      const res = await post(body(overrides)).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(ctx.fake.callsTo('CrmOrderCreate')).toHaveLength(0);
    });

    it('rejects duplicate variants', async () => {
      const v = { variantId: 'gid://shopify/ProductVariant/1', quantity: 1 };
      const res = await post(body({ lineItems: [v, v] })).expect(400);
      expect(res.body.error.code).toBe('DUPLICATE_LINE_ITEM');
    });

    it('rejects variants that are unavailable or missing in Shopify', async () => {
      const unavailable = await post(body({ lineItems: [{ variantId: 'gid://shopify/ProductVariant/999', quantity: 1 }] })).expect(422);
      expect(unavailable.body.error.code).toBe('PRODUCT_UNAVAILABLE');
      const missing = await post(body({ lineItems: [{ variantId: 'gid://shopify/ProductVariant/404', quantity: 1 }] })).expect(422);
      expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');
      expect(ctx.fake.callsTo('CrmOrderCreate')).toHaveLength(0);
      expect(await ctx.prisma.order.count()).toBe(0);
    });
  });

  describe('Shopify failures', () => {
    it('returns 422 with Shopify userErrors and creates nothing locally', async () => {
      ctx.fake.once('CrmOrderCreate', () =>
        json({ data: { orderCreate: { order: null, userErrors: [{ field: ['email'], message: 'Email is invalid', code: 'INVALID' }] } } }),
      );
      const res = await post(body()).expect(422);
      expect(res.body.error).toMatchObject({ code: 'SHOPIFY_VALIDATION_FAILED', message: 'Email is invalid' });
      expect(await ctx.prisma.order.count()).toBe(0);
      expect((await ctx.prisma.orderCreationRequest.findFirstOrThrow()).status).toBe('FAILED');
    });

    it('allows resubmitting a definitively failed request with the same key', async () => {
      const payload = body();
      ctx.fake.once('CrmOrderCreate', () => json({ errors: 'Invalid API key or access token' }, 401));
      await post(payload).expect(502);
      // reconnect (token valid again in the fake) and retry with the same key
      await ctx.prisma.shopifyStore.updateMany({ data: { connectionStatus: 'CONNECTED' } });
      const res = await post(payload).expect(201);
      expect(res.body.data.status).toBe('SUCCEEDED');
      expect(await ctx.prisma.order.count()).toBe(1);
    });

    it('does not retry orderCreate on a 5xx and reports UNKNOWN when Shopify has no order', async () => {
      ctx.fake.once('CrmOrderCreate', () => json({ errors: 'Internal error' }, 503));
      const res = await post(body()).expect(202);
      expect(res.body.data).toMatchObject({ status: 'UNKNOWN', order: null });
      expect(ctx.fake.callsTo('CrmOrderCreate')).toHaveLength(1); // never blindly retried
      expect(ctx.fake.callsTo('CrmOrders').length).toBeGreaterThan(0); // reconciliation lookup by tag
      expect(await ctx.prisma.order.count()).toBe(0); // no misleading local order
    });

    it('reconciles a request whose response was lost but Shopify created the order', async () => {
      ctx.fake.applyThen('CrmOrderCreate', () => json({ errors: 'Bad gateway' }, 502));
      const res = await post(body()).expect(201);
      expect(res.body.data.status).toBe('SUCCEEDED');
      expect(ctx.fake.orders).toHaveLength(1);
      expect(await ctx.prisma.order.count()).toBe(1);
    });

    it('handles timeouts: UNKNOWN first, then the background reconciler persists the order', async () => {
      // Shopify creates the order but the response never arrives (timeout)
      ctx.fake.once('CrmOrderCreate', async (init) => {
        ctx.fake.route('CrmOrderCreate', JSON.parse(init?.body as string).variables);
        return hang(init);
      });
      // ... and its search index has not caught up yet for the immediate lookup
      ctx.fake.once('CrmOrders', () => json({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }));

      const payload = body();
      const res = await post(payload).expect(202);
      expect(res.body.data.status).toBe('UNKNOWN');
      expect(await ctx.prisma.order.count()).toBe(0);

      // resubmitting the same key does not create a second Shopify order – it reconciles
      const again = await post(payload).expect(201);
      expect(again.body.data.status).toBe('SUCCEEDED');
      expect(ctx.fake.callsTo('CrmOrderCreate')).toHaveLength(1);
      expect(await ctx.prisma.order.count()).toBe(1);
    }, 20_000);

    it('marks an UNKNOWN request FAILED once Shopify still has no order after the grace period', async () => {
      ctx.fake.once('CrmOrderCreate', () => json({ errors: 'Internal error' }, 500));
      const res = await post(body()).expect(202);
      await ctx.prisma.orderCreationRequest.update({
        where: { id: res.body.data.requestId },
        data: { createdAt: new Date(Date.now() - 31 * 60_000) },
      });
      await ctx.app.get(OrderCreationService).reconcilePending();
      const row = await ctx.prisma.orderCreationRequest.findUniqueOrThrow({ where: { id: res.body.data.requestId } });
      expect(row.status).toBe('FAILED');
      expect(row.errorMessage).toContain('safe to submit it again');
    });
  });

  describe('duplicate submissions', () => {
    it('replays the original result for a repeated idempotency key', async () => {
      const payload = body();
      const first = await post(payload).expect(201);
      const second = await post(payload).expect(201);
      expect(second.body.data).toMatchObject({ status: 'SUCCEEDED', replayed: true });
      expect(second.body.data.order.id).toBe(first.body.data.order.id);
      expect(ctx.fake.callsTo('CrmOrderCreate')).toHaveLength(1);
    });

    it('rejects reuse of a key with a different payload', async () => {
      const payload = body();
      await post(payload).expect(201);
      const res = await post({ ...payload, note: 'changed' }).expect(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('creates exactly one Shopify order under concurrent double-submits', async () => {
      const payload = body();
      const results = await Promise.all(Array.from({ length: 5 }, () => post(payload)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
      expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
      expect(ctx.fake.callsTo('CrmOrderCreate')).toHaveLength(1);
      expect(await ctx.prisma.order.count()).toBe(1);
    });
  });
});
