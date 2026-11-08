// Retail, Recalls, Feed alerts (improvement plan B4 stage 5): the tab is the
// shared recall catalog with per-organization state. An admin dismisses one
// entry ("not our product"), sees it under the dismissed toggle, and restores
// it, so the shared staging organization is left as it was found.
// Run: npx playwright test e2e/feed-alerts.spec.mjs
import { test, expect } from '@playwright/test';
import { PASSWORD, ACTIVE, dashboardSignIn, openDashboardPanel, watchErrors } from './env.mjs';

test.skip(!PASSWORD, 'E2E_PASSWORD is not set');

test('Feed alerts shows the catalog; an entry can be dismissed and restored', async ({ page }) => {
  const errors = watchErrors(page);
  await dashboardSignIn(page, ACTIVE);
  await openDashboardPanel(page, 'recalls');
  await page.getByRole('button', { name: 'Feed alerts' }).click();

  // The header counts the catalog's entries for the organization's region.
  const header = page.locator('#main-content').getByText(/\d+ FDA alerts · \d+ match your scan history/);
  await expect(header).toBeVisible();
  const before = parseInt((await header.textContent()).match(/(\d+) FDA alerts/)[1], 10);
  expect(before).toBeGreaterThan(0);

  // Every live row offers Mark reviewed and Dismiss; dismiss the first one.
  const firstDismiss = page.getByRole('button', { name: 'Dismiss' }).first();
  await expect(firstDismiss).toBeVisible();
  await firstDismiss.click();

  // The live count drops by one and the dismissed section appears.
  await expect(page.locator('#main-content').getByText(new RegExp(`^${before - 1} FDA alerts`))).toBeVisible({ timeout: 20_000 });
  const toggle = page.getByRole('button', { name: /^Show \d+ dismissed$/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  const restore = page.getByRole('button', { name: 'Restore' }).first();
  await expect(restore).toBeVisible();

  // Restore puts it back.
  await restore.click();
  await expect(page.locator('#main-content').getByText(new RegExp(`^${before} FDA alerts`))).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
