import { HttpStatus, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OrderSource, SyncRun, SyncStatus, SyncType } from '@prisma/client';
import { AppException } from '../common/utils/app.exception';
import { OrderSyncService } from '../orders/order-sync.service';
import { ShopifyError } from './integration/shopify.errors';
import { ShopifyOrdersApi } from './integration/shopify-orders.api';
import { ShopifyStoreContextService, StoreContext } from './integration/shopify-store-context.service';
import { ShopifyStoreRepository } from './integration/shopify-store.repository';
import { SyncRunRepository } from './sync-run.repository';

/** Overlap window for incremental syncs so edits racing the previous run are not missed. */
const SYNC_OVERLAP_MS = 5 * 60_000;
const MAX_PAGES = 10_000;

/**
 * Imports (full) and synchronises (incremental, by updated_at) orders from Shopify.
 * Runs execute in the background inside this process; progress is persisted in SyncRun.
 */
@Injectable()
export class OrderImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrderImportService.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly context: ShopifyStoreContextService,
    private readonly ordersApi: ShopifyOrdersApi,
    private readonly orderSync: OrderSyncService,
    private readonly runs: SyncRunRepository,
    private readonly stores: ShopifyStoreRepository,
  ) {}

  async onApplicationBootstrap() {
    // Any run still RUNNING at startup was interrupted by a restart.
    const n = await this.runs.failStale(new Date(), 'Interrupted by application restart');
    if (n) this.logger.warn({ event: 'sync.stale_runs_failed', count: n });
  }

  async start(type: SyncType, userId: string | null): Promise<SyncRun> {
    const ctx = await this.context.getActive();
    const run = await this.runs.createIfIdle(ctx.store.id, type, userId);
    if (!run) {
      throw new AppException(
        'SYNC_ALREADY_RUNNING',
        'An import/sync is already running for this store',
        HttpStatus.CONFLICT,
      );
    }
    const job = this.execute(run, ctx).finally(() => this.inFlight.delete(run.id));
    this.inFlight.set(run.id, job);
    return run;
  }

  /** Resolves when all in-flight runs have finished (used by tests and graceful shutdown). */
  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.inFlight.values()]);
  }

  private async execute(run: SyncRun, ctx: StoreContext): Promise<void> {
    const startedAt = run.startedAt;
    const counters = { ordersFetched: 0, ordersCreated: 0, ordersUpdated: 0, ordersSkipped: 0 };
    const updatedSince =
      run.type === SyncType.SYNC && ctx.store.lastSyncAt
        ? new Date(ctx.store.lastSyncAt.getTime() - SYNC_OVERLAP_MS)
        : undefined;

    this.logger.log({ event: 'sync.started', runId: run.id, type: run.type, shop: ctx.store.shopDomain, updatedSince });
    try {
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await this.ordersApi.fetchOrdersPage(ctx.creds, cursor, updatedSince);
        for (const order of result.orders) {
          const { action } = await this.orderSync.upsertFromShopify(ctx.store.id, order, OrderSource.SHOPIFY_IMPORT);
          counters.ordersFetched++;
          if (action === 'created') counters.ordersCreated++;
          else if (action === 'updated') counters.ordersUpdated++;
          else counters.ordersSkipped++;
        }
        await this.runs.update(run.id, counters);
        if (!result.hasNextPage || !result.endCursor) break;
        cursor = result.endCursor;
      }

      await this.runs.update(run.id, { ...counters, status: SyncStatus.SUCCEEDED, finishedAt: new Date() });
      await this.stores.update(ctx.store.id, { lastSyncAt: startedAt, lastError: null });
      this.logger.log({ event: 'sync.succeeded', runId: run.id, ...counters });
    } catch (e) {
      await this.context.handleFailure(ctx.store, e);
      const message =
        e instanceof ShopifyError ? `${e.code}: ${e.message}` : 'Unexpected error while importing orders';
      this.logger.error({ event: 'sync.failed', runId: run.id, ...counters }, e instanceof Error ? e.stack : String(e));
      await this.runs.update(run.id, {
        ...counters,
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message.slice(0, 1000),
      });
    }
  }
}
