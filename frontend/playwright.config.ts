import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests for the running application (frontend + backend + seeded demo data).
 *   1. start PostgreSQL, backend and frontend, and run `npm run prisma:seed` in backend/
 *   2. E2E_BASE_URL=http://localhost:5173 npm run test:e2e
 *
 * The `setup` project signs in once and stores the session, so the CRM tests reuse it
 * instead of logging in repeatedly (the API rate-limits login to 10 attempts per minute).
 */
export const DEMO_STATE = 'e2e/.auth/demo.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // tests share one database
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    timezoneId: 'UTC',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'auth', testMatch: /auth\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'crm',
      testMatch: /crm\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: DEMO_STATE },
    },
  ],
});
