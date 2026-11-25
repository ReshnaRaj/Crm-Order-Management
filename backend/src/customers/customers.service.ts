import { Injectable } from '@nestjs/common';
import { Customer } from '@prisma/client';
import { CustomersRepository } from './customers.repository';

export interface CustomerDto {
  id: string;
  shopifyCustomerId: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: unknown;
  shippingAddress: unknown;
}

const toDto = (c: Customer): CustomerDto => ({
  id: c.id,
  shopifyCustomerId: c.shopifyCustomerId,
  name: c.name,
  firstName: c.firstName,
  lastName: c.lastName,
  email: c.email,
  phone: c.phone,
  billingAddress: c.billingAddress,
  shippingAddress: c.shippingAddress,
});

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  async search(search: string | undefined, limit: number): Promise<CustomerDto[]> {
    const rows = await this.customers.search({ search, limit });
    return rows.map(toDto);
  }
}
