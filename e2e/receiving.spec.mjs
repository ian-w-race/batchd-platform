import { test, expect } from '@playwright/test';
import { PASSWORD, ACTIVE, scannerSignIn, watchErrors } from './env.mjs';

test.skip(!PASSWORD, 'E2E_PASSWORD is not set');

test('a delivery recorded from a GS1 label string is saved with its lot and GTIN', async ({ page }) => {
  const errors = watchErrors(page);
  const lot = 'E2E' + Date.now().toString(36).toUpperCase();
  await scannerSignIn(page, ACTIVE);
  await page.click('#scan-mode-receiving');
  await expect(page.locator('#rcv-raw')).toBeVisible();
  await page.fill('#rcv-raw', `(01)00812345000016(10)${lot}(17)271231`);
  await page.locator('#rcv-raw').dispatchEvent('change');
  await expect(page.locator('#rcv-lot')).toHaveValue(lot);
  await expect(page.locator('#rcv-gtin')).toHaveValue(/812345000016/);
  if (!(await page.locator('#rcv-product').inputValue())) await page.fill('#rcv-product', 'E2E Creamy Peanut Butter 16 oz');
  await page.fill('#rcv-qty', '5');
  await page.click('#rcv-btn-save');
  await expect.poll(async () => page.evaluate(async (l) => {
    const { data } = await sb.from('receiving_events').select('traceability_lot_code,gtin,quantity,status,best_by').eq('traceability_lot_code', l).limit(1);
    return data?.[0] || null;
  }, lot), { timeout: 20_000 }).toMatchObject({ traceability_lot_code: lot, quantity: 5, status: 'received', best_by: '2027-12-31' });
  expect(errors).toEqual([]);
});
