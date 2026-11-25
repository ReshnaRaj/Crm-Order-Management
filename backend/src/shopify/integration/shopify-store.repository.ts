import { Injectable } from '@nestjs/common';
import { OAuthState, Prisma, ShopifyStore, StoreConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ShopifyStoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<ShopifyStore | null> {
    return this.prisma.shopifyStore.findUnique({ where: { id } });
  }

  findByDomain(shopDomain: string): Promise<ShopifyStore | null> {
    return this.prisma.shopifyStore.findUnique({ where: { shopDomain } });
  }

  /** The store the CRM currently works against (most recently updated connected store). */
  findActive(): Promise<ShopifyStore | null> {
    return this.prisma.shopifyStore.findFirst({
      where: { connectionStatus: StoreConnectionStatus.CONNECTED },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Latest store regardless of status (for status display). */
  findLatest(): Promise<ShopifyStore | null> {
    return this.prisma.shopifyStore.findFirst({ orderBy: { updatedAt: 'desc' } });
  }

  upsertConnected(data: {
    shopDomain: string;
    shopifyStoreId: string;
    name: string;
    currency: string;
    accessToken: string;
    scopes: string;
    connectedById: string;
  }): Promise<ShopifyStore> {
    const fields = {
      shopifyStoreId: data.shopifyStoreId,
      name: data.name,
      currency: data.currency,
      accessToken: data.accessToken,
      scopes: data.scopes,
      connectedById: data.connectedById,
      connectionStatus: StoreConnectionStatus.CONNECTED,
      lastError: null,
    };
    return this.prisma.shopifyStore.upsert({
      where: { shopDomain: data.shopDomain },
      create: { shopDomain: data.shopDomain, ...fields },
      update: fields,
    });
  }

  update(id: string, data: Prisma.ShopifyStoreUpdateInput): Promise<ShopifyStore> {
    return this.prisma.shopifyStore.update({ where: { id }, data });
  }

  async markStatus(id: string, status: StoreConnectionStatus, lastError: string | null) {
    await this.prisma.shopifyStore.update({
      where: { id },
      data: { connectionStatus: status, lastError },
    });
  }

  async markDisconnectedByDomain(shopDomain: string, reason: string) {
    await this.prisma.shopifyStore.updateMany({
      where: { shopDomain },
      data: {
        connectionStatus: StoreConnectionStatus.DISCONNECTED,
        accessToken: null,
        lastError: reason,
      },
    });
  }

  // ───── OAuth state (CSRF protection for the install flow) ─────

  createOAuthState(data: { state: string; shopDomain: string; userId: string; expiresAt: Date }) {
    return this.prisma.oAuthState.create({ data });
  }

  /** Atomically consumes a state nonce (single use). */
  async consumeOAuthState(state: string): Promise<OAuthState | null> {
    try {
      return await this.prisma.oAuthState.delete({ where: { state } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return null;
      throw e;
    }
  }

  async purgeExpiredOAuthStates(now = new Date()) {
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: now } } });
  }
}
