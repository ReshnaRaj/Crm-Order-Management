import { Injectable, Logger } from '@nestjs/common';
import { OrderSource } from '@prisma/client';
import { CustomersRepository } from '../customers/customers.repository';
import { isUniqueViolation } from '../prisma/prisma.service';
import { NormalizedOrder } from '../shopify/integration/normalized-order';
import { OrdersRepository } from './orders.repository';

export type SyncAction = 'created' | 'updated' | 'skipped';

export interface SyncResult {
  action: SyncAction;
  orderId: string;
}

/**
 * Single entry point for persisting Shopify orders (import, sync, webhooks, CRM creation).
 * Guarantees:
 *  - one row per (store, Shopify order id) – enforced by a unique constraint
 *  - customer + order + line items written atomically in one transaction
 *  - out-of-order/stale updates (older `updated_at`) never overwrite newer data
 *  - concurrent writers for the same order serialise via a row lock, and a racing
 *    insert (unique violation) is retried as an update
 */
@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersRepository,
  ) {}

  async upsertFromShopify(storeId: string, order: NormalizedOrder, source: OrderSource): Promise<SyncResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.orders.transaction(async (tx) => {
          const existing = await this.orders.lockByShopifyId(tx, storeId, order.shopifyOrderId);

          if (
            existing?.shopifyUpdatedAt &&
            order.shopifyUpdatedAt &&
            order.shopifyUpdatedAt.getTime() < existing.shopifyUpdatedAt.getTime()
          ) {
            await this.orders.touchSynced(tx, existing.id);
            return { action: 'skipped' as const, orderId: existing.id };
          }

          const customer = order.customer
            ? await this.customers.upsertFromShopify(tx, storeId, order.customer, {
                billing: order.billingAddress,
                shipping: order.shippingAddress,
              })
            : null;

          const { id } = existing
            ? await this.orders.update(tx, existing.id, order, customer?.id ?? null)
            : await this.orders.create(tx, storeId, order, customer?.id ?? null, source);
          await this.orders.replaceItems(tx, id, order.lineItems);

          return { action: existing ? ('updated' as const) : ('created' as const), orderId: id };
        });
      } catch (e) {
        // Two writers inserted the same new order/customer concurrently: retry, which takes the update path.
        if (isUniqueViolation(e) && attempt < 3) {
          this.logger.debug({ event: 'order_sync.retry_unique', shopifyOrderId: order.shopifyOrderId, attempt });
          continue;
        }
        throw e;
      }
    }
  }
}
