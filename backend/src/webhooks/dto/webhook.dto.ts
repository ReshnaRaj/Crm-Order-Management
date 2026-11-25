import { ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookProcessingStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class ListWebhookLogsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ enum: WebhookProcessingStatus })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(Object.values(WebhookProcessingStatus))
  status?: WebhookProcessingStatus;

  @ApiPropertyOptional({ example: 'orders/create' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(['orders/create', 'orders/updated', 'app/uninstalled'])
  topic?: string;

  @ApiPropertyOptional({ description: 'Partial event id or Shopify order id' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  search?: string;
}
