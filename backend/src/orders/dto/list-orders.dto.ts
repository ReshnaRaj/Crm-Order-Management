import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : undefined;

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Partial order number (e.g. "1001" or "#1001"), customer name or email' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @Transform(upper)
  @IsIn(Object.values(OrderStatus))
  orderStatus?: OrderStatus;

  @ApiPropertyOptional({ example: 'UNFULFILLED' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z_]{2,40}$/)
  fulfillmentStatus?: string;

  @ApiPropertyOptional({ example: 'PAID' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z_]{2,40}$/)
  financialStatus?: string;

  @ApiPropertyOptional({ description: 'Inclusive start (ISO date or datetime)', example: '2026-01-01' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive end (ISO date or datetime). Date-only values cover the whole day (UTC).', example: '2026-01-31' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601({ strict: true })
  dateTo?: string;

  @ApiPropertyOptional({ enum: ['orderDate', 'totalAmount'], default: 'orderDate' })
  @IsOptional()
  @IsIn(['orderDate', 'totalAmount'])
  sortBy?: 'orderDate' | 'totalAmount';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
