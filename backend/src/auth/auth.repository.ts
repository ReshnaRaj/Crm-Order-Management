import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Persistence for revoked JWTs (logout denylist). */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async revokeToken(jti: string, expiresAt: Date): Promise<void> {
    await this.prisma.revokedToken.upsert({
      where: { jti },
      create: { jti, expiresAt },
      update: {},
    });
  }

  async isTokenRevoked(jti: string): Promise<boolean> {
    const row = await this.prisma.revokedToken.findUnique({ where: { jti }, select: { jti: true } });
    return row !== null;
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.revokedToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return count;
  }
}
