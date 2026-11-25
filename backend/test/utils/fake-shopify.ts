/**
 * In-memory fake of the Shopify Admin API (OAuth token endpoint + GraphQL) that is
 * injected via the SHOPIFY_FETCH provider. Operation routing uses the GraphQL operation name.
 */
import { createHmac } from 'crypto';
import type { GqlLineItem, GqlOrder } from '../../src/shopify/integration/shopify-order.mapper';

type Handler = (init?: RequestInit) => Response | 'passthrough' | Promise<Response | 'passthrough'>;

export const SHOP = 'crm-test.myshopify.com';

let seq = 1000;

export function makeGqlOrder(overrides: Partial<GqlOrder> & { lineItemCount?: number } = {}): GqlOrder {
  const n = ++seq;
  const { lineItemCount = 1, ...rest } = overrides;
  const items: GqlLineItem[] = Array.from({ length: lineItemCount }, (_, i) => ({
    id: `gid://shopify/LineItem/${n}${i}`,
    name: `Widget ${i} - Blue`,
    title: `Widget ${i}`,
    variantTitle: 'Blue',
    sku: `SKU-${i}`,
    quantity: 2,
    product: { id: `gid://shopify/Product/${i + 1}` },
    variant: { id: `gid://shopify/ProductVariant/${i + 1}` },
    originalUnitPriceSet: { shopMoney: { amount: '10.00' } },
    totalDiscountSet: { shopMoney: { amount: '0.00' } },
    discountedTotalSet: { shopMoney: { amount: '20.00' } },
  }));
  return {
    id: `gid://shopify/Order/${n}`,
    name: `#${n}`,
    createdAt: new Date(Date.UTC(2026, 0, 1 + (n % 28))).toISOString(),
    processedAt: null,
    updatedAt: new Date(Date.UTC(2026, 0, 1 + (n % 28))).toISOString(),
    cancelledAt: null,
    closedAt: null,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    currencyCode: 'USD',
    email: `buyer${n}@example.com`,
    phone: null,
    note: null,
    tags: [],
    currentSubtotalPriceSet: { shopMoney: { amount: (20 * lineItemCount).toFixed(2) } },
    currentTotalTaxSet: { shopMoney: { amount: '0.00' } },
    currentTotalDiscountsSet: { shopMoney: { amount: '0.00' } },
    totalShippingPriceSet: { shopMoney: { amount: '0.00' } },
    currentTotalPriceSet: { shopMoney: { amount: (20 * lineItemCount).toFixed(2) } },
    customer: {
      id: `gid://shopify/Customer/${n}`,
      firstName: 'Ada',
      lastName: `Buyer${n}`,
      displayName: `Ada Buyer${n}`,
      defaultEmailAddress: { emailAddress: `buyer${n}@example.com` },
      defaultPhoneNumber: null,
    },
    billingAddress: { name: `Ada Buyer${n}`, address1: '1 Main St', city: 'Springfield', countryCodeV2: 'US', zip: '12345' },
    shippingAddress: null,
    lineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: items },
    ...rest,
  };
}

export class FakeShopify {
  orders: GqlOrder[] = [];
  /** extra line items returned via CrmOrderLineItems pagination, keyed by order id */
  extraLineItems = new Map<string, GqlLineItem[]>();
  webhooks: { id: string; topic: string; uri: string }[] = [];
  calls: { op: string; variables: Record<string, unknown> }[] = [];
  /** queued one-shot overrides per operation name */
  private overrides = new Map<string, Handler[]>();
  accessToken = 'shpat_fake_token';
  scopes = 'read_orders,write_orders,read_products,read_customers';
  pageSize = 10;

  reset() {
    this.orders = [];
    this.extraLineItems.clear();
    this.webhooks = [];
    this.calls = [];
    this.overrides.clear();
  }

  /** Queue a one-time response for an operation (e.g. 'CrmOrders', 'CrmOrderCreate', 'oauth'). */
  once(op: string, handler: Handler) {
    const list = this.overrides.get(op) ?? [];
    list.push(handler);
    this.overrides.set(op, list);
  }

  callsTo(op: string) {
    return this.calls.filter((c) => c.op === op);
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (url.endsWith('/admin/oauth/access_token')) {
      this.calls.push({ op: 'oauth', variables: body });
      const o = await this.override('oauth', init);
      if (o) return o;
      if (body.code === 'bad-code') return json({ error: 'invalid_request' }, 400);
      return json({ access_token: this.accessToken, scope: this.scopes });
    }

    const query = typeof body.query === 'string' ? body.query : '';
    const variables = (body.variables ?? {}) as Record<string, unknown>;
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'unknown';
    this.calls.push({ op, variables });

    const headers = new Headers(init?.headers);
    if (headers.get('X-Shopify-Access-Token') !== this.accessToken) {
      return json({ errors: '[API] Invalid API key or access token' }, 401);
    }
    const o = await this.override(op, init);
    if (o) return o;
    return this.route(op, variables);
  };

  private async override(op: string, init?: RequestInit): Promise<Response | null> {
    const list = this.overrides.get(op);
    const handler = list?.shift();
    if (!handler) return null;
    const r = await handler(init);
    return r === 'passthrough' ? null : r;
  }

  /** Executes `op` for real, then responds with `response` (simulates a lost/failed response after success). */
  applyThen(op: string, response: () => Response | Promise<Response>) {
    this.once(op, async (init) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { variables?: Record<string, unknown> };
      this.route(op, body.variables ?? {});
      return response();
    });
  }

  route(op: string, v: Record<string, unknown>): Response {
    switch (op) {
      case 'CrmShop':
        return gql({ shop: { id: 'gid://shopify/Shop/1', name: 'CRM Test Store', myshopifyDomain: SHOP, currencyCode: 'USD' } });

      case 'CrmWebhookSubscriptions':
        return gql({ webhookSubscriptions: { nodes: this.webhooks } });

      case 'CrmWebhookCreate': {
        const sub = v.webhookSubscription as { uri: string };
        const w = { id: `gid://shopify/WebhookSubscription/${this.webhooks.length + 1}`, topic: String(v.topic), uri: sub.uri };
        this.webhooks.push(w);
        return gql({ webhookSubscriptionCreate: { webhookSubscription: w, userErrors: [] } });
      }

      case 'CrmOrders': {
        let list = [...this.orders];
        const q = typeof v.query === 'string' ? v.query : '';
        const tag = /tag:"([^"]+)"/.exec(q)?.[1];
        if (tag) list = list.filter((o) => o.tags?.includes(tag));
        const since = /updated_at:>='([^']+)'/.exec(q)?.[1];
        if (since) list = list.filter((o) => (o.updatedAt ?? o.createdAt) >= since);
        const start = v.after ? Number(v.after) : 0;
        const first = Number(v.first ?? this.pageSize);
        const page = list.slice(start, start + first);
        const end = start + page.length;
        return gql({
          orders: {
            pageInfo: { hasNextPage: end < list.length, endCursor: page.length ? String(end) : null },
            nodes: page,
          },
        });
      }

      case 'CrmOrderLineItems': {
        const items = this.extraLineItems.get(String(v.id)) ?? [];
        return gql({ order: { lineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: items } } });
      }

      case 'CrmOrder':
        return gql({ order: this.orders.find((o) => o.id === v.id) ?? null });

      case 'CrmOrderCreate': {
        const input = v.order as {
          lineItems: { variantId: string; quantity: number }[];
          email?: string;
          tags?: string[];
          currency?: string;
          customer?: { toUpsert?: { firstName?: string; lastName?: string; email?: string } };
        };
        if (!input.lineItems?.length) {
          return gql({ orderCreate: { order: null, userErrors: [{ field: ['lineItems'], message: 'Line items are required', code: 'INVALID' }] } });
        }
        const order = makeGqlOrder({
          email: input.email ?? null,
          tags: input.tags ?? [],
          displayFinancialStatus: 'PENDING',
          currencyCode: input.currency ?? 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        order.lineItems.nodes = input.lineItems.map((li, i) => ({
          id: `gid://shopify/LineItem/c${seq}${i}`,
          name: `Variant ${li.variantId}`,
          title: `Product for ${li.variantId}`,
          variantTitle: 'Default',
          sku: null,
          quantity: li.quantity,
          product: { id: 'gid://shopify/Product/1' },
          variant: { id: li.variantId },
          originalUnitPriceSet: { shopMoney: { amount: '12.50' } },
          totalDiscountSet: { shopMoney: { amount: '0.00' } },
          discountedTotalSet: { shopMoney: { amount: (12.5 * li.quantity).toFixed(2) } },
        }));
        const total = (12.5 * input.lineItems.reduce((s, l) => s + l.quantity, 0)).toFixed(2);
        order.currentSubtotalPriceSet = { shopMoney: { amount: total } };
        order.currentTotalPriceSet = { shopMoney: { amount: total } };
        this.orders.push(order);
        return gql({ orderCreate: { order, userErrors: [] } });
      }

      case 'CrmProducts':
        return gql({
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'gid://shopify/Product/1',
                title: 'Widget',
                status: 'ACTIVE',
                featuredMedia: null,
                variants: {
                  nodes: [
                    { id: 'gid://shopify/ProductVariant/1', title: 'Blue', displayName: 'Widget - Blue', sku: 'W-B', price: '12.50', inventoryQuantity: 5, availableForSale: true },
                  ],
                },
              },
            ],
          },
        });

      case 'CrmVariants': {
        const ids = (v.ids as string[]) ?? [];
        return gql({
          nodes: ids.map((id) =>
            id.endsWith('/404')
              ? null
              : { id, title: 'Blue', displayName: 'Widget - Blue', sku: 'W-B', price: '12.50', inventoryQuantity: 5, availableForSale: !id.endsWith('/999'), product: { title: 'Widget' } },
          ),
        });
      }

      default:
        return json({ errors: [{ message: `FakeShopify: unhandled operation ${op}` }] }, 400);
    }
  }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export const gql = (data: unknown) =>
  json({
    data,
    extensions: { cost: { requestedQueryCost: 10, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1990, restoreRate: 100 } } },
  });

export const throttled = () =>
  json({
    errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
    extensions: { cost: { requestedQueryCost: 100, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 0, restoreRate: 100 } } },
  });


/** Builds a valid OAuth callback query signed with the app secret. */
export function signedCallbackQuery(params: Record<string, string>, secret: string) {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return { ...params, hmac: createHmac('sha256', secret).update(message).digest('hex') };
}

/** Never responds; rejects once the client's AbortController fires (request timeout). */
export const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
