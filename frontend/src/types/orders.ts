export type OrderStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export interface OrderListItem {
  id: string;
  shopifyOrderId: string;
  orderNumber: string;
  orderDate: string;
  customerName: string | null;
  email: string | null;
  orderStatus: OrderStatus;
  fulfillmentStatus: string | null;
  financialStatus: string | null;
  totalAmount: string;
  currency: string;
  source: 'SHOPIFY_IMPORT' | 'CRM' | 'WEBHOOK';
}

export interface Address {
  name?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  provinceCode?: string;
  country?: string;
  countryCode?: string;
  zip?: string;
  phone?: string;
}

export interface OrderItem {
  id: string;
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

export interface OrderDetails {
  id: string;
  shopifyOrderId: string;
  shopifyLegacyId: string | null;
  orderNumber: string;
  orderDate: string;
  orderStatus: OrderStatus;
  fulfillmentStatus: string | null;
  financialStatus: string | null;
  source: OrderListItem['source'];
  note: string | null;
  tags: string[];
  cancelledAt: string | null;
  closedAt: string | null;
  lastSyncedAt: string;
  store: { id: string; shopDomain: string; name: string | null; connectionStatus: string };
  customer: {
    id: string | null;
    shopifyCustomerId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  billingAddress: Address | null;
  shippingAddress: Address | null;
  items: OrderItem[];
  payment: {
    subtotal: string;
    totalDiscount: string;
    totalTax: string;
    shippingAmount: string;
    totalAmount: string;
    currency: string;
    financialStatus: string | null;
  };
}

export interface OrdersQuery {
  page: number;
  pageSize: number;
  search?: string;
  orderStatus?: string;
  fulfillmentStatus?: string;
  financialStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy: 'orderDate' | 'totalAmount';
  sortOrder: 'asc' | 'desc';
}

export interface OrdersSummary {
  totalOrders: number;
  pendingOrders: number;
  fulfilledOrders: number;
  cancelledOrders: number;
  totalSales: { currency: string; amount: string; orders: number }[];
  recentOrders: OrderListItem[];
}

export interface Customer {
  id: string;
  shopifyCustomerId: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: Address | null;
  shippingAddress: Address | null;
}

export interface CreateOrderPayload {
  idempotencyKey: string;
  customer: {
    existingCustomerId?: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  };
  billingAddress?: Address;
  shippingAddress?: Address;
  lineItems: { variantId: string; quantity: number }[];
  shippingLine?: { title: string; amount: string };
  discount?: { code: string; amount: string };
  note?: string;
}

export interface OrderCreationResult {
  requestId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  replayed: boolean;
  order: OrderDetails | null;
  message: string;
}
