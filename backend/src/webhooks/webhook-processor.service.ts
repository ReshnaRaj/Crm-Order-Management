import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { WebhookEvent } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PermanentWebhookError, WEBHOOK_TOPIC_HANDLERS, WebhookTopicHandler } from './webhook-handlers';
import { WebhooksRepository } from './webhooks.repository';

const STALE_LOCK_MS = 5 * 60_000;
/** RECEIVED events older than this were not dispatched (e.g. crash right after ack). */
const UNDISPATCHED_AFTER_MS = 60_000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export const backoffMs = (retryCount: number) => Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, retryCount - 1), MAX_BACKOFF_MS);

/**
 * Recoverable webhook processing:
 *  - events are persisted *before* the HTTP 200 ack, so nothing is lost if processing fails
 *  - processing is dispatched in-process right after the ack
 *  - a periodic recovery loop retries FAILED events with exponential back-off and picks up
 *    events that were never dispatched or whose worker died (stale PROCESSING lock)
 *  - claims are atomic, so each event is processed by one worker at a time
 */
@Injectable()
export class WebhookProcessorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WebhookProcessorService.name);
  private readonly inFlight = new Set<Promise<unknown>>();
  private timer?: NodeJS.Timeout;
  private readonly handlers = new Map<string, WebhookTopicHandler>();

  constructor(
    private readonly repo: WebhooksRepository,
    private readonly config: AppConfigService,
    @Inject(WEBHOOK_TOPIC_HANDLERS) handlers: WebhookTopicHandler[],
  ) {
    for (const h of handlers) for (const t of h.topics) this.handlers.set(t, h);
  }

  onApplicationBootstrap() {
    const interval = this.config.webhooks.retryIntervalMs;
    this.timer = setInterval(() => void this.recoverDue(), interval);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Fire-and-forget dispatch used right after acknowledging Shopify. */
  dispatch(eventId: string) {
    const p = this.process(eventId)
      .catch((e: unknown) => this.logger.error({ event: 'webhook.dispatch_error', eventId }, (e as Error).stack))
      .finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
  }

  async waitForIdle() {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
  }

  /** Processes one event if it can be claimed. Returns the final status, or null if not claimed. */
  async process(eventId: string): Promise<string | null> {
    const max = this.config.webhooks.maxRetries;
    const event = await this.repo.claim(eventId, new Date(Date.now() - STALE_LOCK_MS), max);
    if (!event) return null;

    const handler = this.handlers.get(event.topic);
    if (!handler) {
      await this.repo.markSkipped(event.id, `No handler for topic ${event.topic}`);
      return 'SKIPPED';
    }

    try {
      const outcome = await handler.handle(event);
      if (outcome.status === 'skipped') {
        await this.repo.markSkipped(event.id, outcome.reason);
        this.logger.warn({ event: 'webhook.skipped', eventId: event.id, topic: event.topic, reason: outcome.reason });
        return 'SKIPPED';
      }
      await this.repo.markProcessed(event.id);
      this.logger.log({ event: 'webhook.processed', eventId: event.id, topic: event.topic, shopifyOrderId: event.shopifyOrderId, attempt: event.retryCount + 1 });
      return 'PROCESSED';
    } catch (e) {
      return this.fail(event, e, max);
    }
  }

  /** Recovery loop: retries due failures and rescues undispatched / stuck events. */
  async recoverDue(): Promise<number> {
    const now = Date.now();
    const ids = await this.repo.findDue(
      new Date(now),
      new Date(now - UNDISPATCHED_AFTER_MS),
      new Date(now - STALE_LOCK_MS),
      this.config.webhooks.maxRetries,
    );
    for (const id of ids) {
      await this.process(id).catch((e: unknown) =>
        this.logger.error({ event: 'webhook.recovery_error', eventId: id }, (e as Error).stack),
      );
    }
    if (ids.length) this.logger.log({ event: 'webhook.recovery_run', count: ids.length });
    return ids.length;
  }

  private async fail(event: WebhookEvent, e: unknown, max: number): Promise<string> {
    const permanent = e instanceof PermanentWebhookError;
    const retryCount = permanent ? max : event.retryCount + 1;
    const exhausted = retryCount >= max;
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    await this.repo.markFailed(event.id, {
      retryCount,
      nextRetryAt: exhausted ? null : new Date(Date.now() + backoffMs(retryCount)),
      errorMessage: message,
    });
    this.logger[exhausted ? 'error' : 'warn']({
      event: exhausted ? 'webhook.failed_permanently' : 'webhook.failed_will_retry',
      eventId: event.id,
      topic: event.topic,
      retryCount,
      error: message,
    });
    return 'FAILED';
  }
}
