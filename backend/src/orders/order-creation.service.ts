import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderCreationRequest, OrderCreationStatus, OrderSource, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AppException } from '../common/utils/app.exception';
import { CustomersRepository } from '../customers/customers.repository';
import { isUniqueViolation } from '../prisma/prisma.service';
import { NormalizedOrder } from '../shopify/integration/normalized-order';
import { ShopifyError } from '../shopify/integration/shopify.errors';
import { ShopifyOrderCreateInput, ShopifyOrdersApi } from '../shopify/integration/shopify-orders.api';
import { ShopifyProductsApi } from '../shopify/integration/shopify-products.api';
import { ShopifyStoreContextService, StoreContext } from '../shopify/integration/shopify-store-context.service';
import { AddressDto, CreateOrderDto } from './dto/create-order.dto';
import { OrderDetailsDto } from './dto/order-response.dto';
import { OrderSyncService } from './order-sync.service';
import { OrderCreationRepository } from './order-creation.repository';
import { OrdersService } from './orders.service';

export const CRM_TAG = 'crm';
export const crmRefTag = (key: string) => `crm-ref-${key}`;

/** After this long without finding the order in Shopify we conclude it was never created. */
const GIVE_UP_AFTER_MS = 30 * 60_000;
const STALE_PENDING_MS = 5 * 60_000;
const MAX_RECONCILE_ATTEMPTS = 15;

export interface OrderCreationResult {
  requestId: string;
  status: OrderCreationStatus;
  /** true when the response is a replay of an earlier successful request with the same key */
  replayed: boolean;
  order: OrderDetailsDto | null;
  message: string;
}

/**
 * CRM → Shopify order creation with idempotency and reconciliation.
 *
 * Invariants:
 *  - a local Order row exists only for orders Shopify confirmed (never a "phantom" order)
 *  - the same idempotency key never produces two Shopify orders
 *  - the non-idempotent orderCreate mutation is never auto-retried when its outcome is
 *    unknown; instead the request is marked UNKNOWN and reconciled by searching Shopify
 *    for the unique `crm-ref-<key>` tag attached to every CRM-created order.
 */
@Injectable()
export class OrderCreationService {
  private readonly logger = new Logger(OrderCreationService.name);

  constructor(
    private readonly requests: OrderCreationRepository,
    private readonly context: ShopifyStoreContextService,
    private readonly ordersApi: ShopifyOrdersApi,
    private readonly productsApi: ShopifyProductsApi,
    private readonly customers: CustomersRepository,
    private readonly orderSync: OrderSyncService,
    private readonly orders: OrdersService,
  ) {}

  async create(userId: string, dto: CreateOrderDto, idempotencyHeader?: string): Promise<OrderCreationResult> {
    const key = (idempotencyHeader?.trim() || dto.idempotencyKey).toLowerCase();
    const { idempotencyKey: _ignored, ...payload } = dto;
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    const existing = await this.requests.findByKey(key);
    if (existing) return this.handleRepeat(existing, payloadHash);

    const ctx = await this.context.getActive();
    this.assertUniqueVariants(dto);

    let request: OrderCreationRequest;
    try {
      request = await this.requests.create({
        idempotencyKey: key,
        userId,
        storeId: ctx.store.id,
        requestPayload: payload as unknown as Prisma.InputJsonValue,
        payloadHash,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw this.inProgress(); // concurrent double-submit
      throw e;
    }
    return this.submit(request, dto, ctx);
  }

  async getRequest(id: string) {
    const r = await this.requests.findById(id);
    if (!r) throw new AppException('NOT_FOUND', 'Order creation request not found', HttpStatus.NOT_FOUND);
    return {
      id: r.id,
      status: r.status,
      shopifyOrderId: r.shopifyOrderId,
      orderId: r.orderId,
      errorMessage: r.errorMessage,
      attempts: r.attempts,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async reconcileById(id: string): Promise<OrderCreationResult> {
    const r = await this.requests.findById(id);
    if (!r) throw new AppException('NOT_FOUND', 'Order creation request not found', HttpStatus.NOT_FOUND);
    if (r.status === OrderCreationStatus.SUCCEEDED || r.status === OrderCreationStatus.FAILED) {
      return this.resultFor(r, false);
    }
    return this.reconcile(r);
  }

  /** Background reconciliation for UNKNOWN / abandoned PENDING requests. */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePending(): Promise<void> {
    const due = await this.requests.findReconcilable(new Date(Date.now() - STALE_PENDING_MS), MAX_RECONCILE_ATTEMPTS);
    for (const r of due) {
      try {
        await this.reconcile(r);
      } catch (e) {
        this.logger.warn({ event: 'order_create.reconcile_error', requestId: r.id, error: (e as Error).message });
      }
    }
  }

  // ─────────────────────────────── internals ───────────────────────────────

  private async handleRepeat(r: OrderCreationRequest, payloadHash: string): Promise<OrderCreationResult> {
    if (r.payloadHash !== payloadHash) {
      throw new AppException(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used for a different order',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    switch (r.status) {
      case OrderCreationStatus.SUCCEEDED:
        return this.resultFor(r, true);
      case OrderCreationStatus.PENDING:
        throw this.inProgress();
      case OrderCreationStatus.UNKNOWN:
        return this.reconcile(r);
      case OrderCreationStatus.FAILED: {
        // Shopify definitively did not create the order, so a retry with the same key is safe.
        if (!(await this.requests.claim(r.id, [OrderCreationStatus.FAILED]))) throw this.inProgress();
        const ctx = await this.context.getActive();
        const dto = { ...(r.requestPayload as object), idempotencyKey: r.idempotencyKey } as CreateOrderDto;
        return this.submit(r, dto, ctx);
      }
    }
  }

  private async submit(request: OrderCreationRequest, dto: CreateOrderDto, ctx: StoreContext): Promise<OrderCreationResult> {
    let input: ShopifyOrderCreateInput;
    try {
      input = await this.buildInput(request.idempotencyKey, dto, ctx);
    } catch (e) {
      await this.fail(request, e instanceof AppException ? e.message : 'Invalid order data');
      await this.context.handleFailure(ctx.store, e);
      throw this.context.toHttpException(e);
    }

    let created: NormalizedOrder;
    try {
      created = await this.ordersApi.createOrder(ctx.creds, input);
    } catch (e) {
      await this.context.handleFailure(ctx.store, e);
      if (e instanceof ShopifyError && e.outcomeUnknown) {
        this.logger.warn({ event: 'order_create.outcome_unknown', requestId: request.id, reason: e.code });
        await this.requests.update(request.id, { status: OrderCreationStatus.UNKNOWN, errorMessage: e.message });
        // One immediate reconciliation attempt; the cron keeps trying afterwards.
        return this.reconcile({ ...request, status: OrderCreationStatus.UNKNOWN });
      }
      await this.fail(request, e instanceof ShopifyError ? e.message : 'Unexpected error');
      if (!(e instanceof ShopifyError)) throw e;
      throw this.context.toHttpException(e);
    }

    this.logger.log({ event: 'order_create.shopify_created', requestId: request.id, shopifyOrderId: created.shopifyOrderId });
    return this.persist(request, ctx.store.id, created);
  }

  /** Persists a Shopify-confirmed order locally and finalises the request. */
  private async persist(request: OrderCreationRequest, storeId: string, order: NormalizedOrder): Promise<OrderCreationResult> {
    await this.requests.update(request.id, { shopifyOrderId: order.shopifyOrderId });
    try {
      const { orderId } = await this.orderSync.upsertFromShopify(storeId, order, OrderSource.CRM);
      const done = await this.requests.update(request.id, {
        status: OrderCreationStatus.SUCCEEDED,
        orderId,
        errorMessage: null,
      });
      return this.resultFor(done, false);
    } catch (e) {
      // Shopify has the order but our DB write failed: keep UNKNOWN with the Shopify id so
      // reconciliation (or the orders/create webhook) can persist it later.
      this.logger.error({ event: 'order_create.persist_failed', requestId: request.id }, (e as Error).stack);
      await this.requests
        .update(request.id, { status: OrderCreationStatus.UNKNOWN, errorMessage: 'Created in Shopify; local save pending' })
        .catch(() => undefined);
      return {
        requestId: request.id,
        status: OrderCreationStatus.UNKNOWN,
        replayed: false,
        order: null,
        message: 'The order was created in Shopify but could not be saved locally yet. It will appear shortly.',
      };
    }
  }

  private async reconcile(r: OrderCreationRequest): Promise<OrderCreationResult> {
    const ctx = await this.context.getActive();
    let found: NormalizedOrder | null;
    try {
      found = r.shopifyOrderId
        ? await this.ordersApi.fetchOrder(ctx.creds, r.shopifyOrderId)
        : await this.ordersApi.findOrderByTag(ctx.creds, crmRefTag(r.idempotencyKey));
    } catch (e) {
      await this.context.handleFailure(ctx.store, e);
      await this.requests.update(r.id, { attempts: { increment: 1 } });
      return this.resultFor({ ...r, status: OrderCreationStatus.UNKNOWN }, false);
    }

    if (found) {
      this.logger.log({ event: 'order_create.reconciled_found', requestId: r.id, shopifyOrderId: found.shopifyOrderId });
      return this.persist(r, ctx.store.id, found);
    }

    if (Date.now() - r.createdAt.getTime() > GIVE_UP_AFTER_MS) {
      const failed = await this.fail(r, 'Shopify did not create this order. It is safe to submit it again.');
      this.logger.warn({ event: 'order_create.reconciled_not_found', requestId: r.id });
      return this.resultFor(failed, false);
    }
    const updated = await this.requests.update(r.id, {
      status: OrderCreationStatus.UNKNOWN,
      attempts: { increment: 1 },
    });
    return this.resultFor(updated, false);
  }

  private async buildInput(key: string, dto: CreateOrderDto, ctx: StoreContext): Promise<ShopifyOrderCreateInput> {
    const currency = ctx.store.currency ?? 'USD';

    // Validate variants against Shopify (existence + availability). Prices come from Shopify itself.
    const variants = await this.productsApi.getVariants(ctx.creds, dto.lineItems.map((l) => l.variantId));
    const missing = dto.lineItems.filter((l) => !variants.has(l.variantId)).map((l) => l.variantId);
    if (missing.length) {
      throw new AppException('PRODUCT_NOT_FOUND', 'Some selected products no longer exist in Shopify', HttpStatus.UNPROCESSABLE_ENTITY, { missing });
    }
    const unavailable = dto.lineItems.filter((l) => !variants.get(l.variantId)!.availableForSale);
    if (unavailable.length) {
      throw new AppException(
        'PRODUCT_UNAVAILABLE',
        `Not available for sale: ${unavailable.map((l) => variants.get(l.variantId)!.displayName).join(', ')}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const c = dto.customer;
    let customer: ShopifyOrderCreateInput['customer'];
    if (c.existingCustomerId) {
      const local = await this.customers.findById(c.existingCustomerId);
      if (!local || local.storeId !== ctx.store.id) {
        throw new AppException('CUSTOMER_NOT_FOUND', 'Selected customer was not found', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      customer = { toAssociate: { id: local.shopifyCustomerId } };
    } else if (c.email || c.phone) {
      customer = { toUpsert: { email: c.email, phone: c.phone, firstName: c.firstName, lastName: c.lastName } };
    }

    const address = (a?: AddressDto) =>
      a && {
        firstName: a.firstName ?? c.firstName,
        lastName: a.lastName ?? c.lastName,
        company: a.company,
        address1: a.address1,
        address2: a.address2,
        city: a.city,
        provinceCode: a.provinceCode,
        countryCode: a.countryCode,
        zip: a.zip,
        phone: a.phone,
      };

    const money = (amount: string) => ({ shopMoney: { amount, currencyCode: currency } });
    return {
      currency,
      email: c.email,
      phone: c.phone,
      financialStatus: 'PENDING', // never mark CRM orders as paid / capture payment
      customer,
      billingAddress: address(dto.billingAddress),
      shippingAddress: address(dto.shippingAddress ?? dto.billingAddress),
      lineItems: dto.lineItems.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      shippingLines: dto.shippingLine
        ? [{ title: dto.shippingLine.title, priceSet: money(dto.shippingLine.amount) }]
        : undefined,
      discountCode:
        dto.discount && Number(dto.discount.amount) > 0
          ? { itemFixedDiscountCode: { code: dto.discount.code, amountSet: money(dto.discount.amount) } }
          : undefined,
      note: dto.note,
      tags: [CRM_TAG, crmRefTag(key)],
      sourceIdentifier: key,
    };
  }

  private assertUniqueVariants(dto: CreateOrderDto) {
    const ids = dto.lineItems.map((l) => l.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new AppException(
        'DUPLICATE_LINE_ITEM',
        'Each product variant may only appear once; adjust the quantity instead',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private fail(r: OrderCreationRequest, message: string) {
    return this.requests.update(r.id, { status: OrderCreationStatus.FAILED, errorMessage: message.slice(0, 1000) });
  }

  private async resultFor(r: OrderCreationRequest, replayed: boolean): Promise<OrderCreationResult> {
    const order = r.orderId ? await this.orders.getById(r.orderId).catch(() => null) : null;
    const messages: Record<OrderCreationStatus, string> = {
      SUCCEEDED: replayed ? 'Order was already created' : 'Order created in Shopify',
      PENDING: 'Order creation in progress',
      UNKNOWN:
        'Shopify did not confirm the order in time. We are verifying whether it was created – do not resubmit.',
      FAILED: r.errorMessage ?? 'Order creation failed',
    };
    return { requestId: r.id, status: r.status, replayed, order, message: messages[r.status] };
  }

  private inProgress() {
    return new AppException(
      'ORDER_CREATION_IN_PROGRESS',
      'This order is already being submitted',
      HttpStatus.CONFLICT,
    );
  }
}

