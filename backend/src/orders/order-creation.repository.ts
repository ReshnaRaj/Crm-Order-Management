import { Injectable } from '@nestjs/common';
import { OrderCreationRequest, OrderCreationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrderCreationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByKey(idempotencyKey: string) {
    return this.prisma.orderCreationRequest.findUnique({ where: { idempotencyKey } });
  }

  findById(id: string) {
    return this.prisma.orderCreationRequest.findUnique({ where: { id } });
  }

  /** Throws P2002 if another request with the same key was created concurrently. */
  create(data: {
    idempotencyKey: string;
    userId: string;
    storeId: string;
    requestPayload: Prisma.InputJsonValue;
    payloadHash: string;
  }) {
    return this.prisma.orderCreationRequest.create({
      data: { ...data, status: OrderCreationStatus.PENDING, attempts: 1 },
    });
  }

  /**
   * Atomically moves a request from one of `from` statuses to PENDING (claim).
   * Returns false if someone else claimed it first.
   */
  async claim(id: string, from: OrderCreationStatus[]): Promise<boolean> {
    const { count } = await this.prisma.orderCreationRequest.updateMany({
      where: { id, status: { in: from } },
      data: { status: OrderCreationStatus.PENDING, attempts: { increment: 1 } },
    });
    return count === 1;
  }

  update(id: string, data: Prisma.OrderCreationRequestUpdateInput): Promise<OrderCreationRequest> {
    return this.prisma.orderCreationRequest.update({ where: { id }, data });
  }

  /** Requests needing reconciliation: UNKNOWN, or PENDING ones abandoned by a crash. */
  findReconcilable(stalePendingBefore: Date, maxAttempts: number) {
    return this.prisma.orderCreationRequest.findMany({
      where: {
        attempts: { lt: maxAttempts },
        OR: [
          { status: OrderCreationStatus.UNKNOWN },
          { status: OrderCreationStatus.PENDING, updatedAt: { lt: stalePendingBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
  }
}
