import { Injectable } from '@nestjs/common';
import { Prisma, SyncRun, SyncStatus, SyncType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SyncRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a RUNNING run unless one is already running for the store.
   * Serializable isolation makes the check-and-insert atomic under concurrency.
   */
  async createIfIdle(storeId: string, type: SyncType, triggeredById: string | null): Promise<SyncRun | null> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const running = await tx.syncRun.findFirst({ where: { storeId, status: SyncStatus.RUNNING } });
          if (running) return null;
          return tx.syncRun.create({ data: { storeId, type, triggeredById } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // serialization failure => another request won the race
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return null;
      throw e;
    }
  }

  findRunning(storeId: string) {
    return this.prisma.syncRun.findFirst({ where: { storeId, status: SyncStatus.RUNNING } });
  }

  findLatest(storeId: string) {
    return this.prisma.syncRun.findFirst({ where: { storeId }, orderBy: { startedAt: 'desc' } });
  }

  findLatestSucceeded(storeId: string) {
    return this.prisma.syncRun.findFirst({
      where: { storeId, status: SyncStatus.SUCCEEDED },
      orderBy: { startedAt: 'desc' },
    });
  }

  findById(id: string) {
    return this.prisma.syncRun.findUnique({ where: { id } });
  }

  listRecent(storeId: string, take = 10) {
    return this.prisma.syncRun.findMany({ where: { storeId }, orderBy: { startedAt: 'desc' }, take });
  }

  update(id: string, data: Prisma.SyncRunUpdateInput) {
    return this.prisma.syncRun.update({ where: { id }, data });
  }

  /** Marks runs left RUNNING by a crashed/restarted process as failed. */
  async failStale(olderThan: Date, message: string) {
    const { count } = await this.prisma.syncRun.updateMany({
      where: { status: SyncStatus.RUNNING, startedAt: { lt: olderThan } },
      data: { status: SyncStatus.FAILED, finishedAt: new Date(), errorMessage: message },
    });
    return count;
  }
}
