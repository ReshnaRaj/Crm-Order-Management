import { Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';
import { NormalizedAddress, NormalizedCustomer } from '../shopify/integration/normalized-order';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts or updates a customer. Only non-empty incoming values overwrite existing ones,
   * because some payloads (e.g. webhooks without protected-data access) omit fields.
   */
  upsertFromShopify(
    tx: PrismaTx,
    storeId: string,
    c: NormalizedCustomer,
    addresses: { billing: NormalizedAddress | null; shipping: NormalizedAddress | null },
  ): Promise<Customer> {
    const json = (a: NormalizedAddress | null) => (a ? (a as Prisma.InputJsonObject) : undefined);
    const present = <T>(v: T | null) => (v === null ? undefined : v);
    return tx.customer.upsert({
      where: { storeId_shopifyCustomerId: { storeId, shopifyCustomerId: c.shopifyCustomerId } },
      create: {
        storeId,
        shopifyCustomerId: c.shopifyCustomerId,
        name: c.name,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        billingAddress: json(addresses.billing),
        shippingAddress: json(addresses.shipping),
      },
      update: {
        name: present(c.name),
        firstName: present(c.firstName),
        lastName: present(c.lastName),
        email: present(c.email),
        phone: present(c.phone),
        billingAddress: json(addresses.billing),
        shippingAddress: json(addresses.shipping),
      },
    });
  }

  search(params: { search?: string; storeId?: string; limit: number }) {
    const q = params.search?.trim();
    return this.prisma.customer.findMany({
      where: {
        storeId: params.storeId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: params.limit,
    });
  }

  findById(id: string) {
    return this.prisma.customer.findUnique({ where: { id } });
  }
}
