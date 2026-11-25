import { expect, test } from '@playwright/test';
import { apiClient, rows, type OrdersPage } from './helpers';

interface Summary {
  totalOrders: number;
  pendingOrders: number;
  fulfilledOrders: number;
  cancelledOrders: number;
  totalSales: { currency: string; amount: string }[];
  recentOrders: { orderNumber: string }[];
}

const usd = (amount: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount));

test.describe('CRM pages (seeded demo data)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard'); // session from auth.setup.ts
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  });

  test('dashboard shows database-driven metrics and recent orders', async ({ page, request }) => {
    const api = apiClient(request);
    const s = await api.get<Summary>('/orders/summary');
    expect(s.totalOrders).toBeGreaterThan(0);

    const card = (label: string) => page.locator('section', { has: page.getByText(label, { exact: true }) });
    await expect(card('Total orders')).toContainText(String(s.totalOrders));
    await expect(card('Pending orders')).toContainText(String(s.pendingOrders));
    await expect(card('Fulfilled orders')).toContainText(String(s.fulfilledOrders));
    await expect(card('Total sales')).toContainText(usd(s.totalSales[0].amount));

    const recent = page.locator('section', { has: page.getByRole('heading', { name: 'Recent orders' }) });
    await expect(recent.locator('tbody tr')).toHaveCount(s.recentOrders.length);
    await expect(recent.locator('tbody tr').first()).toContainText(s.recentOrders[0].orderNumber);
    await recent.getByRole('link', { name: s.recentOrders[0].orderNumber, exact: true }).click();
    await expect(page.getByRole('heading', { name: `Order ${s.recentOrders[0].orderNumber}` })).toBeVisible();
  });

  test('orders list: default listing, pagination and page size', async ({ page, request }) => {
    const api = apiClient(request);
    const all = await api.get<OrdersPage>('/orders?pageSize=20');
    await page.getByRole('link', { name: 'Orders', exact: true }).click();
    await expect(rows(page)).toHaveCount(20);
    await expect(page.getByText(`${all.meta.totalItems} orders`)).toBeVisible();
    await expect(rows(page).first()).toContainText(all.items[0].orderNumber); // newest first

    await page.getByLabel('Rows per page').selectOption('10');
    await expect(rows(page)).toHaveCount(10);
    const pages = Math.ceil(all.meta.totalItems / 10);
    await expect(page.getByText(`Page 1 of ${pages}`)).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText(`Page 2 of ${pages}`)).toBeVisible();
    await expect(page.getByText(`Showing 11–20 of ${all.meta.totalItems}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/pageSize=10/);
  });

  test('orders list: search by order number and by partial customer name', async ({ page, request }) => {
    const api = apiClient(request);
    const sample = (await api.get<OrdersPage>('/orders?pageSize=100')).items.find((o) => o.customerName)!;
    await page.goto('/orders');

    await page.getByLabel('Search orders').fill(sample.orderNumber.replace('#', ''));
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(sample.orderNumber);

    const fragment = sample.customerName!.split(' ')[0].slice(1, 4).toUpperCase(); // partial + different case
    const expected = await api.get<OrdersPage>(`/orders?search=${encodeURIComponent(fragment)}&pageSize=100`);
    await page.getByLabel('Search orders').fill(fragment);
    await expect(page.getByText(`${expected.meta.totalItems} order`, { exact: false })).toBeVisible();
    await expect(rows(page)).toHaveCount(Math.min(expected.meta.totalItems, 20));

    await page.getByLabel('Search orders').fill('zz-no-such-order');
    await expect(page.getByText('No matching orders')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(rows(page)).toHaveCount(20);
  });

  test('orders list: status, fulfillment and date-range filters', async ({ page, request }) => {
    const api = apiClient(request);
    await page.goto('/orders');

    const cancelled = await api.get<OrdersPage>('/orders?orderStatus=CANCELLED');
    await page.getByLabel('Order status').selectOption('CANCELLED');
    await expect(rows(page)).toHaveCount(cancelled.meta.totalItems);
    for (const o of cancelled.items) await expect(page.getByRole('table')).toContainText(o.orderNumber);
    await page.getByLabel('Order status').selectOption('');

    const fulfilled = await api.get<OrdersPage>('/orders?fulfillmentStatus=FULFILLED&pageSize=100');
    await page.getByLabel('Fulfillment status').selectOption('FULFILLED');
    await expect(page.getByText(`${fulfilled.meta.totalItems} orders`)).toBeVisible();
    await page.getByLabel('Fulfillment status').selectOption('');

    // date range covering a known slice of orders (UTC days)
    const asc = (await api.get<OrdersPage>('/orders?sortBy=orderDate&sortOrder=asc&pageSize=100')).items;
    const from = asc[5].orderDate.slice(0, 10);
    const to = asc[15].orderDate.slice(0, 10);
    const expected = await api.get<OrdersPage>(`/orders?dateFrom=${from}T00:00:00.000Z&dateTo=${to}T23:59:59.999Z`);
    await page.getByLabel('Start date').fill(from);
    await page.getByLabel('End date').fill(to);
    await expect(page.getByText(`${expected.meta.totalItems} orders`)).toBeVisible();
    await expect(rows(page)).toHaveCount(Math.min(expected.meta.totalItems, 20));

    // inverted range
    await page.getByLabel('Start date').fill(to);
    await page.getByLabel('End date').fill(from);
    await expect(page.getByText('Invalid date range')).toBeVisible();
  });

  test('orders list: sorting by total and date', async ({ page, request }) => {
    const api = apiClient(request);
    await page.goto('/orders');
    const cheapest = (await api.get<OrdersPage>('/orders?sortBy=totalAmount&sortOrder=asc&pageSize=1')).items[0];
    const priciest = (await api.get<OrdersPage>('/orders?sortBy=totalAmount&sortOrder=desc&pageSize=1')).items[0];
    const oldest = (await api.get<OrdersPage>('/orders?sortBy=orderDate&sortOrder=asc&pageSize=1')).items[0];

    await page.getByRole('button', { name: /^Sort by Total/ }).click(); // desc first
    await expect(rows(page).first()).toContainText(priciest.orderNumber);
    await page.getByRole('button', { name: /^Sort by Total/ }).click(); // then asc
    await expect(rows(page).first()).toContainText(cheapest.orderNumber);
    await expect(page).toHaveURL(/sortBy=totalAmount&sortOrder=asc|sortOrder=asc.*sortBy=totalAmount/);

    await page.getByRole('button', { name: /^Sort by Date/ }).click(); // desc
    await page.getByRole('button', { name: /^Sort by Date/ }).click(); // asc
    await expect(rows(page).first()).toContainText(oldest.orderNumber);
  });

  test('filters and page are preserved when opening an order and going back', async ({ page }) => {
    await page.goto('/orders?fulfillmentStatus=FULFILLED&pageSize=10&page=2');
    await expect(page.getByText(/Page 2 of/)).toBeVisible();
    const second = rows(page).nth(1);
    const number = (await second.locator('td').first().locator('a').textContent())!.trim();
    await second.getByRole('link', { name: `View order ${number}` }).click();
    await expect(page.getByRole('heading', { name: `Order ${number}` })).toBeVisible();
    await page.getByRole('link', { name: 'Back to orders' }).click();
    await expect(page).toHaveURL(/fulfillmentStatus=FULFILLED/);
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByLabel('Fulfillment status')).toHaveValue('FULFILLED');
    await expect(page.getByText(/Page 2 of/)).toBeVisible();
  });

  test('order details show order, customer, line items and payment', async ({ page, request }) => {
    const api = apiClient(request);
    const id = (await api.get<OrdersPage>('/orders?pageSize=100')).items.find((o) => o.customerName)!.id;
    const o = await api.get<{
      orderNumber: string;
      shopifyOrderId: string;
      customer: { name: string; email: string };
      billingAddress: { address1: string; city: string };
      items: { productName: string; sku: string; quantity: number }[];
      payment: { subtotal: string; totalTax: string; totalAmount: string; currency: string };
    }>(`/orders/${id}`);

    await page.goto(`/orders/${id}`);
    await expect(page.getByRole('heading', { name: `Order ${o.orderNumber}` })).toBeVisible();
    await expect(page.getByText(o.shopifyOrderId)).toBeVisible();
    await expect(page.getByText(o.customer.name, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: o.customer.email })).toBeVisible();
    await expect(page.getByText(o.billingAddress.address1).first()).toBeVisible();

    const items = page.locator('section', { has: page.getByRole('heading', { name: 'Line items' }) }).locator('tbody tr');
    await expect(items).toHaveCount(o.items.length);
    for (const it of o.items) await expect(items.filter({ hasText: it.sku })).toContainText(String(it.quantity));

    const payment = page.locator('section', { has: page.getByRole('heading', { name: 'Payment' }) });
    await expect(payment).toContainText(usd(o.payment.subtotal));
    await expect(payment).toContainText(usd(o.payment.totalTax));
    await expect(payment).toContainText(usd(o.payment.totalAmount));
    await expect(payment).toContainText(o.payment.currency);
    // demo store is not connected -> no "Open in Shopify" link
    await expect(page.getByRole('link', { name: /Open in Shopify/ })).toHaveCount(0);
  });

  test('order details handles unknown ids', async ({ page }) => {
    await page.goto('/orders/not-a-real-id');
    await expect(page.getByText('Order not found')).toBeVisible();
  });

  test('webhook logs: counters, filtering, details and manual retry', async ({ page, request }) => {
    const api = apiClient(request);
    const logs = await api.get<{ counts: Record<string, number>; meta: { totalItems: number } }>('/webhooks/logs');
    await page.getByRole('link', { name: 'Webhook Logs' }).click();
    await expect(rows(page)).toHaveCount(Math.min(logs.meta.totalItems, 20));
    await expect(page.getByRole('button', { name: `Processed · ${logs.counts.PROCESSED ?? 0}` })).toBeVisible();

    await page.getByRole('button', { name: /^Failed ·/ }).click();
    await expect(rows(page)).toHaveCount(logs.counts.FAILED ?? 0);
    await expect(rows(page).first()).toContainText('Order payload is missing an id');

    await rows(page).first().getByRole('link').click();
    await expect(page.getByRole('heading', { name: 'Payload' })).toBeVisible();
    await expect(page.locator('pre')).toContainText('payload without an order id');
    await page.getByRole('button', { name: 'Retry now' }).click();
    // the payload is invalid, so the retry is processed and fails again (and is reported)
    await expect(page.getByText(/Retry finished with status: Failed/)).toBeVisible();
  });

  test('Shopify integration page: status, validation and OAuth redirect', async ({ page }) => {
    await page.getByRole('link', { name: 'Shopify Integration' }).click();
    await expect(page.getByRole('heading', { name: 'Shopify Integration' })).toBeVisible();
    await expect(page.getByText('Disconnected').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import all' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sync' })).toBeDisabled();

    await page.getByLabel('Store domain').fill('not a shop!');
    await page.getByRole('button', { name: /Connect store|Reconnect/ }).click();
    await expect(page.getByText('Enter a valid Shopify store domain', { exact: false })).toBeVisible();

    // A valid domain sends the browser to Shopify's OAuth page (intercepted – no external traffic).
    await page.route('https://e2e-dev-store.myshopify.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Shopify OAuth (stub)</h1>' }),
    );
    await page.getByLabel('Store domain').fill('e2e-dev-store');
    await page.getByRole('button', { name: /Connect store|Reconnect/ }).click();
    await expect(page).toHaveURL(/^https:\/\/e2e-dev-store\.myshopify\.com\/admin\/oauth\/authorize\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('scope')).toBe('read_orders,write_orders,read_products,read_customers');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/shopify\/callback$/);
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{48}$/);
  });

  test('Shopify callback errors are reported to the user', async ({ page }) => {
    await page.goto('/integrations/shopify?status=error&reason=invalid_state');
    await expect(page.getByText('The connection request expired or was already used', { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/integrations\/shopify$/);
  });

  test('create order page requires a connected store', async ({ page }) => {
    await page.getByRole('link', { name: 'Create Order' }).click();
    await expect(page.getByText('Shopify is not connected')).toBeVisible();
    await page.getByRole('link', { name: 'Connect a store' }).click();
    await expect(page).toHaveURL(/\/integrations\/shopify$/);
  });

  test('unknown pages show a not-found state', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.getByText('Page not found')).toBeVisible();
    await page.getByRole('link', { name: 'Back to dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test.describe('Responsive layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile navigation drawer opens and navigates', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Orders', exact: true }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(drawer).toBeHidden();
    await expect(rows(page).first()).toBeVisible();
  });
});
