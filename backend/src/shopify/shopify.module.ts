import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ShopifyIntegrationModule } from './integration/shopify-integration.module';
import { OrderImportService } from './order-import.service';
import { ShopifyController } from './shopify.controller';
import { ShopifyService } from './shopify.service';
import { SyncRunRepository } from './sync-run.repository';

/** Shopify connection management + order import/sync workflows. */
@Module({
  imports: [ShopifyIntegrationModule, OrdersModule],
  controllers: [ShopifyController],
  providers: [ShopifyService, OrderImportService, SyncRunRepository],
  exports: [ShopifyService],
})
export class ShopifyModule {}
