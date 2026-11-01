import { test, expect } from '@playwright/test';
import { PASSWORD, ACTIVE, IS_PREVIEW, ORG_NAME, dashboardSignIn, centralSignIn, openDashboardPanel, watchErrors, onPath } from './env.mjs';

// Needs the Netlify functions (and calls Claude once, a few cents), so it runs
// only against a deploy preview.
test.skip(!PASSWORD || !IS_PREVIEW, 'needs E2E_PASSWORD and a deploy preview');
let recallEventId = null;

const NOTICE = (tag) => `Subject: URGENT VOLUNTARY RECALL (STAGING TEST ${tag}, FICTIONAL)

Example Nut Co. is voluntarily recalling Example Creamy Peanut Butter, 16 oz jars, because they may be contaminated with Salmonella. FDA has been notified. Class I.
UPC 0 81234 50001 6, case GTIN 00812345000016. Lot codes PB24100 through PB24150. Best By MAR 01 2027 to MAR 10 2027.
Remove from sale and hold. Questions: Jordan Lee, (559) 555-0142.`;

test('a pasted supplier notice is read, matched to stores and pushed through the composer', async ({ page }) => {
  const errors = watchErrors(page);
  await dashboardSignIn(page, ACTIVE);
  await openDashboardPanel(page, 'recalls');
  await page.getByRole('button', { name: /Read a supplier notice/ }).click();
  await page.fill('#notice-text', NOTICE(Date.now().toString(36)));
  await page.getByRole('button', { name: /Read notice/ }).click();
  await expect(page.getByText('Products in the notice', { exact: false })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#notice-modal')).toContainText('PB24100');
  await expect(page.locator('#notice-modal')).toContainText(/store.*received or shelved/i);
  await page.getByRole('button', { name: /Review and push in the composer/ }).click();
  for (let i = 0; i < 3; i++) await page.click('#composer-continue-btn');
  await page.click('#composer-push-btn');
  await expect(page.getByText(/Live recall/i).first()).toBeVisible({ timeout: 30_000 });
  recallEventId = await page.evaluate(() => _currentRecallDetailId);
  expect(errors).toEqual([]);
});

// Close the pushed recall again, as core-flow does, so staging does not
// collect one live "Example Creamy Peanut Butter" recall per preview run
// (40 of them had piled up by 2026-11-01). scripts/cleanup-staging-e2e-data.sql
// removes the closed rows later.
test.afterAll(async ({ browser }) => {
  if (!recallEventId) return;
  const page = await browser.newPage();
  try {
    await centralSignIn(page, ACTIVE, 'retail');
    await page.waitForURL(onPath('/retail'));
    await expect(page.getByText(ORG_NAME).first()).toBeVisible();
    await page.evaluate(async (id) => {
      await sb.from('recall_events').update({ closed_at: new Date().toISOString(), closed_note: 'End-to-end test, closed automatically' }).eq('id', id);
      await sb.from('recalls').update({ active: false }).eq('recall_event_id', id);
    }, recallEventId);
  } finally {
    await page.close();
  }
});
