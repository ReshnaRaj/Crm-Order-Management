import { HttpStatus, Injectable } from '@nestjs/common';
import { Paginated } from '../common/interfaces/api-response.interface';
import { AppException } from '../common/utils/app.exception';
import { paginate } from '../common/utils/pagination.util';
import { ListOrdersQueryDto } from './dto/list-orders.dto';
import { OrderDetailsDto, OrderListItemDto, toDetails, toListItem } from './dto/order-response.dto';
import { OrdersRepository } from './orders.repository';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  async list(q: ListOrdersQueryDto): Promise<Paginated<OrderListItemDto>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const dateFrom = q.dateFrom ? new Date(q.dateFrom) : undefined;
    // A date-only upper bound includes the entire day.
    const dateTo = q.dateTo
      ? new Date(DATE_ONLY.test(q.dateTo) ? `${q.dateTo}T23:59:59.999Z` : q.dateTo)
      : undefined;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new AppException('INVALID_DATE_RANGE', 'Start date must be before end date', HttpStatus.BAD_REQUEST);
    }

    const { rows, total } = await this.orders.list({
      page,
      pageSize,
      search: q.search,
      orderStatus: q.orderStatus,
      fulfillmentStatus: q.fulfillmentStatus,
      financialStatus: q.financialStatus,
      dateFrom,
      dateTo,
      sortBy: q.sortBy ?? 'orderDate',
      sortOrder: q.sortOrder ?? 'desc',
    });
    return paginate(rows.map(toListItem), total, page, pageSize);
  }

  async getById(id: string): Promise<OrderDetailsDto> {
    const order = await this.orders.findDetails(id);
    if (!order) throw new AppException('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    return toDetails(order);
  }

  async summary() {
    const s = await this.orders.summary();
    return {
      totalOrders: s.total,
      pendingOrders: s.pending,
      fulfilledOrders: s.fulfilled,
      cancelledOrders: s.cancelled,
      totalSales: s.sales.map((row) => ({
        currency: row.currency,
        amount: (row._sum?.totalAmount ?? 0).toFixed(2),
        orders: typeof row._count === 'object' ? (row._count._all ?? 0) : 0,
      })),
      recentOrders: s.recent.map(toListItem),
    };
  }

  /** Distinct status values present in the data, for filter dropdowns. */
  filterOptions() {
    return this.orders.distinctStatuses();
  }
}
