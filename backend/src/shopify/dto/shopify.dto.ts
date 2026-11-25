import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConnectQueryDto {
  @ApiProperty({ example: 'my-store.myshopify.com' })
  @IsString()
  @MaxLength(255)
  shop: string;
}

export class ProductSearchQueryDto {
  @ApiPropertyOptional({ description: 'Partial product title or SKU' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Pagination cursor from a previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  after?: string;
}
