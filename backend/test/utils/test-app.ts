import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

/** Boots the full monolith against the test database. `customise` can override providers (e.g. Shopify fetch). */
export async function createTestApp(
  customise?: (b: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestContext> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customise) builder = customise(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app: app as unknown as INestApplication<App>, prisma, http: () => request(app.getHttpServer()) };
}

/** Removes all rows between tests (order respects FKs via CASCADE). */
export async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "WebhookEvent","OrderItem","Order","Customer","OrderCreationRequest",
      "SyncRun","OAuthState","ShopifyStore","RevokedToken","User" RESTART IDENTITY CASCADE
  `);
}

export async function registerAndLogin(
  ctx: TestContext,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
) {
  const body = {
    name: 'Test User',
    email: `user${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`,
    password: 'Passw0rd!',
    ...overrides,
  };
  const res = await ctx.http().post('/api/auth/register').send(body).expect(201);
  return {
    token: res.body.data.accessToken as string,
    user: res.body.data.user as { id: string; email: string },
  };
}
