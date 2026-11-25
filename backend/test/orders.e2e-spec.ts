import { OrderSyncService } from '../src/orders/order-sync.service';
import { mapGqlOrder } from '../src/shopify/integration/shopify-order.mapper';
import { makeGqlOrder } from './utils/fake-shopify';
import { connectStore, createShopifyTestApp, ShopifyTestContext } from './utils/shopify-test-app';
import { resetDatabase } from './utils/test-app';

describe('Orders API (e2e)', () => {
  let ctx: ShopifyTestContext;
  let token: string;

  const get = (path: string, query: Record<string, unknown> = {}) =>
    ctx.http().get(path).query(query).set('Authorization', `Bearer ${token}`);

  /** Seeds 25 orders with deterministic dates, totals, names and statuses. */
  async function seed() {
    const store = await ctx.prisma.shopifyStore.findFirstOrThrow();
    const sync = ctx.app.get(OrderSyncService);
    for (let i = 1; i <= 25; i++) {
      const gql = makeGqlOrder({
        name: `#${2000 + i}`,
        createdAt: new Date(Date.UTC(2026, 0, i, 12)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 0, i, 12)).toISOString(),
        currentTotalPriceSet: { shopMoney: { amount: (i * 10).toFixed(2) } },
        displayFulfillmentStatus: i % 5 === 0 ? 'FULFILLED' : 'UNFULFILLED',
        cancelledAt: i === 7 ? new Date(Date.UTC(2026, 0, 8)).toISOString() : null,
        customer: {
          id: `gid://shopify/Customer/${i}`,
          firstName: i <= 3 ? 'Grace' : 'Alan',
          lastName: i <= 3 ? `Hopper${i}` : `Turing${i}`,
          defaultEmailAddress: { emailAddress: `c${i}@example.com` },
        },
      });
      await sync.upsertFromShopify(store.id, mapGqlOrder(gql), 'SHOPIFY_IMPORT');
    }
  }

  beforeAll(async () => {
    ctx = await createShopifyTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.fake.reset();
    ({ token } = await connectStore(ctx));
    await seed();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('requires authentication', async () => {
    await ctx.http().get('/api/orders').expect(401);
  });

  describe('listing & pagination', () => {
    it('returns the first page with metadata, newest first by default', async () => {
      const res = await get('/api/orders', { pageSize: 10 }).expect(200);
      const { items, meta } = res.body.data;
      expect(items).toHaveLength(10);
      expect(meta).toEqual({ page: 1, pageSize: 10, totalItems: 25, totalPages: 3, hasNextPage: true, hasPreviousPage: false });
      expect(items[0].orderNumber).toBe('#2025');
      expect(items[0]).toMatchObject({ customerName: 'Alan Turing25', currency: 'USD', totalAmount: '250.00' });
    });

    it('returns the last partial page', async () => {
      const res = await get('/api/orders', { pageSize: 10, page: 3 }).expect(200);
      expect(res.body.data.items).toHaveLength(5);
      expect(res.body.data.meta).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
    });

    it('returns an empty page beyond the end', async () => {
      const res = await get('/api/orders', { pageSize: 10, page: 9 }).expect(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.meta.totalItems).toBe(25);
    });

    it('keeps filters applied across pages', async () => {
      const p1 = await get('/api/orders', { search: 'turing', pageSize: 10, page: 1 }).expect(200);
      const p3 = await get('/api/orders', { search: 'turing', pageSize: 10, page: 3 }).expect(200);
      expect(p1.body.data.meta.totalItems).toBe(22);
      expect(p3.body.data.items).toHaveLength(2);
      expect(p3.body.data.items.every((o: { customerName: string }) => o.customerName.includes('Turing'))).toBe(true);
    });
  });

  describe('search', () => {
    it('matches partial order numbers with or without #', async () => {
      const a = await get('/api/orders', { search: '2012' }).expect(200);
      expect(a.body.data.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(['#2012']);
      const b = await get('/api/orders', { search: '#201' }).expect(200);
      expect(b.body.data.meta.totalItems).toBe(10); // #2010-#2019
    });

    it('matches customer names case-insensitively and partially', async () => {
      const res = await get('/api/orders', { search: 'hOpP' }).expect(200);
      expect(res.body.data.meta.totalItems).toBe(3);
    });

    it('returns an empty result for no matches', async () => {
      const res = await get('/api/orders', { search: 'nobody-here' }).expect(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.meta).toMatchObject({ totalItems: 0, totalPages: 1 });
    });
  });

  describe('filters', () => {
    it('filters by order status', async () => {
      const res = await get('/api/orders', { orderStatus: 'CANCELLED' }).expect(200);
      expect(res.body.data.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(['#2007']);
    });

    it('filters by fulfillment status (case-insensitive input)', async () => {
      const res = await get('/api/orders', { fulfillmentStatus: 'fulfilled' }).expect(200);
      expect(res.body.data.meta.totalItems).toBe(5);
    });

    it('filters by date range (inclusive, date-only end covers the whole day)', async () => {
      const res = await get('/api/orders', { dateFrom: '2026-01-10', dateTo: '2026-01-12', sortOrder: 'asc' }).expect(200);
      expect(res.body.data.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(['#2010', '#2011', '#2012']);
    });

    it('supports open-ended start / end dates', async () => {
      const from = await get('/api/orders', { dateFrom: '2026-01-21' }).expect(200);
      expect(from.body.data.meta.totalItems).toBe(5);
      const to = await get('/api/orders', { dateTo: '2026-01-02' }).expect(200);
      expect(to.body.data.meta.totalItems).toBe(2);
    });

    it('combines filters and search', async () => {
      const res = await get('/api/orders', { fulfillmentStatus: 'FULFILLED', search: 'turing', dateTo: '2026-01-15' }).expect(200);
      expect(res.body.data.items.map((o: { orderNumber: string }) => o.orderNumber).sort()).toEqual(['#2005', '#2010', '#2015']);
    });

    it('rejects an inverted date range', async () => {
      const res = await get('/api/orders', { dateFrom: '2026-02-01', dateTo: '2026-01-01' }).expect(400);
      expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
    });

    it('validates query parameters', async () => {
      const res = await get('/api/orders', { pageSize: 1000, sortBy: 'name', dateFrom: 'yesterday' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('sorting', () => {
    it('sorts by total amount ascending and descending', async () => {
      const asc = await get('/api/orders', { sortBy: 'totalAmount', sortOrder: 'asc', pageSize: 3 }).expect(200);
      expect(asc.body.data.items.map((o: { totalAmount: string }) => o.totalAmount)).toEqual(['10.00', '20.00', '30.00']);
      const desc = await get('/api/orders', { sortBy: 'totalAmount', sortOrder: 'desc', pageSize: 3 }).expect(200);
      expect(desc.body.data.items.map((o: { totalAmount: string }) => o.totalAmount)).toEqual(['250.00', '240.00', '230.00']);
    });

    it('sorts by order date ascending', async () => {
      const res = await get('/api/orders', { sortBy: 'orderDate', sortOrder: 'asc', pageSize: 2 }).expect(200);
      expect(res.body.data.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(['#2001', '#2002']);
    });
  });

  describe('details', () => {
    it('returns full order, customer, items and payment details', async () => {
      const list = await get('/api/orders', { search: '2003' }).expect(200);
      const res = await get(`/api/orders/${list.body.data.items[0].id}`).expect(200);
      const o = res.body.data;
      expect(o).toMatchObject({
        orderNumber: '#2003',
        orderStatus: 'OPEN',
        fulfillmentStatus: 'UNFULFILLED',
        financialStatus: 'PAID',
        customer: { name: 'Grace Hopper3', email: expect.stringContaining('@example.com') },
        payment: { totalAmount: '30.00', currency: 'USD', subtotal: '20.00', totalTax: '0.00' },
      });
      expect(o.shopifyOrderId).toMatch(/^gid:\/\/shopify\/Order\//);
      expect(o.items[0]).toMatchObject({ quantity: 2, unitPrice: '10.00', totalPrice: '20.00', sku: 'SKU-0' });
      expect(o.billingAddress).toMatchObject({ city: 'Springfield', countryCode: 'US' });
      expect(o.shippingAddress).toBeNull();
    });

    it('returns 404 for an unknown order', async () => {
      const res = await get('/api/orders/7f1c1f7e-0000-4000-8000-000000000000').expect(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('returns 400 for a malformed id', async () => {
      await get('/api/orders/not-a-uuid').expect(400);
    });
  });

  describe('summary', () => {
    it('computes dashboard metrics from the database', async () => {
      const res = await get('/api/orders/summary').expect(200);
      const s = res.body.data;
      expect(s.totalOrders).toBe(25);
      expect(s.fulfilledOrders).toBe(5);
      expect(s.cancelledOrders).toBe(1);
      expect(s.pendingOrders).toBe(19); // 25 - 5 fulfilled - 1 cancelled
      // sum(10..250 step 10) = 3250, minus cancelled #2007 (70)
      expect(s.totalSales).toEqual([{ currency: 'USD', amount: '3180.00', orders: 24 }]);
      expect(s.recentOrders).toHaveLength(5);
      expect(s.recentOrders[0].orderNumber).toBe('#2025');
    });

    it('lists distinct statuses for filters', async () => {
      const res = await get('/api/orders/filters').expect(200);
      expect(res.body.data).toEqual({ fulfillment: ['FULFILLED', 'UNFULFILLED'], financial: ['PAID'] });
    });
  });
});
