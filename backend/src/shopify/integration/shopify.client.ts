import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  ShopifyAuthError,
  ShopifyError,
  ShopifyGraphQLError,
  ShopifyNetworkError,
  ShopifyRateLimitError,
  ShopifyServerError,
  ShopifyTimeoutError,
} from './shopify.errors';

/** Injection token for the HTTP transport (lets tests substitute a fake `fetch`). */
export const SHOPIFY_FETCH = Symbol('SHOPIFY_FETCH');
export type FetchFn = typeof fetch;

/** Injection token for the sleep function (lets tests skip real back-off delays). */
export const SHOPIFY_SLEEP = Symbol('SHOPIFY_SLEEP');
export type SleepFn = (ms: number) => Promise<void>;
export const defaultSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

export interface ShopifyCredentials {
  shopDomain: string;
  accessToken: string;
}

export interface GraphQLRequestOptions {
  /**
   * Whether failures with an unknown outcome (timeouts, network, 5xx) may be retried.
   * Must be false for non-idempotent mutations such as orderCreate.
   * Throttling is always retried because Shopify guarantees the request was not executed.
   */
  retryUnknownOutcome?: boolean;
}

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

interface GraphQLErrorItem {
  message: string;
  path?: (string | number)[];
  extensions?: { code?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLErrorItem[];
  extensions?: { cost?: CostInfo };
}

/** Fields governed by Shopify's protected customer data policy. */
const PROTECTED_FIELDS = new Set([
  'customer',
  'email',
  'phone',
  'billingAddress',
  'shippingAddress',
  'defaultEmailAddress',
  'defaultPhoneNumber',
  'firstName',
  'lastName',
  'displayName',
  'name',
  'address1',
  'address2',
  'city',
  'zip',
]);

/**
 * True for a field-level ACCESS_DENIED error on protected customer data, e.g.
 * `{ code: 'ACCESS_DENIED', path: ['orders','nodes',0,'customer'] }`. Errors without a
 * path (whole-request denials) are never treated as partial.
 */
export function isProtectedDataDenial(e: GraphQLErrorItem): boolean {
  if (e.extensions?.code !== 'ACCESS_DENIED' || !e.path?.length) return false;
  const last = e.path[e.path.length - 1];
  return typeof last === 'string' && PROTECTED_FIELDS.has(last);
}

interface CostInfo {
  requestedQueryCost?: number;
  throttleStatus?: ThrottleStatus;
}

/**
 * Low-level Shopify Admin GraphQL client: auth headers, timeouts, cost-based throttling,
 * exponential back-off retries and error classification. Contains no business logic.
 */
@Injectable()
export class ShopifyGraphQLClient {
  private readonly logger = new Logger(ShopifyGraphQLClient.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(SHOPIFY_FETCH) private readonly fetchFn: FetchFn,
    @Inject(SHOPIFY_SLEEP) private readonly sleep: SleepFn,
  ) {}

  endpoint(shopDomain: string) {
    return `https://${shopDomain}/admin/api/${this.config.shopify.apiVersion}/graphql.json`;
  }

  async request<T>(
    creds: ShopifyCredentials,
    query: string,
    variables: Record<string, unknown> = {},
    opts: GraphQLRequestOptions = {},
  ): Promise<T> {
    const { maxRetries } = this.config.shopify;
    const retryUnknown = opts.retryUnknownOutcome ?? true;
    let attempt = 0;

    for (;;) {
      try {
        return await this.execute<T>(creds, query, variables);
      } catch (err) {
        const e = err as ShopifyError;
        const canRetry =
          e instanceof ShopifyError &&
          e.retryable &&
          (!e.outcomeUnknown || retryUnknown) &&
          attempt < maxRetries;
        if (!canRetry) throw err;

        const delay =
          e instanceof ShopifyRateLimitError
            ? e.retryAfterMs
            : Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
        attempt++;
        this.logger.warn({
          event: 'shopify.retry',
          shop: creds.shopDomain,
          attempt,
          reason: e.code,
          delayMs: delay,
        });
        await this.sleep(delay);
      }
    }
  }

  private async execute<T>(
    creds: ShopifyCredentials,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.shopify.requestTimeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(this.endpoint(creds.shopDomain), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Shopify-Access-Token': creds.accessToken,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        throw new ShopifyTimeoutError('Shopify request timed out');
      }
      throw new ShopifyNetworkError(`Network error calling Shopify: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      throw new ShopifyAuthError(
        res.status === 401
          ? 'Shopify access token is invalid or has been revoked'
          : 'Shopify denied access (missing scopes?)',
        res.status,
      );
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      throw new ShopifyRateLimitError(
        'Shopify rate limit reached',
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000,
        429,
      );
    }
    if (res.status >= 500) {
      throw new ShopifyServerError(`Shopify server error (${res.status})`, res.status);
    }

    let body: GraphQLResponse<T>;
    try {
      body = (await res.json()) as GraphQLResponse<T>;
    } catch {
      throw new ShopifyServerError(`Invalid JSON from Shopify (status ${res.status})`, res.status);
    }
    if (!res.ok) {
      throw new ShopifyGraphQLError(`Shopify request failed (${res.status})`, body.errors ?? [], res.status);
    }

    if (body.errors?.length) {
      const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        throw new ShopifyRateLimitError(
          'Shopify query cost throttled',
          this.throttleWaitMs(body.extensions?.cost),
          200,
        );
      }
      if (body.data && body.errors.every(isProtectedDataDenial)) {
        // App lacks "protected customer data" approval: Shopify nulls those fields but the
        // rest of the response is valid. Keep the data instead of failing the whole import.
        this.logger.warn({
          event: 'shopify.protected_data_denied',
          shop: creds.shopDomain,
          fields: [...new Set(body.errors.map((e) => e.path?.at(-1)).filter(Boolean))],
          hint: 'Request protected customer data access (name, email, phone, address) for the app',
        });
        await this.respectThrottle(body.extensions?.cost);
        return body.data;
      }
      const denied = body.errors.some((e) => e.extensions?.code === 'ACCESS_DENIED');
      if (denied) {
        throw new ShopifyAuthError(body.errors.map((e) => e.message).join('; '), 403);
      }
      throw new ShopifyGraphQLError(body.errors.map((e) => e.message).join('; '), body.errors, res.status);
    }

    await this.respectThrottle(body.extensions?.cost);
    return body.data as T;
  }

  /** Time needed for the leaky bucket to refill enough for the requested cost. */
  private throttleWaitMs(cost?: CostInfo): number {
    const status = cost?.throttleStatus;
    const requested = cost?.requestedQueryCost ?? 100;
    if (!status || status.restoreRate <= 0) return 2000;
    const deficit = Math.max(0, requested - status.currentlyAvailable);
    return Math.ceil((deficit / status.restoreRate) * 1000) + 250;
  }

  /** Proactively pause when the bucket is nearly empty to avoid THROTTLED errors. */
  private async respectThrottle(cost?: CostInfo) {
    const status = cost?.throttleStatus;
    if (!status) return;
    const lowWater = Math.max(cost?.requestedQueryCost ?? 0, status.maximumAvailable * 0.1);
    if (status.currentlyAvailable < lowWater && status.restoreRate > 0) {
      const wait = Math.ceil(((lowWater - status.currentlyAvailable) / status.restoreRate) * 1000);
      await this.sleep(Math.min(wait, 10_000));
    }
  }
}
