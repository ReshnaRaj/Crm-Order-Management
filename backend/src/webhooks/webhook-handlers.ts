import { Injectable } from '@nestjs/common';
import { OrderSource, WebhookEvent } from '@prisma/client';
import { OrderSyncService } from '../orders/order-sync.service';
import { mapRestOrder, RestOrderPayload } from '../shopify/integration/shopify-order.mapper';
import { ShopifyStoreRepository } from '../shopify/integration/shopify-store.repository';

/** A processing error that retrying cannot fix (bad payload, etc.). */
export class PermanentWebhookError extends Error {}

export type HandlerOutcome = { status: 'processed' } | { status: 'skipped'; reason: string };

/** Strategy per webhook topic – new topics are added by registering another handler (OCP). */
export interface WebhookTopicHandler {
  readonly topics: readonly string[];
  handle(event: WebhookEvent): Promise<HandlerOutcome>;
}

@Injectable()
export class OrderWebhookHandler implements WebhookTopicHandler {
  readonly topics = ['orders/create', 'orders/updated'] as const;

  constructor(private readonly orderSync: OrderSyncService) {}

  async handle(event: WebhookEvent): Promise<HandlerOutcome> {
    if (!event.storeId) return { status: 'skipped', reason: `Unknown shop ${event.shopDomain}` };
    let order;
    try {
      order = mapRestOrder(event.payload as unknown as RestOrderPayload);
    } catch (e) {
      throw new PermanentWebhookError(`Invalid order payload: ${(e as Error).message}`);
    }
    // orders/create and orders/updated are handled identically: an idempotent upsert
    // keyed on (store, Shopify order id) that ignores payloads older than what we have.
    await this.orderSync.upsertFromShopify(event.storeId, order, OrderSource.WEBHOOK);
    return { status: 'processed' };
  }
}

@Injectable()
export class AppUninstalledWebhookHandler implements WebhookTopicHandler {
  readonly topics = ['app/uninstalled'] as const;

  constructor(private readonly stores: ShopifyStoreRepository) {}

  async handle(event: WebhookEvent): Promise<HandlerOutcome> {
    await this.stores.markDisconnectedByDomain(event.shopDomain, 'App was uninstalled from the Shopify store');
    return { status: 'processed' };
  }
}

export const WEBHOOK_TOPIC_HANDLERS = Symbol('WEBHOOK_TOPIC_HANDLERS');
