import { Injectable } from '@nestjs/common';
import {
  ORDER_BY_ID_QUERY,
  ORDER_CREATE_MUTATION,
  ORDER_LINE_ITEMS_QUERY,
  ORDERS_PER_PAGE,
  ORDERS_QUERY,
} from './graphql/queries';
import { NormalizedOrder } from './normalized-order';
import { ShopifyCredentials, ShopifyGraphQLClient } from './shopify.client';
import { ShopifyUserError, ShopifyUserErrorItem } from './shopify.errors';
import { GqlLineItem, GqlOrder, mapGqlOrder } from './shopify-order.mapper';

export interface OrdersPage {
  orders: NormalizedOrder[];
  hasNextPage: boolean;
  endCursor: string | null;
}

interface Connection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

/** Input accepted by `orderCreate` (subset used by the CRM). */
export interface ShopifyOrderCreateInput {
  currency?: string;
  email?: string;
  phone?: string;
  financialStatus?: 'PENDING';
  customer?:
    | { toAssociate: { id: string } }
    | { toUpsert: { email?: string; firstName?: string; lastName?: string; phone?: string } };
  billingAddress?: Record<string, string | undefined>;
  shippingAddress?: Record<string, string | undefined>;
  lineItems: { variantId: string; quantity: number }[];
  shippingLines?: {
    title: string;
    priceSet: { shopMoney: { amount: string; currencyCode: string } };
  }[];
  discountCode?: {
    itemFixedDiscountCode: {
      code: string;
      amountSet: { shopMoney: { amount: string; currencyCode: string } };
    };
  };
  note?: string;
  tags: string[];
  sourceIdentifier?: string;
}

/** Order-related Shopify Admin API operations. */
@Injectable()
export class ShopifyOrdersApi {
  constructor(private readonly client: ShopifyGraphQLClient) {}

  /**
   * Fetches one page of orders (cursor pagination). `updatedSince` narrows to
   * incrementally changed orders.
   */
  async fetchOrdersPage(
    creds: ShopifyCredentials,
    after: string | null,
    updatedSince?: Date,
  ): Promise<OrdersPage> {
    const query = updatedSince ? `updated_at:>='${updatedSince.toISOString()}'` : undefined;
    const data = await this.client.request<{ orders: Connection<GqlOrder> }>(creds, ORDERS_QUERY, {
      first: ORDERS_PER_PAGE,
      after,
      query,
    });
    const orders: NormalizedOrder[] = [];
    for (const node of data.orders.nodes) {
      orders.push(await this.complete(creds, node));
    }
    return {
      orders,
      hasNextPage: data.orders.pageInfo.hasNextPage,
      endCursor: data.orders.pageInfo.endCursor,
    };
  }

  async fetchOrder(creds: ShopifyCredentials, id: string): Promise<NormalizedOrder | null> {
    const data = await this.client.request<{ order: GqlOrder | null }>(creds, ORDER_BY_ID_QUERY, { id });
    return data.order ? this.complete(creds, data.order) : null;
  }

  /** Looks up an order by tag (used to reconcile CRM submissions with unknown outcome). */
  async findOrderByTag(creds: ShopifyCredentials, tag: string): Promise<NormalizedOrder | null> {
    const data = await this.client.request<{ orders: Connection<GqlOrder> }>(creds, ORDERS_QUERY, {
      first: 1,
      after: null,
      query: `tag:"${tag.replace(/"/g, '')}"`,
    });
    const node = data.orders.nodes[0];
    return node ? this.complete(creds, node) : null;
  }

  /**
   * Creates an order. Never retried on uncertain outcomes (timeouts/5xx) – callers must
   * reconcile instead, otherwise a duplicate order could be created.
   */
  async createOrder(creds: ShopifyCredentials, input: ShopifyOrderCreateInput): Promise<NormalizedOrder> {
    const data = await this.client.request<{
      orderCreate: { order: GqlOrder | null; userErrors: ShopifyUserErrorItem[] };
    }>(
      creds,
      ORDER_CREATE_MUTATION,
      { order: input, options: { sendReceipt: false, sendFulfillmentReceipt: false } },
      { retryUnknownOutcome: false },
    );
    const { order, userErrors } = data.orderCreate;
    if (userErrors?.length || !order) {
      throw new ShopifyUserError(userErrors?.length ? userErrors : [{ message: 'Shopify returned no order' }]);
    }
    return this.complete(creds, order);
  }

  /** Follows line-item pagination for orders with more items than fit in the first page. */
  private async complete(creds: ShopifyCredentials, order: GqlOrder): Promise<NormalizedOrder> {
    const extra: GqlLineItem[] = [];
    let pageInfo = order.lineItems.pageInfo;
    while (pageInfo.hasNextPage) {
      const data = await this.client.request<{ order: { lineItems: Connection<GqlLineItem> } | null }>(
        creds,
        ORDER_LINE_ITEMS_QUERY,
        { id: order.id, after: pageInfo.endCursor },
      );
      if (!data.order) break;
      extra.push(...data.order.lineItems.nodes);
      pageInfo = data.order.lineItems.pageInfo;
    }
    return mapGqlOrder(order, extra);
  }
}
