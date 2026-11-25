import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DEMO_STATE } from '../playwright.config';

export const DEMO = {
  email: process.env.E2E_USER_EMAIL ?? 'demo@example.com',
  password: process.env.E2E_USER_PASSWORD ?? 'Demo1234!',
};

/** Logs in through the UI and waits for the dashboard. */
export async function loginUI(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Token of the session saved by auth.setup.ts. */
function savedToken(): string {
  const state = JSON.parse(readFileSync(DEMO_STATE, 'utf8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  const item = state.origins.flatMap((o) => o.localStorage).find((i) => i.name === 'crm.accessToken');
  if (!item) throw new Error('No saved session – run the setup project first');
  return item.value;
}

/** Authenticated JSON client for the API (same origin/proxy as the SPA), reusing the saved session. */
export function apiClient(request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${savedToken()}` };
  return {
    get: async <T>(path: string): Promise<T> => {
      const r = await request.get(`/api${path}`, { headers });
      expect(r.ok(), `GET ${path} -> ${r.status()}`).toBeTruthy();
      return (await r.json()).data as T;
    },
  };
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerName: string | null;
  totalAmount: string;
  orderStatus: string;
  fulfillmentStatus: string | null;
}
export interface OrdersPage {
  items: OrderRow[];
  meta: { totalItems: number; totalPages: number };
}

export const rows = (page: Page) => page.locator('table tbody tr');
export const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
