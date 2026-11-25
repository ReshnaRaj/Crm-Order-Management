import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';

/** Verifies the X-Shopify-Hmac-Sha256 header against the *raw* request body. */
@Injectable()
export class ShopifyWebhookVerifier {
  constructor(private readonly config: AppConfigService) {}

  verify(rawBody: Buffer | undefined, hmacHeader: string | undefined): boolean {
    if (!rawBody || !hmacHeader) return false;
    const expected = createHmac('sha256', this.config.shopify.webhookSecret).update(rawBody).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(hmacHeader, 'base64');
    } catch {
      return false;
    }
    // Length check first: timingSafeEqual throws on unequal lengths.
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
}
