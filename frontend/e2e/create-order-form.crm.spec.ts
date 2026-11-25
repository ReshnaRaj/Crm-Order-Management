import { expect, test, type Page, type Route } from '@playwright/test';
import { apiClient, type OrdersPage } from './helpers';

/**
 * Create Order *form* behaviour. Only the Shopify-backed endpoints the form depends on are
 * stubbed (status / products / order submission), because the demo store is not connected.
 * This verifies the frontend logic – it is NOT evidence of the real Shopify integration,
 * which is covered by the backend tests and the manual real-store checklist.
 */

const ok = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

const CATALOGUE = {
  currency: 'USD',
  hasNextPage: false,
  endCursor: null,
  products: [
    {
      id: 'gid://shopify/Product/1',
      title: 'Organic Cotton T-Shirt',
      status: 'ACTIVE',
      imageUrl: null,
      variants: [
        { id: 'gid://shopify/ProductVariant/11', title: 'White / M', displayName: 'Organic Cotton T-Shirt - White / M', sku: 'TSH-WHT-M', price: '24.00', inventoryQuantity: 12, availableForSale: true },
        { id: 'gid://shopify/ProductVariant/12', title: 'Black / L', displayName: 'Organic Cotton T-Shirt - Black / L', sku: 'TSH-BLK-L', price: '24.00', inventoryQuantity: 0, availableForSale: false },
      ],
    },
    {
      id: 'gid://shopify/Product/2',
      title: 'Canvas Weekender Bag',
      status: 'ACTIVE',
      imageUrl: null,
      variants: [{ id: 'gid://shopify/ProductVariant/21', title: 'Default Title', displayName: 'Canvas Weekender Bag', sku: 'BAG-WKD', price: '120.00', inventoryQuantity: 3, availableForSale: true }],
    },
  ],
};

async function stubConnectedStore(page: Page) {
  await page.route('**/api/shopify/status', (r) =>
    ok(r, {
      connected: true,
      store: { id: 's1', shopDomain: 'stub-store.myshopify.com', name: 'Stub', currency: 'USD', connectionStatus: 'CONNECTED', scopes: [], lastError: null, lastSyncAt: null, webhooksRegisteredAt: null, connectedAt: new Date().toISOString() },
      requiredScopes: [],
      missingScopes: [],
      activeRun: null,
      lastRun: null,
      recentRuns: [],
    }),
  );
  await page.route('**/api/shopify/products**', (r) => ok(r, CATALOGUE));
}

const submitButton = (page: Page) => page.getByRole('button', { name: /Create order|Creating in Shopify/ });

test.describe('Create Order form (frontend behaviour)', () => {
  test.beforeEach(async ({ page }) => {
    await stubConnectedStore(page);
  });

  test('validates required fields client-side', async ({ page }) => {
    let posted = false;
    await page.route('**/api/orders', (r) => {
      if (r.request().method() === 'POST') posted = true;
      return r.fallback();
    });
    await page.goto('/orders/new');
    await submitButton(page).click();
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByText('Last name is required')).toBeVisible();
    await expect(page.getByText('Add at least one product')).toBeVisible();

    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Address').first().fill('1 Main St'); // partial address -> city/country required
    await submitButton(page).click();
    await expect(page.getByText('Enter a valid email')).toBeVisible();
    await expect(page.getByText('City is required').first()).toBeVisible();
    await expect(page.getByText('2-letter country code, e.g. US').first()).toBeVisible();
    expect(posted).toBe(false);
  });

  test('builds line items and totals; unavailable variants cannot be added', async ({ page }) => {
    await page.goto('/orders/new');
    await expect(page.getByRole('button', { name: 'Add Organic Cotton T-Shirt Black / L' })).toBeDisabled();

    await page.getByRole('button', { name: 'Add Organic Cotton T-Shirt White / M' }).click();
    await page.getByRole('button', { name: 'Add Organic Cotton T-Shirt White / M' }).click(); // same variant -> qty 2
    await page.getByRole('button', { name: 'Add Canvas Weekender Bag Default Title' }).click();

    await expect(page.getByLabel('Quantity for Organic Cotton T-Shirt')).toHaveValue('2');
    const summary = page.locator('section', { has: page.getByRole('heading', { name: 'Order summary' }) });
    await expect(summary).toContainText('Items (2)');
    await expect(summary).toContainText('$168.00'); // 2×24 + 120

    await page.getByLabel('Shipping method').fill('Courier');
    await page.getByLabel('Shipping charge').fill('5');
    await page.getByLabel('Discount code').fill('WELCOME10');
    await page.getByLabel('Discount amount').fill('10');
    await expect(summary).toContainText('−$10.00');
    await expect(summary).toContainText('$163.00'); // 168 - 10 + 5

    await page.getByRole('button', { name: 'Remove Canvas Weekender Bag' }).click();
    await expect(summary).toContainText('Items (1)');
    await expect(summary).toContainText('$43.00'); // 48 - 10 + 5
  });

  test('submits the expected payload once, even on double click, and opens the created order', async ({ page, request }) => {
    const realOrder = (await apiClient(request).get<OrdersPage>('/orders?pageSize=1')).items[0];
    const bodies: Record<string, unknown>[] = [];
    await page.route('**/api/orders', async (r) => {
      if (r.request().method() !== 'POST') return r.fallback();
      bodies.push(r.request().postDataJSON() as Record<string, unknown>);
      await new Promise((res) => setTimeout(res, 800)); // slow Shopify
      return ok(r, { requestId: 'req-1', status: 'SUCCEEDED', replayed: false, message: 'Order created in Shopify', order: { id: realOrder.id, orderNumber: realOrder.orderNumber } }, 201);
    });

    await page.goto('/orders/new');
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill('Lovelace');
    await page.getByLabel('Email').fill('ada@example.com');
    await page.getByLabel('Address').first().fill('12 Analytical Way');
    await page.getByLabel('City').first().fill('London');
    await page.getByLabel('Country code').first().fill('gb');
    await page.getByRole('button', { name: 'Add Canvas Weekender Bag Default Title' }).click();
    await page.getByLabel('Quantity for Canvas Weekender Bag').fill('3');
    await page.getByLabel('Note').fill('Phone order');

    await submitButton(page).dblclick();
    await expect(page.getByRole('button', { name: 'Creating in Shopify…' })).toBeDisabled();
    await expect(page).toHaveURL(new RegExp(`/orders/${realOrder.id}$`));
    await expect(page.getByText(`Order ${realOrder.orderNumber} created in Shopify`)).toBeVisible();

    expect(bodies).toHaveLength(1);
    const b = bodies[0];
    expect(b.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.customer).toEqual({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' });
    expect(b.billingAddress).toEqual({ address1: '12 Analytical Way', city: 'London', countryCode: 'GB' });
    expect(b.shippingAddress).toBeUndefined(); // "same as billing"
    expect(b.lineItems).toEqual([{ variantId: 'gid://shopify/ProductVariant/21', quantity: 3 }]);
    expect(b.note).toBe('Phone order');
  });

  test('links an existing customer from the CRM', async ({ page }) => {
    const bodies: Record<string, unknown>[] = [];
    await page.route('**/api/orders', (r) => {
      if (r.request().method() !== 'POST') return r.fallback();
      bodies.push(r.request().postDataJSON() as Record<string, unknown>);
      return ok(r, { requestId: 'r', status: 'FAILED', replayed: false, message: 'x', order: null }, 422);
    });
    await page.goto('/orders/new');
    await page.getByLabel('Search existing customers').fill('emma');
    await page.getByRole('option').first().getByRole('button').click(); // real customers from the seeded CRM
    await expect(page.getByText('Linked to existing Shopify customer')).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveValue('Emma');
    await expect(page.getByLabel('City').first()).toHaveValue('Austin');
    await page.getByRole('button', { name: 'Add Canvas Weekender Bag Default Title' }).click();
    await submitButton(page).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect((bodies[0].customer as Record<string, unknown>).existingCustomerId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('uncertain outcome: shows a waiting banner, locks the form and reconciles', async ({ page, request }) => {
    const realOrder = (await apiClient(request).get<OrdersPage>('/orders?pageSize=1')).items[0];
    let reconcileCalls = 0;
    await page.route('**/api/orders', (r) =>
      r.request().method() === 'POST'
        ? ok(r, { requestId: '11111111-1111-4111-8111-111111111111', status: 'UNKNOWN', replayed: false, order: null, message: 'Shopify did not confirm the order in time.' }, 202)
        : r.fallback(),
    );
    await page.route('**/api/orders/creation-requests/*/reconcile', (r) => {
      reconcileCalls++;
      return reconcileCalls === 1
        ? ok(r, { requestId: 'x', status: 'UNKNOWN', replayed: false, order: null, message: 'still unknown' })
        : ok(r, { requestId: 'x', status: 'SUCCEEDED', replayed: false, message: 'ok', order: { id: realOrder.id, orderNumber: realOrder.orderNumber } });
    });

    await page.goto('/orders/new');
    await page.getByLabel('First name').fill('Grace');
    await page.getByLabel('Last name').fill('Hopper');
    await page.getByRole('button', { name: 'Add Canvas Weekender Bag Default Title' }).click();
    await submitButton(page).click();

    await expect(page.getByText('Waiting for Shopify confirmation')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
    await expect(page.getByLabel('First name')).toBeDisabled();

    await page.getByRole('button', { name: 'Check status' }).click();
    await expect(page.getByText('Still waiting for Shopify to confirm', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Check status' }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${realOrder.id}$`));
  });

  test('after a definitive failure the next attempt uses a new idempotency key', async ({ page }) => {
    const keys: string[] = [];
    await page.route('**/api/orders', (r) => {
      if (r.request().method() !== 'POST') return r.fallback();
      keys.push((r.request().postDataJSON() as { idempotencyKey: string }).idempotencyKey);
      return r.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, statusCode: 422, error: { code: 'SHOPIFY_VALIDATION_FAILED', message: 'Email is invalid' } }),
      });
    });
    await page.goto('/orders/new');
    await page.getByLabel('First name').fill('Alan');
    await page.getByLabel('Last name').fill('Turing');
    await page.getByRole('button', { name: 'Add Canvas Weekender Bag Default Title' }).click();
    await submitButton(page).click();
    await expect(page.getByText('Email is invalid')).toBeVisible();
    await expect(submitButton(page)).toBeEnabled();
    await submitButton(page).click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
