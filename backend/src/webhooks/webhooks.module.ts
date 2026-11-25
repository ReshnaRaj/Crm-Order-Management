import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ShopifyIntegrationModule } from '../shopify/integration/shopify-integration.module';
import { ShopifyHmacGuard } from './guards/shopify-hmac.guard';
import {
  AppUninstalledWebhookHandler,
  OrderWebhookHandler,
  WEBHOOK_TOPIC_HANDLERS,
  WebhookTopicHandler,
} from './webhook-handlers';
import { WebhookProcessorService } from './webhook-processor.service';
import { ShopifyWebhooksController, WebhookLogsController } from './webhooks.controller';
import { WebhooksRepository } from './webhooks.repository';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [OrdersModule, ShopifyIntegrationModule],
  controllers: [ShopifyWebhooksController, WebhookLogsController],
  providers: [
    WebhooksService,
    WebhooksRepository,
    WebhookProcessorService,
    ShopifyHmacGuard,
    OrderWebhookHandler,
    AppUninstalledWebhookHandler,
    {
      provide: WEBHOOK_TOPIC_HANDLERS,
      inject: [OrderWebhookHandler, AppUninstalledWebhookHandler],
      useFactory: (...handlers: WebhookTopicHandler[]) => handlers,
    },
  ],
})
export class WebhooksModule {}
