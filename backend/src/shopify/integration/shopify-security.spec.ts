import { createHmac } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';
import { ShopifyOAuthService } from './shopify-oauth.service';
import { ShopifyWebhookVerifier } from './shopify-webhook-verifier';

const config = {
  shopify: {
    apiKey: 'key',
    apiSecret: 'oauth-secret',
    webhookSecret: 'webhook-secret',
    scopes: ['read_orders', 'write_orders'],
    callbackUrl: 'https://api.example.com/api/shopify/callback',
    requestTimeoutMs: 1000,
  },
} as unknown as AppConfigService;

describe('ShopifyWebhookVerifier', () => {
  const verifier = new ShopifyWebhookVerifier(config);
  const body = Buffer.from('{"id":1,"note":"ünïcode"}');
  const sign = (b: Buffer, secret = 'webhook-secret') => createHmac('sha256', secret).update(b).digest('base64');

  it('accepts a valid signature', () => {
    expect(verifier.verify(body, sign(body))).toBe(true);
  });
  it('rejects a signature for a different body', () => {
    expect(verifier.verify(Buffer.from('{"id":2}'), sign(body))).toBe(false);
  });
  it('rejects a signature from another secret', () => {
    expect(verifier.verify(body, sign(body, 'oauth-secret'))).toBe(false);
  });
  it('rejects missing body or header and malformed/short signatures', () => {
    expect(verifier.verify(undefined, sign(body))).toBe(false);
    expect(verifier.verify(body, undefined)).toBe(false);
    expect(verifier.verify(body, 'abc')).toBe(false);
    expect(verifier.verify(body, '')).toBe(false);
  });
});

describe('ShopifyOAuthService', () => {
  const oauth = new ShopifyOAuthService(config, jest.fn());

  it.each([
    ['my-store', 'my-store.myshopify.com'],
    ['My-Store.myshopify.com', 'my-store.myshopify.com'],
    ['https://my-store.myshopify.com/admin', 'my-store.myshopify.com'],
    ['evil.com', null],
    ['my-store.myshopify.com.evil.com', null],
    ['', null],
  ])('normalises shop %p -> %p', (input, expected) => {
    expect(oauth.normaliseShopDomain(input)).toBe(expected);
  });

  it('verifies callback HMAC over sorted params excluding hmac', () => {
    const params = { shop: 's.myshopify.com', code: 'c', timestamp: '1', state: 'x' };
    const msg = 'code=c&shop=s.myshopify.com&state=x&timestamp=1';
    const hmac = createHmac('sha256', 'oauth-secret').update(msg).digest('hex');
    expect(oauth.verifyCallbackHmac({ ...params, hmac })).toBe(true);
    expect(oauth.verifyCallbackHmac({ ...params, code: 'tampered', hmac })).toBe(false);
    expect(oauth.verifyCallbackHmac(params)).toBe(false);
  });

  it('builds the authorize URL', () => {
    const url = new URL(oauth.buildAuthorizeUrl('s.myshopify.com', 'st'));
    expect(url.origin + url.pathname).toBe('https://s.myshopify.com/admin/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'key',
      scope: 'read_orders,write_orders',
      redirect_uri: 'https://api.example.com/api/shopify/callback',
      state: 'st',
    });
  });
});
