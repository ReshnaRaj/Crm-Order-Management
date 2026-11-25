import { Module } from '@nestjs/common';
import {
  defaultSleep,
  SHOPIFY_FETCH,
  SHOPIFY_SLEEP,
  ShopifyGraphQLClient,
} from './shopify.client';
import { ShopifyOAuthService } from './shopify-oauth.service';
import { ShopifyOrdersApi } from './shopify-orders.api';
import { ShopifyProductsApi } from './shopify-products.api';
import { ShopifyShopApi } from './shopify-shop.api';
import { ShopifyStoreContextService } from './shopify-store-context.service';
import { ShopifyStoreRepository } from './shopify-store.repository';
import { ShopifyWebhookVerifier } from './shopify-webhook-verifier';

/**
 * Integration layer: everything that talks to Shopify lives here, isolated from
 * CRM business logic. It is an in-process module, not a separate service.
 */
@Module({
  providers: [
    { provide: SHOPIFY_FETCH, useValue: globalThis.fetch.bind(globalThis) },
    { provide: SHOPIFY_SLEEP, useValue: defaultSleep },
    ShopifyGraphQLClient,
    ShopifyOAuthService,
    ShopifyOrdersApi,
    ShopifyProductsApi,
    ShopifyShopApi,
    ShopifyWebhookVerifier,
    ShopifyStoreRepository,
    ShopifyStoreContextService,
  ],
  exports: [
    ShopifyGraphQLClient,
    ShopifyOAuthService,
    ShopifyOrdersApi,
    ShopifyProductsApi,
    ShopifyShopApi,
    ShopifyWebhookVerifier,
    ShopifyStoreRepository,
    ShopifyStoreContextService,
  ],
})
export class ShopifyIntegrationModule {}
