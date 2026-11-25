import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../../common/utils/app.exception';
import { ShopifyWebhookVerifier } from '../../shopify/integration/shopify-webhook-verifier';

/**
 * Authenticates Shopify webhook calls by HMAC over the raw body (instead of a user JWT).
 * Unverified payloads never reach the controller.
 */
@Injectable()
export class ShopifyHmacGuard implements CanActivate {
  private readonly logger = new Logger(ShopifyHmacGuard.name);

  constructor(private readonly verifier: ShopifyWebhookVerifier) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const header = req.headers['x-shopify-hmac-sha256'];
    const hmac = Array.isArray(header) ? header[0] : header;
    if (!this.verifier.verify(req.rawBody, hmac)) {
      this.logger.warn({
        event: 'webhook.hmac_invalid',
        path: req.path,
        shop: req.headers['x-shopify-shop-domain'],
        hasHmac: Boolean(hmac),
        hasRawBody: Boolean(req.rawBody),
      });
      throw new AppException('INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
