import { OrderStatus, Prisma } from '@prisma/client';
import {
  NormalizedAddress,
  NormalizedCustomer,
  NormalizedLineItem,
  NormalizedOrder,
} from './normalized-order';

// ─────────────── GraphQL shapes (subset we query) ───────────────

interface Money {
  shopMoney: { amount: string };
}

export interface GqlAddress {
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
  countryCodeV2?: string | null;
  zip?: string | null;
  phone?: string | null;
}

export interface GqlLineItem {
  id: string;
  name: string;
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  product?: { id: string } | null;
  variant?: { id: string } | null;
  originalUnitPriceSet: Money;
  totalDiscountSet?: Money | null;
  discountedTotalSet?: Money | null;
}

export interface GqlOrder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string | null;
  processedAt?: string | null;
  cancelledAt?: string | null;
  closedAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currencyCode: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  tags?: string[] | null;
  currentSubtotalPriceSet?: Money | null;
  currentTotalTaxSet?: Money | null;
  currentTotalDiscountsSet?: Money | null;
  totalShippingPriceSet?: Money | null;
  currentTotalPriceSet?: Money | null;
  customer?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    defaultEmailAddress?: { emailAddress?: string | null } | null;
    defaultPhoneNumber?: { phoneNumber?: string | null } | null;
  } | null;
  billingAddress?: GqlAddress | null;
  shippingAddress?: GqlAddress | null;
  lineItems: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlLineItem[];
  };
}

// ─────────────── REST webhook payload shapes (subset) ───────────────

export interface RestMoneySet {
  shop_money?: { amount?: string | null } | null;
}

export interface RestAddress {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  zip?: string | null;
  phone?: string | null;
}

export interface RestLineItem {
  id: number | string;
  admin_graphql_api_id?: string;
  product_id?: number | null;
  variant_id?: number | null;
  title?: string | null;
  name?: string | null;
  variant_title?: string | null;
  sku?: string | null;
  quantity?: number;
  price?: string | null;
  total_discount?: string | null;
}

export interface RestOrderPayload {
  id: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  order_number?: number;
  created_at?: string;
  processed_at?: string | null;
  updated_at?: string | null;
  cancelled_at?: string | null;
  closed_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  currency?: string;
  email?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  note?: string | null;
  tags?: string | null;
  current_subtotal_price?: string | null;
  subtotal_price?: string | null;
  current_total_tax?: string | null;
  total_tax?: string | null;
  current_total_discounts?: string | null;
  total_discounts?: string | null;
  current_total_price?: string | null;
  total_price?: string | null;
  total_shipping_price_set?: RestMoneySet | null;
  customer?: {
    id: number | string;
    admin_graphql_api_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  billing_address?: RestAddress | null;
  shipping_address?: RestAddress | null;
  line_items?: RestLineItem[];
}

// ─────────────── helpers ───────────────

const gid = (type: string, id: number | string | null | undefined, explicit?: string | null) =>
  explicit ?? (id === null || id === undefined ? null : `gid://shopify/${type}/${id}`);

const amount = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return '0';
  const d = new Prisma.Decimal(v);
  return d.isFinite() ? d.toString() : '0';
};

const date = (v: string | null | undefined) => (v ? new Date(v) : null);

const clean = (v: string | null | undefined) => {
  const s = v?.trim();
  return s ? s : null;
};

const fullName = (first?: string | null, last?: string | null) =>
  clean([first?.trim(), last?.trim()].filter(Boolean).join(' '));

export function deriveOrderStatus(cancelledAt: Date | null, closedAt: Date | null): OrderStatus {
  if (cancelledAt) return OrderStatus.CANCELLED;
  if (closedAt) return OrderStatus.CLOSED;
  return OrderStatus.OPEN;
}

/** REST fulfillment_status values -> GraphQL OrderDisplayFulfillmentStatus values. */
export function normaliseRestFulfillment(v: string | null | undefined): string {
  switch ((v ?? '').toLowerCase()) {
    case '':
    case 'null':
    case 'unfulfilled':
      return 'UNFULFILLED';
    case 'partial':
      return 'PARTIALLY_FULFILLED';
    case 'fulfilled':
      return 'FULFILLED';
    case 'restocked':
      return 'RESTOCKED';
    default:
      return v!.toUpperCase();
  }
}

const upper = (v: string | null | undefined) => (v ? v.toUpperCase() : null);

function compact<T extends object>(o: T): T | null {
  const entries = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return entries.length ? (Object.fromEntries(entries) as T) : null;
}

// ─────────────── GraphQL -> normalized ───────────────

function mapGqlAddress(a?: GqlAddress | null): NormalizedAddress | null {
  if (!a) return null;
  return compact<NormalizedAddress>({
    firstName: a.firstName,
    lastName: a.lastName,
    name: a.name,
    company: a.company,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    province: a.province,
    provinceCode: a.provinceCode,
    country: a.country,
    countryCode: a.countryCodeV2,
    zip: a.zip,
    phone: a.phone,
  });
}

export function mapGqlLineItem(li: GqlLineItem): NormalizedLineItem {
  const unit = amount(li.originalUnitPriceSet?.shopMoney.amount);
  const discount = amount(li.totalDiscountSet?.shopMoney.amount);
  const total = li.discountedTotalSet
    ? amount(li.discountedTotalSet.shopMoney.amount)
    : new Prisma.Decimal(unit).mul(li.quantity).minus(discount).toString();
  return {
    shopifyLineItemId: li.id,
    shopifyProductId: li.product?.id ?? null,
    shopifyVariantId: li.variant?.id ?? null,
    productName: li.title || li.name,
    variantName: clean(li.variantTitle),
    sku: clean(li.sku),
    quantity: li.quantity,
    unitPrice: unit,
    totalDiscount: discount,
    totalPrice: total,
  };
}

export function mapGqlOrder(o: GqlOrder, extraLineItems: GqlLineItem[] = []): NormalizedOrder {
  const cancelledAt = date(o.cancelledAt);
  const closedAt = date(o.closedAt);
  const c = o.customer;
  const customer: NormalizedCustomer | null = c
    ? {
        shopifyCustomerId: c.id,
        firstName: clean(c.firstName),
        lastName: clean(c.lastName),
        name: fullName(c.firstName, c.lastName) ?? clean(c.displayName),
        email: clean(c.defaultEmailAddress?.emailAddress),
        phone: clean(c.defaultPhoneNumber?.phoneNumber),
      }
    : null;
  const billing = mapGqlAddress(o.billingAddress);
  const shipping = mapGqlAddress(o.shippingAddress);

  return {
    shopifyOrderId: o.id,
    orderNumber: o.name,
    orderDate: new Date(o.processedAt ?? o.createdAt),
    shopifyUpdatedAt: date(o.updatedAt),
    cancelledAt,
    closedAt,
    orderStatus: deriveOrderStatus(cancelledAt, closedAt),
    financialStatus: upper(o.displayFinancialStatus),
    fulfillmentStatus: upper(o.displayFulfillmentStatus),
    currency: o.currencyCode,
    subtotal: amount(o.currentSubtotalPriceSet?.shopMoney.amount),
    totalTax: amount(o.currentTotalTaxSet?.shopMoney.amount),
    totalDiscount: amount(o.currentTotalDiscountsSet?.shopMoney.amount),
    shippingAmount: amount(o.totalShippingPriceSet?.shopMoney.amount),
    totalAmount: amount(o.currentTotalPriceSet?.shopMoney.amount),
    email: clean(o.email) ?? customer?.email ?? null,
    phone: clean(o.phone) ?? customer?.phone ?? null,
    customerName: customer?.name ?? billing?.name ?? shipping?.name ?? null,
    customer,
    billingAddress: billing,
    shippingAddress: shipping,
    note: clean(o.note),
    tags: o.tags ?? [],
    lineItems: [...o.lineItems.nodes, ...extraLineItems].map(mapGqlLineItem),
  };
}

// ─────────────── REST webhook payload -> normalized ───────────────

function mapRestAddress(a?: RestAddress | null): NormalizedAddress | null {
  if (!a) return null;
  return compact<NormalizedAddress>({
    firstName: a.first_name,
    lastName: a.last_name,
    name: a.name ?? fullName(a.first_name, a.last_name),
    company: a.company,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    province: a.province,
    provinceCode: a.province_code,
    country: a.country,
    countryCode: a.country_code,
    zip: a.zip,
    phone: a.phone,
  });
}

export function mapRestOrder(p: RestOrderPayload): NormalizedOrder {
  if (p.id === undefined || p.id === null) throw new Error('Order payload is missing an id');
  const cancelledAt = date(p.cancelled_at);
  const closedAt = date(p.closed_at);
  const c = p.customer;
  const customer: NormalizedCustomer | null = c
    ? {
        shopifyCustomerId: gid('Customer', c.id, c.admin_graphql_api_id)!,
        firstName: clean(c.first_name),
        lastName: clean(c.last_name),
        name: fullName(c.first_name, c.last_name),
        email: clean(c.email),
        phone: clean(c.phone),
      }
    : null;
  const billing = mapRestAddress(p.billing_address);
  const shipping = mapRestAddress(p.shipping_address);
  const createdAt = p.processed_at ?? p.created_at;

  return {
    shopifyOrderId: gid('Order', p.id, p.admin_graphql_api_id)!,
    orderNumber: p.name ?? (p.order_number ? `#${p.order_number}` : String(p.id)),
    orderDate: createdAt ? new Date(createdAt) : new Date(),
    shopifyUpdatedAt: date(p.updated_at),
    cancelledAt,
    closedAt,
    orderStatus: deriveOrderStatus(cancelledAt, closedAt),
    financialStatus: upper(p.financial_status),
    fulfillmentStatus: normaliseRestFulfillment(p.fulfillment_status),
    currency: (p.currency ?? 'USD').toUpperCase(),
    subtotal: amount(p.current_subtotal_price ?? p.subtotal_price),
    totalTax: amount(p.current_total_tax ?? p.total_tax),
    totalDiscount: amount(p.current_total_discounts ?? p.total_discounts),
    shippingAmount: amount(p.total_shipping_price_set?.shop_money?.amount),
    totalAmount: amount(p.current_total_price ?? p.total_price),
    email: clean(p.email) ?? clean(p.contact_email) ?? customer?.email ?? null,
    phone: clean(p.phone) ?? customer?.phone ?? null,
    customerName: customer?.name ?? billing?.name ?? shipping?.name ?? null,
    customer,
    billingAddress: billing,
    shippingAddress: shipping,
    note: clean(p.note),
    tags: (p.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    lineItems: (p.line_items ?? []).map((li) => {
      const unit = amount(li.price);
      const qty = li.quantity ?? 0;
      const discount = amount(li.total_discount);
      return {
        shopifyLineItemId: gid('LineItem', li.id, li.admin_graphql_api_id)!,
        shopifyProductId: gid('Product', li.product_id),
        shopifyVariantId: gid('ProductVariant', li.variant_id),
        productName: li.title ?? li.name ?? 'Untitled item',
        variantName: clean(li.variant_title),
        sku: clean(li.sku),
        quantity: qty,
        unitPrice: unit,
        totalDiscount: discount,
        totalPrice: new Prisma.Decimal(unit).mul(qty).minus(discount).toString(),
      };
    }),
  };
}
