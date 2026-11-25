import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, WebhookProcessingStatus } from '@prisma/client';
import { Paginated } from '../common/interfaces/api-response.interface';
import { AppException } from '../common/utils/app.exception';
import { paginate } from '../common/utils/pagination.util';
import { isUniqueViolation } from '../prisma/prisma.service';
import { ShopifyStoreRepository } from '../shopify/integration/shopify-store.repository';
import { ListWebhookLogsQueryDto } from './dto/webhook.dto';
import { WebhookProcessorService } from './webhook-processor.service';
import { webhookListSelect, WebhooksRepository } from './webhooks.repository';

export interface IncomingWebhook {
  expectedTopic: string;
  headers: Record<string, string | string[] | undefined>;
  payload: unknown;
}

export interface WebhookAck {
  received: true;
  duplicate: boolean;
  eventId?: string;
}

type WebhookListItem = Prisma.WebhookEventGetPayload<{ select: typeof webhookListSelect }>;

const header = (h: IncomingWebhook['headers'], name: string): string | undefined => {
  const v = h[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly repo: WebhooksRepository,
    private readonly stores: ShopifyStoreRepository,
    private readonly processor: WebhookProcessorService,
  ) {}

  /**
   * Persists a verified webhook, then dispatches processing asynchronously.
   * The caller acknowledges Shopify as soon as this resolves.
   */
  async receive(w: IncomingWebhook): Promise<WebhookAck> {
    const webhookId = header(w.headers, 'x-shopify-webhook-id');
    const shopDomain = header(w.headers, 'x-shopify-shop-domain')?.toLowerCase();
    const topic = header(w.headers, 'x-shopify-topic') ?? w.expectedTopic;
    if (!webhookId || !shopDomain) {
      throw new AppException('INVALID_WEBHOOK', 'Missing Shopify webhook headers', HttpStatus.BAD_REQUEST);
    }
    if (topic !== w.expectedTopic) {
      throw new AppException('WEBHOOK_TOPIC_MISMATCH', `Topic ${topic} sent to ${w.expectedTopic} endpoint`, HttpStatus.BAD_REQUEST);
    }
    if (!w.payload || typeof w.payload !== 'object') {
      throw new AppException('INVALID_WEBHOOK', 'Webhook body must be a JSON object', HttpStatus.BAD_REQUEST);
    }

    const payload = w.payload as { id?: string | number; admin_graphql_api_id?: unknown };
    const shopifyOrderId = topic.startsWith('orders/')
      ? typeof payload.admin_graphql_api_id === 'string'
        ? payload.admin_graphql_api_id
        : typeof payload.id === 'string' || typeof payload.id === 'number'
          ? `gid://shopify/Order/${String(payload.id)}`
          : null
      : null;
    const triggered = header(w.headers, 'x-shopify-triggered-at');
    const store = await this.stores.findByDomain(shopDomain);

    try {
      const event = await this.repo.create({
        shopifyEventId: webhookId,
        shopifyCorrelationId: header(w.headers, 'x-shopify-event-id') ?? null,
        shopDomain,
        storeId: store?.id ?? null,
        topic,
        shopifyOrderId,
        apiVersion: header(w.headers, 'x-shopify-api-version') ?? null,
        payload: w.payload,
        triggeredAt: triggered && !Number.isNaN(Date.parse(triggered)) ? new Date(triggered) : null,
      });
      this.logger.log({ event: 'webhook.received', eventId: event.id, webhookId, topic, shop: shopDomain, shopifyOrderId });
      this.processor.dispatch(event.id);
      return { received: true, duplicate: false, eventId: event.id };
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Shopify retried (or concurrently re-sent) a delivery we already stored.
        this.logger.log({ event: 'webhook.duplicate_ignored', webhookId, topic, shop: shopDomain });
        return { received: true, duplicate: true };
      }
      throw e; // DB failure => non-2xx so Shopify retries the delivery later
    }
  }

  async list(q: ListWebhookLogsQueryDto): Promise<Paginated<WebhookListItem> & { counts: Record<string, number> }> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [{ rows, total }, counts] = await Promise.all([
      this.repo.list({ status: q.status, topic: q.topic, search: q.search }, page, pageSize),
      this.repo.countsByStatus(),
    ]);
    return { ...paginate(rows, total, page, pageSize), counts };
  }

  async get(id: string) {
    const e = await this.repo.findById(id);
    if (!e) throw new AppException('NOT_FOUND', 'Webhook event not found', HttpStatus.NOT_FOUND);
    return e;
  }

  async retry(id: string) {
    const e = await this.get(id);
    if (e.processingStatus !== WebhookProcessingStatus.FAILED && e.processingStatus !== WebhookProcessingStatus.SKIPPED) {
      throw new AppException('WEBHOOK_NOT_RETRYABLE', `Event is ${e.processingStatus.toLowerCase()}`, HttpStatus.CONFLICT);
    }
    // The store may have been connected after the event arrived (event was SKIPPED).
    if (!e.storeId) {
      const store = await this.stores.findByDomain(e.shopDomain);
      if (store) await this.repo.attachStore(id, store.id);
    }
    if (!(await this.repo.resetForRetry(id))) {
      throw new AppException('WEBHOOK_NOT_RETRYABLE', 'Event is being processed', HttpStatus.CONFLICT);
    }
    const status = await this.processor.process(id);
    return { id, status: status ?? 'PROCESSING' };
  }
}
