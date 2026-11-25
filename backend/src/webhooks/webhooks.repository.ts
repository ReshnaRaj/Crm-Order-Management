import { Injectable } from '@nestjs/common';
import { Prisma, WebhookEvent, WebhookProcessingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const { RECEIVED, PROCESSING, PROCESSED, FAILED, SKIPPED } = WebhookProcessingStatus;

export interface WebhookLogFilter {
  status?: WebhookProcessingStatus;
  topic?: string;
  search?: string;
}

export const webhookListSelect = {
  id: true,
  shopifyEventId: true,
  shopDomain: true,
  topic: true,
  shopifyOrderId: true,
  processingStatus: true,
  receivedAt: true,
  processedAt: true,
  retryCount: true,
  nextRetryAt: true,
  errorMessage: true,
} satisfies Prisma.WebhookEventSelect;

@Injectable()
export class WebhooksRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserts a new event. Throws P2002 when the same delivery was already stored. */
  create(data: Prisma.WebhookEventUncheckedCreateInput): Promise<WebhookEvent> {
    return this.prisma.webhookEvent.create({ data });
  }

  findById(id: string) {
    return this.prisma.webhookEvent.findUnique({ where: { id } });
  }

  /**
   * Atomically claims an event for processing. Only one worker can win, so concurrent
   * attempts (in-process dispatch + retry loop) never process the same event twice.
   */
  async claim(id: string, staleLockBefore: Date, maxRetries: number): Promise<WebhookEvent | null> {
    const { count } = await this.prisma.webhookEvent.updateMany({
      where: {
        id,
        OR: [
          { processingStatus: RECEIVED },
          { processingStatus: FAILED, retryCount: { lt: maxRetries } },
          { processingStatus: PROCESSING, lockedAt: { lt: staleLockBefore } },
        ],
      },
      data: { processingStatus: PROCESSING, lockedAt: new Date() },
    });
    return count === 1 ? this.findById(id) : null;
  }

  markProcessed(id: string, storeId?: string | null) {
    return this.prisma.webhookEvent.update({
      where: { id },
      data: {
        processingStatus: PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        nextRetryAt: null,
        errorMessage: null,
        ...(storeId ? { storeId } : {}),
      },
    });
  }

  markSkipped(id: string, reason: string) {
    return this.prisma.webhookEvent.update({
      where: { id },
      data: { processingStatus: SKIPPED, processedAt: new Date(), lockedAt: null, nextRetryAt: null, errorMessage: reason },
    });
  }

  markFailed(id: string, data: { retryCount: number; nextRetryAt: Date | null; errorMessage: string }) {
    return this.prisma.webhookEvent.update({
      where: { id },
      data: { processingStatus: FAILED, lockedAt: null, ...data },
    });
  }

  /** Events eligible for (re)processing by the recovery loop. */
  async findDue(now: Date, receivedBefore: Date, staleLockBefore: Date, maxRetries: number, take = 25) {
    const rows = await this.prisma.webhookEvent.findMany({
      where: {
        OR: [
          { processingStatus: RECEIVED, receivedAt: { lt: receivedBefore } },
          { processingStatus: FAILED, retryCount: { lt: maxRetries }, nextRetryAt: { lte: now } },
          { processingStatus: PROCESSING, lockedAt: { lt: staleLockBefore } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      select: { id: true },
      take,
    });
    return rows.map((r) => r.id);
  }

  async attachStore(id: string, storeId: string) {
    await this.prisma.webhookEvent.update({ where: { id }, data: { storeId } });
  }

  /** Makes a failed/skipped event eligible again (manual retry). */
  async resetForRetry(id: string): Promise<boolean> {
    const { count } = await this.prisma.webhookEvent.updateMany({
      where: { id, processingStatus: { in: [FAILED, SKIPPED] } },
      data: { processingStatus: FAILED, retryCount: 0, nextRetryAt: new Date(), lockedAt: null },
    });
    return count === 1;
  }

  private where(f: WebhookLogFilter): Prisma.WebhookEventWhereInput {
    const q = f.search?.trim();
    return {
      processingStatus: f.status,
      topic: f.topic,
      ...(q
        ? {
            OR: [
              { shopifyEventId: { contains: q, mode: 'insensitive' } },
              { shopifyOrderId: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async list(f: WebhookLogFilter, page: number, pageSize: number) {
    const where = this.where(f);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.webhookEvent.findMany({
        where,
        select: webhookListSelect,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return { rows, total };
  }

  async countsByStatus() {
    const rows = await this.prisma.webhookEvent.groupBy({
      by: ['processingStatus'],
      _count: { _all: true },
      orderBy: { processingStatus: 'asc' },
    });
    return Object.fromEntries(rows.map((r) => [r.processingStatus, r._count._all]));
  }
}
