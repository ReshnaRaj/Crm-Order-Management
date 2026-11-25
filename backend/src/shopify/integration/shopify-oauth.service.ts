import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { hmacSha256, safeEqual } from '../../common/utils/crypto.util';
import { FetchFn, SHOPIFY_FETCH } from './shopify.client';
import { ShopifyAuthError, ShopifyNetworkError, ShopifyServerError } from './shopify.errors';

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export interface AccessTokenResponse {
  accessToken: string;
  scopes: string;
}

/**
 * Shopify OAuth authorization-code grant (offline access token):
 *  1. redirect merchant to /admin/oauth/authorize
 *  2. verify callback HMAC + state
 *  3. exchange `code` for a permanent offline access token
 */
@Injectable()
export class ShopifyOAuthService {
  constructor(
    private readonly config: AppConfigService,
    @Inject(SHOPIFY_FETCH) private readonly fetchFn: FetchFn,
  ) {}

  /** Accepts "my-store", "my-store.myshopify.com" or a full URL and returns the canonical domain, or null. */
  normaliseShopDomain(input: string | undefined | null): string | null {
    if (!input) return null;
    let s = input.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '').split('/')[0];
    if (!s.includes('.')) s = `${s}.myshopify.com`;
    return SHOP_DOMAIN_RE.test(s) ? s : null;
  }

  isValidShopDomain(shop: string): boolean {
    return SHOP_DOMAIN_RE.test(shop);
  }

  buildAuthorizeUrl(shop: string, state: string): string {
    const { apiKey, scopes, callbackUrl } = this.config.shopify;
    const params = new URLSearchParams({
      client_id: apiKey,
      scope: scopes.join(','),
      redirect_uri: callbackUrl,
      state,
    });
    return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  }

  /** Verifies the `hmac` query parameter Shopify appends to the OAuth callback. */
  verifyCallbackHmac(query: Record<string, unknown>): boolean {
    const provided = typeof query.hmac === 'string' ? query.hmac : '';
    if (!provided) return false;
    const message = Object.keys(query)
      .filter((k) => k !== 'hmac' && k !== 'signature')
      .sort()
      .map((k) => {
        const v = query[k];
        return `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`;
      })
      .join('&');
    const expected = hmacSha256(this.config.shopify.apiSecret, message, 'hex');
    return safeEqual(expected, provided.toLowerCase());
  }

  async exchangeCodeForToken(shop: string, code: string): Promise<AccessTokenResponse> {
    const { apiKey, apiSecret, requestTimeoutMs } = this.config.shopify;
    let res: Response;
    try {
      res = await this.fetchFn(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (e) {
      throw new ShopifyNetworkError(`Could not reach Shopify: ${(e as Error).message}`);
    }
    if (res.status >= 500) throw new ShopifyServerError('Shopify OAuth server error', res.status);
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string };
    if (!res.ok || !body.access_token) {
      throw new ShopifyAuthError('Shopify rejected the authorization code', res.status);
    }
    return { accessToken: body.access_token, scopes: body.scope ?? '' };
  }
}
