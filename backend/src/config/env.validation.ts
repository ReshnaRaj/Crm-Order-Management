import { z } from 'zod';

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.url().optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url(),
  FRONTEND_URL: z.url(),
  CORS_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64 encoded'),
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/).default('2026-10'),
  SHOPIFY_SCOPES: z.string().default('read_orders,write_orders,read_products,read_customers'),
  SHOPIFY_CALLBACK_URL: optionalUrl,
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),
  SHOPIFY_WEBHOOK_BASE_URL: optionalUrl,
  SHOPIFY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  SHOPIFY_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(4),
  WEBHOOK_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5),
  WEBHOOK_RETRY_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
