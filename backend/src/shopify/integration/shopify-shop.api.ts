import { Injectable, Logger } from '@nestjs/common';
import {
  SHOP_QUERY,
  WEBHOOK_SUBSCRIPTION_CREATE,
  WEBHOOK_SUBSCRIPTIONS_QUERY,
} from './graphql/queries';
import { ShopifyCredentials, ShopifyGraphQLClient } from './shopify.client';
import { ShopifyUserError, ShopifyUserErrorItem } from './shopify.errors';

export interface ShopInfo {
  id: string;
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
}

export interface WebhookRegistration {
  topic: string;
  uri: string;
}

export interface WebhookRegistrationResult {
  created: string[];
  existing: string[];
}

/** Shop metadata and webhook subscription management. */
@Injectable()
export class ShopifyShopApi {
  private readonly logger = new Logger(ShopifyShopApi.name);

  constructor(private readonly client: ShopifyGraphQLClient) {}

  async getShop(creds: ShopifyCredentials): Promise<ShopInfo> {
    const data = await this.client.request<{ shop: ShopInfo }>(creds, SHOP_QUERY);
    return data.shop;
  }

  /** Idempotently ensures the given webhook subscriptions exist (shop-scoped, created via Admin API). */
  async ensureWebhooks(
    creds: ShopifyCredentials,
    wanted: WebhookRegistration[],
  ): Promise<WebhookRegistrationResult> {
    const data = await this.client.request<{
      webhookSubscriptions: { nodes: { id: string; topic: string; uri: string }[] };
    }>(creds, WEBHOOK_SUBSCRIPTIONS_QUERY, { topics: wanted.map((w) => w.topic) });
    const existing = data.webhookSubscriptions.nodes;
    const result: WebhookRegistrationResult = { created: [], existing: [] };

    for (const w of wanted) {
      if (existing.some((e) => e.topic === w.topic && e.uri === w.uri)) {
        result.existing.push(w.topic);
        continue;
      }
      const res = await this.client.request<{
        webhookSubscriptionCreate: { userErrors: ShopifyUserErrorItem[] };
      }>(creds, WEBHOOK_SUBSCRIPTION_CREATE, {
        topic: w.topic,
        webhookSubscription: { uri: w.uri, format: 'JSON' },
      });
      const errors = res.webhookSubscriptionCreate.userErrors;
      if (errors.length) throw new ShopifyUserError(errors);
      result.created.push(w.topic);
      this.logger.log({ event: 'shopify.webhook_registered', shop: creds.shopDomain, topic: w.topic });
    }
    return result;
  }
}
