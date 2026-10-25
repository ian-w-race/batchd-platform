import { test, expect } from '@playwright/test';
import { PASSWORD, ACTIVE, DEACTIVATED, ORG_NAME, dashboardSignIn, openDashboardPanel, scannerSignIn, watchErrors } from './env.mjs';

test.skip(!PASSWORD, 'E2E_PASSWORD is not set');

test('an active admin signs in to the dashboard and sees the organization', async ({ page }) => {
  const errors = watchErrors(page);
  await dashboardSignIn(page, ACTIVE);
  await expect(page.getByText(ORG_NAME).first()).toBeVisible();
  await openDashboardPanel(page, 'recalls');
  await expect(page.getByText('Got a recall notice from a supplier?')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a deactivated member is locked out of the dashboard and the scanner', async ({ page }) => {
  await dashboardSignIn(page, DEACTIVATED);
  await expect(page.getByText('Account deactivated')).toBeVisible();
  await page.evaluate(() => sb.auth.signOut());
  await scannerSignIn(page, DEACTIVATED, null);
  await expect(page.getByText('Account deactivated')).toBeVisible();
});
