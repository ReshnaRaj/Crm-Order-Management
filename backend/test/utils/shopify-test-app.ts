import { SHOPIFY_FETCH, SHOPIFY_SLEEP } from '../../src/shopify/integration/shopify.client';
import { FakeShopify, SHOP, signedCallbackQuery } from './fake-shopify';
import { createTestApp, registerAndLogin, TestContext } from './test-app';

export interface ShopifyTestContext extends TestContext {
  fake: FakeShopify;
  sleeps: number[];
}

/** Boots the app with the fake Shopify transport and an instant (recorded) sleep. */
export async function createShopifyTestApp(): Promise<ShopifyTestContext> {
  const fake = new FakeShopify();
  const sleeps: number[] = [];
  const ctx = await createTestApp((b) =>
    b
      .overrideProvider(SHOPIFY_FETCH)
      .useValue(fake.fetch)
      .overrideProvider(SHOPIFY_SLEEP)
      .useValue((ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      }),
  );
  return { ...ctx, fake, sleeps };
}

/** Runs the real OAuth connect + callback flow against the fake Shopify. Returns an auth token. */
export async function connectStore(ctx: ShopifyTestContext, token?: string) {
  const auth = token ?? (await registerAndLogin(ctx)).token;
  const res = await ctx
    .http()
    .get('/api/shopify/connect')
    .query({ shop: SHOP })
    .set('Authorization', `Bearer ${auth}`)
    .expect(200);
  const url = new URL(res.body.data.authorizationUrl as string);
  const state = url.searchParams.get('state')!;
  const query = signedCallbackQuery(
    { code: 'good-code', shop: SHOP, state, timestamp: String(Math.floor(Date.now() / 1000)) },
    process.env.SHOPIFY_API_SECRET!,
  );
  const cb = await ctx.http().get('/api/shopify/callback').query(query).expect(302);
  return { token: auth, redirect: cb.headers.location };
}

/** Polls until no sync run is RUNNING. */
export async function waitForSync(ctx: TestContext) {
  for (let i = 0; i < 400; i++) {
    const running = await ctx.prisma.syncRun.count({ where: { status: 'RUNNING' } });
    if (!running) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('sync did not finish');
}
