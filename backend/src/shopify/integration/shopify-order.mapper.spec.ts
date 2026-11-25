import { GqlOrder, mapGqlOrder, mapRestOrder, normaliseRestFulfillment } from './shopify-order.mapper';

const money = (amount: string) => ({ shopMoney: { amount } });

const gqlOrder = (o: Partial<GqlOrder> = {}): GqlOrder => ({
  id: 'gid://shopify/Order/1',
  name: '#1001',
  createdAt: '2026-01-01T00:00:00Z',
  processedAt: '2025-12-31T23:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  currencyCode: 'CAD',
  displayFinancialStatus: 'PARTIALLY_REFUNDED',
  displayFulfillmentStatus: 'PARTIALLY_FULFILLED',
  currentSubtotalPriceSet: money('100.00'),
  currentTotalTaxSet: money('13.00'),
  currentTotalDiscountsSet: money('5.00'),
  totalShippingPriceSet: money('7.50'),
  currentTotalPriceSet: money('115.50'),
  customer: { id: 'gid://shopify/Customer/9', firstName: ' Marie ', lastName: 'Curie', defaultEmailAddress: { emailAddress: 'm@c.fr' } },
  billingAddress: { name: 'Marie Curie', city: 'Paris', countryCodeV2: 'FR', company: null },
  shippingAddress: null,
  lineItems: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [
      {
        id: 'gid://shopify/LineItem/5',
        name: 'Radium - Glow',
        title: 'Radium',
        variantTitle: 'Glow',
        sku: '',
        quantity: 3,
        product: { id: 'gid://shopify/Product/2' },
        variant: null,
        originalUnitPriceSet: money('35.00'),
        totalDiscountSet: money('5.00'),
        discountedTotalSet: money('100.00'),
      },
    ],
  },
  ...o,
});

describe('mapGqlOrder', () => {
  it('maps totals, statuses, customer and items', () => {
    const o = mapGqlOrder(gqlOrder());
    expect(o).toMatchObject({
      shopifyOrderId: 'gid://shopify/Order/1',
      orderNumber: '#1001',
      orderStatus: 'OPEN',
      financialStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'PARTIALLY_FULFILLED',
      currency: 'CAD',
      subtotal: '100',
      totalTax: '13',
      totalDiscount: '5',
      shippingAmount: '7.5',
      totalAmount: '115.5',
      email: 'm@c.fr',
      customerName: 'Marie Curie',
      customer: { shopifyCustomerId: 'gid://shopify/Customer/9', firstName: 'Marie', email: 'm@c.fr', phone: null },
      billingAddress: { name: 'Marie Curie', city: 'Paris', countryCode: 'FR' },
      shippingAddress: null,
    });
    expect(o.orderDate.toISOString()).toBe('2025-12-31T23:00:00.000Z'); // processedAt preferred
    expect(o.lineItems[0]).toEqual({
      shopifyLineItemId: 'gid://shopify/LineItem/5',
      shopifyProductId: 'gid://shopify/Product/2',
      shopifyVariantId: null, // deleted variant
      productName: 'Radium',
      variantName: 'Glow',
      sku: null,
      quantity: 3,
      unitPrice: '35',
      totalDiscount: '5',
      totalPrice: '100',
    });
  });

  it('derives CANCELLED / CLOSED status', () => {
    expect(mapGqlOrder(gqlOrder({ cancelledAt: '2026-01-03T00:00:00Z', closedAt: '2026-01-04T00:00:00Z' })).orderStatus).toBe('CANCELLED');
    expect(mapGqlOrder(gqlOrder({ closedAt: '2026-01-04T00:00:00Z' })).orderStatus).toBe('CLOSED');
  });

  it('handles orders without customer or money fields', () => {
    const o = mapGqlOrder(gqlOrder({ customer: null, billingAddress: null, currentTotalPriceSet: null, email: null }));
    expect(o.customer).toBeNull();
    expect(o.customerName).toBeNull();
    expect(o.totalAmount).toBe('0');
  });

  it('appends paginated extra line items', () => {
    const base = gqlOrder();
    const o = mapGqlOrder(base, [{ ...base.lineItems.nodes[0], id: 'gid://shopify/LineItem/6' }]);
    expect(o.lineItems.map((l) => l.shopifyLineItemId)).toEqual(['gid://shopify/LineItem/5', 'gid://shopify/LineItem/6']);
  });
});

describe('mapRestOrder (webhook payloads)', () => {
  it('builds GIDs from numeric ids and splits tags', () => {
    const o = mapRestOrder({
      id: 42,
      name: '#42',
      created_at: '2026-02-01T00:00:00Z',
      currency: 'usd',
      financial_status: 'paid',
      fulfillment_status: 'partial',
      total_price: '10.00',
      tags: 'a, b ,,c',
      customer: { id: 7, first_name: 'Linus' },
      line_items: [{ id: 3, product_id: 4, variant_id: null, title: 'T', quantity: 2, price: '5.00', total_discount: '1.00' }],
    });
    expect(o).toMatchObject({
      shopifyOrderId: 'gid://shopify/Order/42',
      currency: 'USD',
      financialStatus: 'PAID',
      fulfillmentStatus: 'PARTIALLY_FULFILLED',
      totalAmount: '10',
      tags: ['a', 'b', 'c'],
      customer: { shopifyCustomerId: 'gid://shopify/Customer/7', name: 'Linus' },
    });
    expect(o.lineItems[0]).toMatchObject({
      shopifyLineItemId: 'gid://shopify/LineItem/3',
      shopifyProductId: 'gid://shopify/Product/4',
      shopifyVariantId: null,
      totalPrice: '9',
    });
  });

  it('throws on payloads without an id', () => {
    expect(() => mapRestOrder({} as never)).toThrow('missing an id');
  });

  it.each([
    [null, 'UNFULFILLED'],
    ['partial', 'PARTIALLY_FULFILLED'],
    ['fulfilled', 'FULFILLED'],
    ['restocked', 'RESTOCKED'],
  ])('normalises fulfillment_status %p -> %s', (input, expected) => {
    expect(normaliseRestFulfillment(input)).toBe(expected);
  });
});
