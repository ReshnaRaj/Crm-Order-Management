import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { SyncType } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AppException } from '../common/utils/app.exception';
import { ConnectQueryDto, ProductSearchQueryDto } from './dto/shopify.dto';
import { OrderImportService } from './order-import.service';
import { ShopifyService } from './shopify.service';
import { SyncRunRepository } from './sync-run.repository';

@ApiTags('Shopify')
@ApiBearerAuth()
@Controller('shopify')
export class ShopifyController {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly importer: OrderImportService,
    private readonly runs: SyncRunRepository,
  ) {}

  @Get('connect')
  @ApiOperation({ summary: 'Start OAuth: returns the Shopify authorization URL to redirect the browser to' })
  connect(@CurrentUser() user: AuthenticatedUser, @Query() q: ConnectQueryDto) {
    return this.shopify.createAuthorizationUrl(user.id, q.shop);
  }

  @Public()
  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const url = await this.shopify.handleCallback(query);
    res.redirect(302, url);
  }

  @Get('status')
  @SkipThrottle()
  @ApiOperation({ summary: 'Connection status, scopes and latest import/sync runs' })
  status() {
    return this.shopify.getStatus();
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-validate the stored access token against Shopify' })
  verify() {
    return this.shopify.verifyConnection();
  }

  @Post('import-orders')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a full import of all Shopify orders (runs in background)' })
  @ApiAcceptedResponse({ description: 'SyncRun created' })
  importOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.importer.start(SyncType.IMPORT, user.id);
  }

  @Post('sync-orders')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start an incremental sync of orders updated since the last sync' })
  syncOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.importer.start(SyncType.SYNC, user.id);
  }

  @Get('sync-runs/:id')
  @SkipThrottle()
  async syncRun(@Param('id', ParseUUIDPipe) id: string) {
    const run = await this.runs.findById(id);
    if (!run) throw new AppException('NOT_FOUND', 'Sync run not found', HttpStatus.NOT_FOUND);
    return run;
  }

  @Post('webhooks/register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ensure orders/create, orders/updated and app/uninstalled webhooks exist' })
  registerWebhooks() {
    return this.shopify.registerWebhooks();
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Forget the stored access token (uninstall the app in Shopify admin to fully revoke)' })
  disconnect() {
    return this.shopify.disconnect();
  }

  @Get('products')
  @ApiOperation({ summary: 'Search active products and variants in the connected store' })
  products(@Query() q: ProductSearchQueryDto) {
    return this.shopify.searchProducts(q.search, q.after);
  }
}
