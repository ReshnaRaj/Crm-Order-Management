import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ShopifyIntegrationModule } from '../shopify/integration/shopify-integration.module';
import { OrderCreationRepository } from './order-creation.repository';
import { OrderCreationService } from './order-creation.service';
import { OrderSyncService } from './order-sync.service';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  imports: [CustomersModule, ShopifyIntegrationModule],
  controllers: [OrdersController],
  providers: [OrdersRepository, OrdersService, OrderSyncService, OrderCreationRepository, OrderCreationService],
  exports: [OrderSyncService, OrdersRepository],
})
export class OrdersModule {}
