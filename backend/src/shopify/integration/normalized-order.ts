import { OrderStatus } from '@prisma/client';

/** Provider-agnostic order representation used by the persistence layer. Money values are decimal strings. */
export interface NormalizedAddress {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  country?: string | null;
  countryCode?: string | null;
  zip?: string | null;
  phone?: string | null;
}

export interface NormalizedCustomer {
  shopifyCustomerId: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface NormalizedLineItem {
  shopifyLineItemId: string;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  totalDiscount: string;
  totalPrice: string;
}

export interface NormalizedOrder {
  shopifyOrderId: string;
  orderNumber: string;
  orderDate: Date;
  shopifyUpdatedAt: Date | null;
  cancelledAt: Date | null;
  closedAt: Date | null;
  orderStatus: OrderStatus;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  currency: string;
  subtotal: string;
  totalTax: string;
  totalDiscount: string;
  shippingAmount: string;
  totalAmount: string;
  email: string | null;
  phone: string | null;
  customerName: string | null;
  customer: NormalizedCustomer | null;
  billingAddress: NormalizedAddress | null;
  shippingAddress: NormalizedAddress | null;
  note: string | null;
  tags: string[];
  lineItems: NormalizedLineItem[];
}
