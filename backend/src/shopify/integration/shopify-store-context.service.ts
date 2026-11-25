import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ShopifyStore, StoreConnectionStatus } from '@prisma/client';
import { AppException } from '../../common/utils/app.exception';
import { decryptSecret, encryptSecret } from '../../common/utils/crypto.util';
import { AppConfigService } from '../../config/app-config.service';
import { ShopifyCredentials } from './shopify.client';
import { ShopifyAuthError, ShopifyError, ShopifyUserError } from './shopify.errors';
import { ShopifyStoreRepository } from './shopify-store.repository';

export interface StoreContext {
  store: ShopifyStore;
  creds: ShopifyCredentials;
}

/**
 * Resolves the connected store + decrypted credentials, and centralises how Shopify
 * failures are translated (marking revoked tokens, mapping to safe HTTP errors).
 */
@Injectable()
export class ShopifyStoreContextService {
  private readonly logger = new Logger(ShopifyStoreContextService.name);

  constructor(
    private readonly stores: ShopifyStoreRepository,
    private readonly config: AppConfigService,
  ) {}

  encryptToken(token: string) {
    return encryptSecret(token, this.config.encryptionKey);
  }

  credentialsFor(store: ShopifyStore): ShopifyCredentials {
    if (!store.accessToken) {
      throw new AppException('SHOPIFY_NOT_CONNECTED', 'Shopify store is not connected', HttpStatus.CONFLICT);
    }
    return {
      shopDomain: store.shopDomain,
      accessToken: decryptSecret(store.accessToken, this.config.encryptionKey),
    };
  }

  async getActive(): Promise<StoreContext> {
    const store = await this.stores.findActive();
    if (!store) {
      throw new AppException(
        'SHOPIFY_NOT_CONNECTED',
        'No Shopify store is connected. Connect a store on the Shopify Integration page.',
        HttpStatus.CONFLICT,
      );
    }
    return { store, creds: this.credentialsFor(store) };
  }

  /** Records auth failures on the store so the UI can prompt for reconnection. */
  async handleFailure(store: ShopifyStore, err: unknown): Promise<void> {
    if (err instanceof ShopifyAuthError) {
      const status = err.status === 401 ? StoreConnectionStatus.INVALID_TOKEN : StoreConnectionStatus.ERROR;
      await this.stores.markStatus(store.id, status, err.message);
      this.logger.warn({ event: 'shopify.auth_failed', shop: store.shopDomain, status: err.status });
    }
  }

  /** Maps integration errors to client-safe HTTP exceptions. */
  toHttpException(err: unknown): unknown {
    if (!(err instanceof ShopifyError)) return err;
    if (err instanceof ShopifyUserError) {
      return new AppException(err.code, err.message, HttpStatus.UNPROCESSABLE_ENTITY, err.userErrors);
    }
    if (err instanceof ShopifyAuthError) {
      return new AppException(
        err.code,
        'Shopify rejected our credentials. Please reconnect the store.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const statusByCode: Record<string, HttpStatus> = {
      SHOPIFY_RATE_LIMITED: HttpStatus.SERVICE_UNAVAILABLE,
      SHOPIFY_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
    };
    return new AppException(
      err.code,
      err.code === 'SHOPIFY_RATE_LIMITED'
        ? 'Shopify is rate limiting requests, please retry shortly'
        : 'Shopify is currently unavailable, please retry',
      statusByCode[err.code] ?? HttpStatus.BAD_GATEWAY,
    );
  }

  /** Convenience wrapper: run a Shopify call for the active store with consistent error handling. */
  async run<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T> {
    const ctx = await this.getActive();
    try {
      return await fn(ctx);
    } catch (e) {
      await this.handleFailure(ctx.store, e);
      throw this.toHttpException(e);
    }
  }
}
