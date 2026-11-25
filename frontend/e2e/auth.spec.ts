import { expect, test } from '@playwright/test';
import { DEMO, loginUI, uniqueEmail } from './helpers';

test.describe('Authentication & protected routes', () => {
  test('redirects unauthenticated users to the login page', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('registers a new account and lands on the dashboard', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Evaluator One');
    await page.getByLabel('Email').fill(uniqueEmail('reg'));
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Passw0rd1');
    await page.getByLabel('Confirm password').fill('Passw0rd1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Account created')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome back, Evaluator' })).toBeVisible();
  });

  test('shows client-side validation errors without calling the API', async ({ page }) => {
    let apiCalled = false;
    page.on('request', (r) => {
      if (r.url().includes('/api/auth/register')) apiCalled = true;
    });
    await page.goto('/register');
    await page.getByLabel('Full name').fill('E');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('different');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('At least 2 characters')).toBeVisible();
    await expect(page.getByText('Enter a valid email')).toBeVisible();
    await expect(page.getByText('At least 8 characters')).toBeVisible();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
    expect(apiCalled).toBe(false);
  });

  test('rejects a duplicate email', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Duplicate');
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Passw0rd1');
    await page.getByLabel('Confirm password').fill('Passw0rd1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('An account with this email already exists')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('rejects wrong credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('WrongPass1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logs out from the profile menu and blocks protected pages afterwards', async ({ page }) => {
    await loginUI(page);
    await page.getByRole('button', { name: /Demo Admin/ }).click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    // logout replaces the history entry, so Back cannot return into the app
    await page.goBack();
    await expect(page).not.toHaveURL(/\/dashboard/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('crm.accessToken'))).toBeNull();
  });

  test('returns to login with a message when the session is revoked server-side', async ({ page, request }) => {
    await loginUI(page);
    const token = await page.evaluate(() => localStorage.getItem('crm.accessToken'));
    await request.post('/api/auth/logout', { headers: { Authorization: `Bearer ${token}` } });
    await page.getByRole('link', { name: 'Webhook Logs' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Your session has ended. Please sign in again.')).toBeVisible();
  });

  test('returns to the originally requested page after login', async ({ page }) => {
    await page.goto('/webhooks');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(DEMO.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/webhooks$/);
  });

  test('updates the profile name and password in Settings', async ({ page }) => {
    const email = uniqueEmail('settings');
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Settings User');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Passw0rd1');
    await page.getByLabel('Confirm password').fill('Passw0rd1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Renamed User');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile updated')).toBeVisible();
    await expect(page.getByRole('button', { name: /Renamed User/ })).toBeVisible();

    await page.getByLabel('Current password').fill('WrongOld1');
    await page.getByLabel('New password').fill('NewPassw0rd2');
    await page.getByLabel('Confirm password').fill('NewPassw0rd2');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('Current password is incorrect')).toBeVisible();

    await page.getByLabel('Current password').fill('Passw0rd1');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('Password changed')).toBeVisible();

    await page.getByRole('button', { name: /Renamed User/ }).click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await loginUI(page, email, 'NewPassw0rd2');
  });
});
