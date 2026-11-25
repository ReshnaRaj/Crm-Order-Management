import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { ListWebhookLogsQueryDto } from './dto/webhook.dto';
import { ShopifyHmacGuard } from './guards/shopify-hmac.guard';
import { WebhooksService } from './webhooks.service';

type WebhookHeaders = Record<string, string | string[] | undefined>;

/**
 * Shopify → CRM webhook receivers. Public (Shopify has no user JWT) but protected by
 * HMAC verification of the raw body. They respond 200 as soon as the event is persisted.
 */
@ApiTags('Webhooks (Shopify)')
@Public()
@SkipThrottle()
@UseGuards(ShopifyHmacGuard)
@ApiHeader({ name: 'X-Shopify-Hmac-Sha256', required: true })
@ApiHeader({ name: 'X-Shopify-Webhook-Id', required: true })
@ApiHeader({ name: 'X-Shopify-Shop-Domain', required: true })
@Controller('webhooks/shopify')
export class ShopifyWebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('orders-create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'orders/create webhook receiver' })
  ordersCreate(@Headers() headers: WebhookHeaders, @Body() payload: unknown) {
    return this.webhooks.receive({ expectedTopic: 'orders/create', headers, payload });
  }

  @Post('orders-update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'orders/updated webhook receiver' })
  ordersUpdate(@Headers() headers: WebhookHeaders, @Body() payload: unknown) {
    return this.webhooks.receive({ expectedTopic: 'orders/updated', headers, payload });
  }

  @Post('app-uninstalled')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'app/uninstalled webhook receiver (marks the store disconnected)' })
  appUninstalled(@Headers() headers: WebhookHeaders, @Body() payload: unknown) {
    return this.webhooks.receive({ expectedTopic: 'app/uninstalled', headers, payload });
  }
}

@ApiTags('Webhook Logs')
@ApiBearerAuth()
@Controller('webhooks/logs')
export class WebhookLogsController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@Query() q: ListWebhookLogsQueryDto) {
    return this.webhooks.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.get(id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually re-process a failed or skipped webhook event' })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.retry(id);
  }
}
