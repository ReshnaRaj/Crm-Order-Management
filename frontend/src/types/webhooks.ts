import type { Paginated } from './common';

export type WebhookStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'SKIPPED';

export interface WebhookLog {
  id: string;
  shopifyEventId: string;
  shopDomain: string;
  topic: string;
  shopifyOrderId: string | null;
  processingStatus: WebhookStatus;
  receivedAt: string;
  processedAt: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  errorMessage: string | null;
}

export interface WebhookLogDetails extends WebhookLog {
  shopifyCorrelationId: string | null;
  storeId: string | null;
  apiVersion: string | null;
  triggeredAt: string | null;
  lockedAt: string | null;
  payload: unknown;
}

export type WebhookLogsPage = Paginated<WebhookLog> & { counts: Partial<Record<WebhookStatus, number>> };

export interface WebhookLogsQuery {
  page: number;
  pageSize: number;
  status?: string;
  topic?: string;
  search?: string;
}
