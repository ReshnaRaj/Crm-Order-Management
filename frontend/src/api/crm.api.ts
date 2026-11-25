import { api } from '@/lib/api-client';
import type { Paginated } from '@/types/common';
import type {
  CreateOrderPayload,
  Customer,
  OrderCreationResult,
  OrderDetails,
  OrderListItem,
  OrdersQuery,
  OrdersSummary,
} from '@/types/orders';
import type { ProductsPage, ShopifyStatus, SyncRun } from '@/types/shopify';
import type { WebhookLogDetails, WebhookLogsPage, WebhookLogsQuery } from '@/types/webhooks';

export const ordersApi = {
  list: (q: OrdersQuery, signal?: AbortSignal) =>
    api<Paginated<OrderListItem>>('/orders', { query: { ...q }, signal }),
  get: (id: string) => api<OrderDetails>(`/orders/${id}`),
  summary: () => api<OrdersSummary>('/orders/summary'),
  filters: () => api<{ fulfillment: string[]; financial: string[] }>('/orders/filters'),
  create: (body: CreateOrderPayload) => api<OrderCreationResult>('/orders', { method: 'POST', body }),
  reconcile: (requestId: string) =>
    api<OrderCreationResult>(`/orders/creation-requests/${requestId}/reconcile`, { method: 'POST' }),
};

export const customersApi = {
  search: (search: string, signal?: AbortSignal) =>
    api<Customer[]>('/customers', { query: { search, limit: 8 }, signal }),
};

export const shopifyApi = {
  status: () => api<ShopifyStatus>('/shopify/status'),
  connect: (shop: string) =>
    api<{ authorizationUrl: string; shop: string }>('/shopify/connect', { query: { shop } }),
  verify: () => api<ShopifyStatus>('/shopify/verify', { method: 'POST' }),
  importOrders: () => api<SyncRun>('/shopify/import-orders', { method: 'POST' }),
  syncOrders: () => api<SyncRun>('/shopify/sync-orders', { method: 'POST' }),
  registerWebhooks: () =>
    api<{ created: string[]; existing: string[] }>('/shopify/webhooks/register', { method: 'POST' }),
  disconnect: () => api<{ disconnected: boolean }>('/shopify/disconnect', { method: 'POST' }),
  products: (search: string, signal?: AbortSignal) =>
    api<ProductsPage>('/shopify/products', { query: { search }, signal }),
};

export const webhooksApi = {
  list: (q: WebhookLogsQuery) => api<WebhookLogsPage>('/webhooks/logs', { query: { ...q } }),
  get: (id: string) => api<WebhookLogDetails>(`/webhooks/logs/${id}`),
  retry: (id: string) => api<{ id: string; status: string }>(`/webhooks/logs/${id}/retry`, { method: 'POST' }),
};
