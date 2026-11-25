/**
 * Error taxonomy for Shopify Admin API calls. The `retryable` and `outcomeUnknown`
 * flags drive retry and reconciliation decisions in the services.
 */
export abstract class ShopifyError extends Error {
  abstract readonly code: string;
  /** Safe to retry automatically (request definitely not applied, or idempotent read). */
  readonly retryable: boolean = false;
  /** The request may or may not have been applied by Shopify (timeouts / dropped connections). */
  readonly outcomeUnknown: boolean = false;

  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 401/403 – token invalid, revoked or missing scopes. */
export class ShopifyAuthError extends ShopifyError {
  readonly code = 'SHOPIFY_AUTH_FAILED';
}

/** 429 or GraphQL THROTTLED – Shopify did not execute the request. */
export class ShopifyRateLimitError extends ShopifyError {
  readonly code = 'SHOPIFY_RATE_LIMITED';
  override readonly retryable = true;
  constructor(
    message: string,
    public readonly retryAfterMs: number,
    status?: number,
  ) {
    super(message, status);
  }
}

/** Request timed out – Shopify may have processed it. */
export class ShopifyTimeoutError extends ShopifyError {
  readonly code = 'SHOPIFY_TIMEOUT';
  override readonly retryable = true;
  override readonly outcomeUnknown = true;
}

/** Network failure (DNS, reset, ...). */
export class ShopifyNetworkError extends ShopifyError {
  readonly code = 'SHOPIFY_NETWORK_ERROR';
  override readonly retryable = true;
  override readonly outcomeUnknown = true;
}

/** 5xx from Shopify. */
export class ShopifyServerError extends ShopifyError {
  readonly code = 'SHOPIFY_SERVER_ERROR';
  override readonly retryable = true;
  override readonly outcomeUnknown = true;
}

/** Top-level GraphQL errors (bad query, cost exceeded, access denied...). */
export class ShopifyGraphQLError extends ShopifyError {
  readonly code = 'SHOPIFY_GRAPHQL_ERROR';
  constructor(
    message: string,
    public readonly errors: unknown[],
    status?: number,
  ) {
    super(message, status);
  }
}

export interface ShopifyUserErrorItem {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

/** Mutation rejected by Shopify business validation (`userErrors`). Definitive – nothing created. */
export class ShopifyUserError extends ShopifyError {
  readonly code = 'SHOPIFY_VALIDATION_FAILED';
  constructor(public readonly userErrors: ShopifyUserErrorItem[]) {
    super(userErrors.map((e) => e.message).join('; ') || 'Shopify rejected the request', 422);
  }
}

/** No connected store / store not usable. */
export class ShopifyNotConnectedError extends ShopifyError {
  readonly code = 'SHOPIFY_NOT_CONNECTED';
}
