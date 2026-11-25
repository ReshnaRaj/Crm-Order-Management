import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoreConnectionStatus } from '@prisma/client';
import { AppException } from '../common/utils/app.exception';
import { randomToken } from '../common/utils/crypto.util';
import { AppConfigService } from '../config/app-config.service';
import { ShopifyError } from './integration/shopify.errors';
import { ShopifyOAuthService } from './integration/shopify-oauth.service';
import { ShopifyProductsApi } from './integration/shopify-products.api';
import { ShopifyShopApi, WebhookRegistration } from './integration/shopify-shop.api';
import { ShopifyStoreContextService } from './integration/shopify-store-context.service';
import { ShopifyStoreRepository } from './integration/shopify-store.repository';
import { SyncRunRepository } from './sync-run.repository';

const OAUTH_STATE_TTL_MS = 10 * 60_000;

/** Webhook topics the CRM subscribes to and the local route that receives each. */
export const WEBHOOK_TOPICS: { topic: string; path: string }[] = [
  { topic: 'ORDERS_CREATE', path: '/api/webhooks/shopify/orders-create' },
  { topic: 'ORDERS_UPDATED', path: '/api/webhooks/shopify/orders-update' },
  { topic: 'APP_UNINSTALLED', path: '/api/webhooks/shopify/app-uninstalled' },
];

export interface ConnectionStatusDto {
  connected: boolean;
  store: {
    id: string;
    shopDomain: string;
    name: string | null;
    currency: string | null;
    connectionStatus: StoreConnectionStatus;
    scopes: string[];
    lastError: string | null;
    lastSyncAt: Date | null;
    webhooksRegisteredAt: Date | null;
    connectedAt: Date;
  } | null;
  requiredScopes: string[];
  missingScopes: string[];
  activeRun: unknown;
  lastRun: unknown;
  recentRuns: unknown[];
}

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly oauth: ShopifyOAuthService,
    private readonly stores: ShopifyStoreRepository,
    private readonly context: ShopifyStoreContextService,
    private readonly shopApi: ShopifyShopApi,
    private readonly productsApi: ShopifyProductsApi,
    private readonly runs: SyncRunRepository,
  ) {}

  /** Step 1 of OAuth: returns the Shopify authorization URL for the browser to visit. */
  async createAuthorizationUrl(userId: string, shopInput: string): Promise<{ authorizationUrl: string; shop: string }> {
    const shop = this.oauth.normaliseShopDomain(shopInput);
    if (!shop) {
      throw new AppException(
        'INVALID_SHOP_DOMAIN',
        'Enter a valid Shopify store domain, e.g. my-store.myshopify.com',
        HttpStatus.BAD_REQUEST,
      );
    }
    const state = randomToken(24);
    await this.stores.createOAuthState({
      state,
      shopDomain: shop,
      userId,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });
    return { authorizationUrl: this.oauth.buildAuthorizeUrl(shop, state), shop };
  }

  /**
   * Step 2 of OAuth (Shopify redirects here). Returns the frontend URL to redirect to.
   * Never throws to the browser: failures are reported via query params.
   */
  async handleCallback(query: Record<string, unknown>): Promise<string> {
    const back = (params: Record<string, string>) =>
      `${this.config.frontendUrl}/integrations/shopify?${new URLSearchParams(params).toString()}`;

    try {
      if (!this.oauth.verifyCallbackHmac(query)) {
        this.logger.warn({ event: 'shopify.oauth_hmac_invalid' });
        return back({ status: 'error', reason: 'invalid_signature' });
      }
      const shop = typeof query.shop === 'string' ? query.shop.toLowerCase() : '';
      const code = typeof query.code === 'string' ? query.code : '';
      const stateParam = typeof query.state === 'string' ? query.state : '';
      if (!this.oauth.isValidShopDomain(shop) || !code || !stateParam) {
        return back({ status: 'error', reason: 'invalid_request' });
      }

      const state = await this.stores.consumeOAuthState(stateParam);
      if (!state || state.expiresAt < new Date() || state.shopDomain !== shop) {
        return back({ status: 'error', reason: 'invalid_state' });
      }

      const token = await this.oauth.exchangeCodeForToken(shop, code);
      const creds = { shopDomain: shop, accessToken: token.accessToken };
      const shopInfo = await this.shopApi.getShop(creds); // validates the token works

      const store = await this.stores.upsertConnected({
        shopDomain: shop,
        shopifyStoreId: shopInfo.id,
        name: shopInfo.name,
        currency: shopInfo.currencyCode,
        accessToken: this.context.encryptToken(token.accessToken),
        scopes: token.scopes,
        connectedById: state.userId,
      });
      this.logger.log({ event: 'shopify.connected', shop, storeId: store.id });

      try {
        await this.shopApi.ensureWebhooks(creds, this.webhookRegistrations());
        await this.stores.update(store.id, { webhooksRegisteredAt: new Date() });
      } catch (e) {
        const msg = `Webhook registration failed: ${(e as Error).message}`;
        this.logger.warn({ event: 'shopify.webhook_registration_failed', shop, error: (e as Error).message });
        await this.stores.update(store.id, { lastError: msg.slice(0, 500) });
        return back({ status: 'connected', warning: 'webhooks_failed' });
      }
      return back({ status: 'connected' });
    } catch (e) {
      this.logger.error(
        { event: 'shopify.oauth_failed', error: e instanceof ShopifyError ? e.code : 'UNEXPECTED' },
        e instanceof Error ? e.stack : undefined,
      );
      return back({ status: 'error', reason: e instanceof ShopifyError ? e.code.toLowerCase() : 'unexpected' });
    }
  }

  webhookRegistrations(): WebhookRegistration[] {
    const base = this.config.shopify.webhookBaseUrl;
    return WEBHOOK_TOPICS.map((w) => ({ topic: w.topic, uri: `${base}${w.path}` }));
  }

  async getStatus(): Promise<ConnectionStatusDto> {
    const store = await this.stores.findLatest();
    const required = this.config.shopify.scopes;
    if (!store) {
      return {
        connected: false,
        store: null,
        requiredScopes: required,
        missingScopes: required,
        activeRun: null,
        lastRun: null,
        recentRuns: [],
      };
    }
    const granted = (store.scopes ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    // write_x implies read_x in Shopify
    const has = (s: string) => granted.includes(s) || granted.includes(s.replace(/^read_/, 'write_'));
    const [activeRun, lastRun, recentRuns] = await Promise.all([
      this.runs.findRunning(store.id),
      this.runs.findLatest(store.id),
      this.runs.listRecent(store.id, 5),
    ]);
    return {
      connected: store.connectionStatus === StoreConnectionStatus.CONNECTED,
      store: {
        id: store.id,
        shopDomain: store.shopDomain,
        name: store.name,
        currency: store.currency,
        connectionStatus: store.connectionStatus,
        scopes: granted,
        lastError: store.lastError,
        lastSyncAt: store.lastSyncAt,
        webhooksRegisteredAt: store.webhooksRegisteredAt,
        connectedAt: store.createdAt,
      },
      requiredScopes: required,
      missingScopes: required.filter((s) => !has(s)),
      activeRun,
      lastRun,
      recentRuns,
    };
  }

  /** Re-validates the stored token against Shopify and refreshes shop metadata. */
  async verifyConnection() {
    const ctx = await this.context.getActive();
    try {
      const shop = await this.shopApi.getShop(ctx.creds);
      await this.stores.update(ctx.store.id, {
        name: shop.name,
        currency: shop.currencyCode,
        lastError: null,
        connectionStatus: StoreConnectionStatus.CONNECTED,
      });
      return this.getStatus();
    } catch (e) {
      await this.context.handleFailure(ctx.store, e);
      throw this.context.toHttpException(e);
    }
  }

  async registerWebhooks() {
    return this.context.run(async ({ store, creds }) => {
      const result = await this.shopApi.ensureWebhooks(creds, this.webhookRegistrations());
      await this.stores.update(store.id, { webhooksRegisteredAt: new Date(), lastError: null });
      return result;
    });
  }

  async disconnect() {
    const store = await this.stores.findLatest();
    if (!store) throw new AppException('SHOPIFY_NOT_CONNECTED', 'No store connected', HttpStatus.NOT_FOUND);
    await this.stores.update(store.id, {
      connectionStatus: StoreConnectionStatus.DISCONNECTED,
      accessToken: null,
      lastError: null,
    });
    this.logger.log({ event: 'shopify.disconnected', shop: store.shopDomain });
    return { disconnected: true };
  }

  searchProducts(search: string | undefined, after: string | undefined) {
    return this.context.run(({ creds, store }) =>
      this.productsApi
        .searchProducts(creds, search, after ?? null)
        .then((page) => ({ ...page, currency: store.currency })),
    );
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async purgeOAuthStates() {
    await this.stores.purgeExpiredOAuthStates();
  }
}
