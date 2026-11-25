import { AppConfigService } from '../../config/app-config.service';
import { ShopifyGraphQLClient } from './shopify.client';
import {
  ShopifyAuthError,
  ShopifyGraphQLError,
  ShopifyRateLimitError,
  ShopifyServerError,
  ShopifyTimeoutError,
} from './shopify.errors';

const creds = { shopDomain: 'shop.myshopify.com', accessToken: 'tok' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function setup(responses: (Response | ((init?: RequestInit) => Promise<Response>))[], maxRetries = 3) {
  const config = {
    shopify: { apiVersion: '2026-10', requestTimeoutMs: 50, maxRetries },
  } as unknown as AppConfigService;
  const fetchFn = jest.fn((_url: string, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return typeof next === 'function' ? next(init) : Promise.resolve(next);
  });
  const sleep = jest.fn(() => Promise.resolve());
  const client = new ShopifyGraphQLClient(config, fetchFn as typeof fetch, sleep);
  return { client, fetchFn, sleep };
}

describe('ShopifyGraphQLClient', () => {
  it('sends the access token to the versioned endpoint and returns data', async () => {
    const { client, fetchFn } = setup([json({ data: { shop: { id: 1 } } })]);
    await expect(client.request(creds, 'query Q { shop { id } }')).resolves.toEqual({ shop: { id: 1 } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://shop.myshopify.com/admin/api/2026-10/graphql.json');
    expect((init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('tok');
  });

  it('retries 429 honouring Retry-After', async () => {
    const { client, sleep, fetchFn } = setup([json({}, 429, { 'Retry-After': '3' }), json({ data: { ok: true } })]);
    await expect(client.request(creds, 'q')).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('retries GraphQL THROTTLED using the bucket restore rate', async () => {
    const throttled = json({
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      extensions: { cost: { requestedQueryCost: 300, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 100, restoreRate: 50 } } },
    });
    const { client, sleep } = setup([throttled, json({ data: { ok: 1 } })]);
    await client.request(creds, 'q');
    expect(sleep).toHaveBeenCalledWith(4250); // (300-100)/50 s + 250ms buffer
  });

  it('gives up after maxRetries and surfaces the rate-limit error', async () => {
    const { client, fetchFn } = setup([json({}, 429), json({}, 429), json({}, 429)], 2);
    await expect(client.request(creds, 'q')).rejects.toBeInstanceOf(ShopifyRateLimitError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('retries 5xx for reads but not for mutations with unknown outcome', async () => {
    const read = setup([json({}, 502), json({ data: { ok: 1 } })]);
    await expect(read.client.request(creds, 'q')).resolves.toEqual({ ok: 1 });

    const write = setup([json({}, 502), json({ data: { ok: 1 } })]);
    await expect(write.client.request(creds, 'm', {}, { retryUnknownOutcome: false })).rejects.toBeInstanceOf(ShopifyServerError);
    expect(write.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('still retries throttling for mutations (Shopify did not execute them)', async () => {
    const { client, fetchFn } = setup([json({}, 429), json({ data: { ok: 1 } })]);
    await client.request(creds, 'm', {}, { retryUnknownOutcome: false });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('classifies an aborted request as a timeout', async () => {
    const hang = (init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const { client } = setup([hang], 0);
    await expect(client.request(creds, 'q')).rejects.toBeInstanceOf(ShopifyTimeoutError);
  });

  it('raises auth errors on 401/403 without retrying', async () => {
    const { client, fetchFn } = setup([json({ errors: 'Invalid' }, 401)]);
    await expect(client.request(creds, 'q')).rejects.toBeInstanceOf(ShopifyAuthError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('raises GraphQL errors without retrying', async () => {
    const { client, fetchFn } = setup([json({ errors: [{ message: 'Field x does not exist' }] })]);
    await expect(client.request(creds, 'q')).rejects.toBeInstanceOf(ShopifyGraphQLError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('maps ACCESS_DENIED to an auth error', async () => {
    const { client } = setup([json({ errors: [{ message: 'denied', extensions: { code: 'ACCESS_DENIED' } }] })]);
    await expect(client.request(creds, 'q')).rejects.toBeInstanceOf(ShopifyAuthError);
  });

  it('returns partial data when only protected customer fields are denied', async () => {
    const { client } = setup([
      json({
        data: { orders: { nodes: [{ id: '1', customer: null }] } },
        errors: [
          {
            message: 'This app is not approved to access the Customer object.',
            path: ['orders', 'nodes', 0, 'customer'],
            extensions: { code: 'ACCESS_DENIED' },
          },
        ],
      }),
    ]);
    await expect(client.request(creds, 'q')).resolves.toEqual({ orders: { nodes: [{ id: '1', customer: null }] } });
  });

  it('still fails when a denial is not limited to protected customer fields', async () => {
    const { client } = setup([
      json({
        data: { orders: null },
        errors: [{ message: 'denied', path: ['orders'], extensions: { code: 'ACCESS_DENIED' } }],
      }),
    ]);
    await expect(client.request(creds, 'q')).rejects.toBeInstanceOf(ShopifyAuthError);
  });

  it('pauses proactively when the cost bucket is nearly empty', async () => {
    const { client, sleep } = setup([
      json({
        data: { ok: 1 },
        extensions: { cost: { requestedQueryCost: 50, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 100, restoreRate: 100 } } },
      }),
    ]);
    await client.request(creds, 'q');
    expect(sleep).toHaveBeenCalledWith(1000); // refill to 10% (200) at 100/s
  });
});
