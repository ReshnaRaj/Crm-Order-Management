import { Injectable } from '@nestjs/common';
import { OrderSource, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';
import { NormalizedLineItem, NormalizedOrder } from '../shopify/integration/normalized-order';

export interface OrderListFilter {
  search?: string;
  orderStatus?: OrderStatus;
  fulfillmentStatus?: string;
  financialStatus?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export type OrderSortField = 'orderDate' | 'totalAmount';
export type SortDirection = 'asc' | 'desc';

export interface OrderListParams extends OrderListFilter {
  page: number;
  pageSize: number;
  sortBy: OrderSortField;
  sortOrder: SortDirection;
}

export const orderListSelect = {
  id: true,
  shopifyOrderId: true,
  orderNumber: true,
  orderDate: true,
  customerName: true,
  email: true,
  orderStatus: true,
  fulfillmentStatus: true,
  financialStatus: true,
  totalAmount: true,
  currency: true,
  source: true,
} satisfies Prisma.OrderSelect;

export type OrderListRow = Prisma.OrderGetPayload<{ select: typeof orderListSelect }>;

export const orderDetailsInclude = {
  items: { orderBy: { productName: 'asc' } },
  customer: true,
  store: { select: { id: true, shopDomain: true, name: true, connectionStatus: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetailsRow = Prisma.OrderGetPayload<{ include: typeof orderDetailsInclude }>;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Runs `fn` in a database transaction. */
  transaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  // ───────────────────────── sync writes ─────────────────────────

  /** Row-locks an existing order (SELECT … FOR UPDATE) so concurrent syncs serialise. */
  async lockByShopifyId(
    tx: PrismaTx,
    storeId: string,
    shopifyOrderId: string,
  ): Promise<{ id: string; shopifyUpdatedAt: Date | null } | null> {
    const rows = await tx.$queryRaw<{ id: string; shopifyUpdatedAt: Date | null }[]>`
      SELECT "id", "shopifyUpdatedAt" FROM "Order"
      WHERE "storeId" = ${storeId}::uuid AND "shopifyOrderId" = ${shopifyOrderId}
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  private orderFields(o: NormalizedOrder, customerId: string | null) {
    const json = (v: unknown) => (v ? (v as Prisma.InputJsonObject) : Prisma.DbNull);
    return {
      orderNumber: o.orderNumber,
      customerId,
      customerName: o.customerName,
      email: o.email,
      phone: o.phone,
      orderDate: o.orderDate,
      orderStatus: o.orderStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      financialStatus: o.financialStatus,
      subtotal: o.subtotal,
      totalTax: o.totalTax,
      totalDiscount: o.totalDiscount,
      shippingAmount: o.shippingAmount,
      totalAmount: o.totalAmount,
      currency: o.currency,
      billingAddress: json(o.billingAddress),
      shippingAddress: json(o.shippingAddress),
      note: o.note,
      tags: o.tags,
      cancelledAt: o.cancelledAt,
      closedAt: o.closedAt,
      shopifyUpdatedAt: o.shopifyUpdatedAt,
      lastSyncedAt: new Date(),
    };
  }

  create(tx: PrismaTx, storeId: string, o: NormalizedOrder, customerId: string | null, source: OrderSource) {
    return tx.order.create({
      data: { storeId, shopifyOrderId: o.shopifyOrderId, source, ...this.orderFields(o, customerId) },
      select: { id: true },
    });
  }

  update(tx: PrismaTx, id: string, o: NormalizedOrder, customerId: string | null) {
    return tx.order.update({ where: { id }, data: this.orderFields(o, customerId), select: { id: true } });
  }

  async touchSynced(tx: PrismaTx, id: string) {
    await tx.order.update({ where: { id }, data: { lastSyncedAt: new Date() } });
  }

  /** Replaces all line items of an order (Shopify payloads always carry the full set). */
  async replaceItems(tx: PrismaTx, orderId: string, items: NormalizedLineItem[]) {
    await tx.orderItem.deleteMany({ where: { orderId } });
    if (!items.length) return;
    await tx.orderItem.createMany({
      data: items.map((li) => ({ orderId, ...li })),
      skipDuplicates: true,
    });
  }

  // ───────────────────────── reads ─────────────────────────

  private buildWhere(f: OrderListFilter): Prisma.OrderWhereInput {
    const and: Prisma.OrderWhereInput[] = [];
    const q = f.search?.trim();
    if (q) {
      const numberTerm = q.replace(/^#/, '');
      and.push({
        OR: [
          { orderNumber: { contains: numberTerm, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (f.orderStatus) and.push({ orderStatus: f.orderStatus });
    if (f.fulfillmentStatus) and.push({ fulfillmentStatus: f.fulfillmentStatus });
    if (f.financialStatus) and.push({ financialStatus: f.financialStatus });
    if (f.dateFrom || f.dateTo) {
      and.push({ orderDate: { gte: f.dateFrom, lte: f.dateTo } });
    }
    return and.length ? { AND: and } : {};
  }

  async list(p: OrderListParams): Promise<{ rows: OrderListRow[]; total: number }> {
    const where = this.buildWhere(p);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        select: orderListSelect,
        // secondary sort on id keeps pagination stable for equal values
        orderBy: [{ [p.sortBy]: p.sortOrder }, { id: p.sortOrder }],
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { rows, total };
  }

  findDetails(id: string): Promise<OrderDetailsRow | null> {
    return this.prisma.order.findUnique({ where: { id }, include: orderDetailsInclude });
  }

  findByShopifyId(storeId: string, shopifyOrderId: string) {
    return this.prisma.order.findUnique({
      where: { storeId_shopifyOrderId: { storeId, shopifyOrderId } },
      select: { id: true },
    });
  }

  async distinctStatuses() {
    const [fulfillment, financial] = await Promise.all([
      this.prisma.order.findMany({
        where: { fulfillmentStatus: { not: null } },
        distinct: ['fulfillmentStatus'],
        select: { fulfillmentStatus: true },
      }),
      this.prisma.order.findMany({
        where: { financialStatus: { not: null } },
        distinct: ['financialStatus'],
        select: { financialStatus: true },
      }),
    ]);
    return {
      fulfillment: fulfillment.map((r) => r.fulfillmentStatus!).sort(),
      financial: financial.map((r) => r.financialStatus!).sort(),
    };
  }

  async summary() {
    const pendingWhere: Prisma.OrderWhereInput = {
      orderStatus: OrderStatus.OPEN,
      OR: [{ fulfillmentStatus: null }, { fulfillmentStatus: { not: 'FULFILLED' } }],
    };
    const [total, pending, fulfilled, cancelled, sales, recent] = await this.prisma.$transaction([
      this.prisma.order.count(),
      this.prisma.order.count({ where: pendingWhere }),
      this.prisma.order.count({ where: { fulfillmentStatus: 'FULFILLED' } }),
      this.prisma.order.count({ where: { orderStatus: OrderStatus.CANCELLED } }),
      this.prisma.order.groupBy({
        by: ['currency'],
        where: { orderStatus: { not: OrderStatus.CANCELLED } },
        _sum: { totalAmount: true },
        _count: { _all: true },
        orderBy: { currency: 'asc' },
      }),
      this.prisma.order.findMany({
        select: orderListSelect,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    ]);
    return { total, pending, fulfilled, cancelled, sales, recent };
  }
}
