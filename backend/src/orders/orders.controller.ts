import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderCreationStatus } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.dto';
import { OrderCreationService } from './order-creation.service';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly creation: OrderCreationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List orders with server-side search, filters, sorting and pagination' })
  list(@Query() q: ListOrdersQueryDto) {
    return this.orders.list(q);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Dashboard metrics computed from the database' })
  summary() {
    return this.orders.summary();
  }

  @Get('filters')
  @ApiOperation({ summary: 'Distinct fulfillment / financial statuses for filter dropdowns' })
  filters() {
    return this.orders.filterOptions();
  }

  @Get('creation-requests/:id')
  @ApiOperation({ summary: 'Status of a CRM order-creation request (for reconciliation)' })
  creationRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.creation.getRequest(id);
  }

  @Post('creation-requests/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-check Shopify for an order whose creation outcome was uncertain' })
  reconcile(@Param('id', ParseUUIDPipe) id: string) {
    return this.creation.reconcileById(id);
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an order in Shopify and persist it locally' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Overrides body.idempotencyKey' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idemHeader?: string,
  ) {
    const result = await this.creation.create(user.id, dto, idemHeader);
    // 201 = created (or replayed), 202 = accepted but outcome still being reconciled
    res.status(result.status === OrderCreationStatus.SUCCEEDED ? HttpStatus.CREATED : HttpStatus.ACCEPTED);
    return result;
  }
}
