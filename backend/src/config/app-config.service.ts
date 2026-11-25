import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env.validation';

const stripSlash = (u: string) => u.replace(/\/+$/, '');

/** Typed, centralised access to application configuration. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv() {
    return this.get('NODE_ENV');
  }
  get isProduction() {
    return this.nodeEnv === 'production';
  }
  get port() {
    return this.get('PORT');
  }
  get appUrl() {
    return stripSlash(this.get('APP_URL'));
  }
  get frontendUrl() {
    return stripSlash(this.get('FRONTEND_URL'));
  }
  get corsOrigins(): string[] {
    const raw = this.get('CORS_ORIGINS');
    return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [this.frontendUrl];
  }

  get jwt() {
    return { secret: this.get('JWT_SECRET'), expiresIn: this.get('JWT_EXPIRES_IN') };
  }
  get encryptionKey(): Buffer {
    return Buffer.from(this.get('ENCRYPTION_KEY'), 'base64');
  }

  get shopify() {
    const webhookBase = stripSlash(this.get('SHOPIFY_WEBHOOK_BASE_URL') || this.appUrl);
    return {
      apiKey: this.get('SHOPIFY_API_KEY'),
      apiSecret: this.get('SHOPIFY_API_SECRET'),
      apiVersion: this.get('SHOPIFY_API_VERSION'),
      scopes: this.get('SHOPIFY_SCOPES')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      callbackUrl: this.get('SHOPIFY_CALLBACK_URL') || `${this.appUrl}/api/shopify/callback`,
      webhookSecret: this.get('SHOPIFY_WEBHOOK_SECRET') || this.get('SHOPIFY_API_SECRET'),
      webhookBaseUrl: webhookBase,
      requestTimeoutMs: this.get('SHOPIFY_REQUEST_TIMEOUT_MS'),
      maxRetries: this.get('SHOPIFY_MAX_RETRIES'),
    };
  }

  get webhooks() {
    return {
      maxRetries: this.get('WEBHOOK_MAX_RETRIES'),
      retryIntervalMs: this.get('WEBHOOK_RETRY_INTERVAL_MS'),
    };
  }
}
