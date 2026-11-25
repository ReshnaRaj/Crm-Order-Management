import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const E164_HINT = 'Phone must be in international format, e.g. +14155550123';

export class AddressDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255) company?: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) address1: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255) address2?: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) city: string;
  @ApiPropertyOptional({ example: 'CA' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(10) provinceCode?: string;
  @ApiProperty({ example: 'US', description: 'ISO 3166-1 alpha-2' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be a 2-letter ISO code' })
  countryCode: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(20) zip?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+[1-9]\d{6,14}$/, { message: E164_HINT }) phone?: string;
}

export class OrderCustomerDto {
  @ApiPropertyOptional({ description: 'Local CRM customer id to associate (must already exist in Shopify)' })
  @IsOptional()
  @IsUUID()
  existingCustomerId?: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) firstName: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) lastName: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+[1-9]\d{6,14}$/, { message: E164_HINT }) phone?: string;
}

export class OrderLineItemDto {
  @ApiProperty({ example: 'gid://shopify/ProductVariant/123' })
  @Matches(/^gid:\/\/shopify\/ProductVariant\/\d+$/, { message: 'variantId must be a Shopify ProductVariant GID' })
  variantId: string;

  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

export class ShippingLineDto {
  @ApiProperty({ example: 'Standard shipping' }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) title: string;
  @ApiProperty({ example: '5.00' }) @Matches(MONEY, { message: 'amount must be a non-negative decimal with up to 2 places' }) amount: string;
}

export class DiscountDto {
  @ApiProperty({ example: 'CRM10' }) @Transform(trim) @IsString() @Length(1, 50) code: string;
  @ApiProperty({ example: '10.00', description: 'Fixed amount off the order' })
  @Matches(MONEY, { message: 'amount must be a non-negative decimal with up to 2 places' })
  amount: string;
}

export class CreateOrderDto {
  @ApiProperty({ description: 'Client-generated UUID; resubmitting the same key never creates a second order' })
  @IsUUID()
  idempotencyKey: string;

  @ApiProperty({ type: OrderCustomerDto })
  @ValidateNested()
  @Type(() => OrderCustomerDto)
  customer: OrderCustomerDto;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  billingAddress?: AddressDto;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress?: AddressDto;

  @ApiProperty({ type: [OrderLineItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one line item is required' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineItemDto)
  lineItems: OrderLineItemDto[];

  @ApiPropertyOptional({ type: ShippingLineDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingLineDto)
  shippingLine?: ShippingLineDto;

  @ApiPropertyOptional({ type: DiscountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(5000) note?: string;
}
