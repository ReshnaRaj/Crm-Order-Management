/* eslint-disable */
// Deterministic, non-secret configuration for automated tests.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://crm:crm@localhost:5432/mini_crm_test?schema=public';

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '3999',
  APP_URL: 'https://crm-api.test',
  FRONTEND_URL: 'https://crm.test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'test-jwt-secret-that-is-definitely-long-enough-0123456789',
  JWT_EXPIRES_IN: '1h',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SHOPIFY_API_KEY: 'test-api-key',
  SHOPIFY_API_SECRET: 'test-api-secret',
  SHOPIFY_API_VERSION: '2026-10',
  SHOPIFY_SCOPES: 'read_orders,write_orders,read_products,read_customers',
  SHOPIFY_WEBHOOK_SECRET: 'test-webhook-secret',
  SHOPIFY_REQUEST_TIMEOUT_MS: '2000',
  SHOPIFY_MAX_RETRIES: '2',
  WEBHOOK_MAX_RETRIES: '3',
  WEBHOOK_RETRY_INTERVAL_MS: '3600000',
};

module.exports = { TEST_DATABASE_URL, TEST_ENV };
