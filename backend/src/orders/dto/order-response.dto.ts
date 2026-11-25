import { OrderDetailsRow, OrderListRow } from '../orders.repository';

/** API representations: Decimal values are serialised as strings to avoid float rounding. */
export interface OrderListItemDto {
  id: string;
  shopifyOrderId: string;
  orderNumber: string;
  orderDate: Date;
  customerName: string | null;
  email: string | null;
  orderStatus: string;
  fulfillmentStatus: string | null;
  financialStatus: string | null;
  totalAmount: string;
  currency: string;
  source: string;
}

export const toListItem = (o: OrderListRow): OrderListItemDto => ({
  ...o,
  totalAmount: o.totalAmount.toFixed(2),
});

export function toDetails(o: OrderDetailsRow) {
  return {
    id: o.id,
    shopifyOrderId: o.shopifyOrderId,
    shopifyLegacyId: o.shopifyOrderId.split('/').pop() ?? null,
    orderNumber: o.orderNumber,
    orderDate: o.orderDate,
    orderStatus: o.orderStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    financialStatus: o.financialStatus,
    source: o.source,
    note: o.note,
    tags: o.tags,
    cancelledAt: o.cancelledAt,
    closedAt: o.closedAt,
    lastSyncedAt: o.lastSyncedAt,
    shopifyUpdatedAt: o.shopifyUpdatedAt,
    store: o.store,
    customer: {
      id: o.customer?.id ?? null,
      shopifyCustomerId: o.customer?.shopifyCustomerId ?? null,
      name: o.customer?.name ?? o.customerName,
      email: o.email ?? o.customer?.email ?? null,
      phone: o.phone ?? o.customer?.phone ?? null,
    },
    billingAddress: o.billingAddress,
    shippingAddress: o.shippingAddress,
    items: o.items.map((i) => ({
      id: i.id,
      shopifyLineItemId: i.shopifyLineItemId,
      shopifyProductId: i.shopifyProductId,
      shopifyVariantId: i.shopifyVariantId,
      productName: i.productName,
      variantName: i.variantName,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice.toFixed(2),
      totalDiscount: i.totalDiscount.toFixed(2),
      totalPrice: i.totalPrice.toFixed(2),
    })),
    payment: {
      subtotal: o.subtotal.toFixed(2),
      totalDiscount: o.totalDiscount.toFixed(2),
      totalTax: o.totalTax.toFixed(2),
      shippingAmount: o.shippingAmount.toFixed(2),
      totalAmount: o.totalAmount.toFixed(2),
      currency: o.currency,
      financialStatus: o.financialStatus,
    },
  };
}

export type OrderDetailsDto = ReturnType<typeof toDetails>;
