import { expect, test as setup } from '@playwright/test';
import { DEMO_STATE } from '../playwright.config';
import { loginUI } from './helpers';

/** Signs in once through the real login form and saves the session for the CRM tests. */
setup('sign in as the demo user', async ({ page }) => {
  await loginUI(page);
  expect(await page.evaluate(() => localStorage.getItem('crm.accessToken'))).toBeTruthy();
  await page.context().storageState({ path: DEMO_STATE });
});
