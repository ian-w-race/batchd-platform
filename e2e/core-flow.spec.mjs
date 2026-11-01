// The core flow (improvement plan A3, "done when"): receive a delivery,
// shelf-scan it, push a recall, see it in the store, produce the records.
// One chain, in order, on one fresh lot code per run; every step reads the
// staging database as the app does. The camera is not available in the test
// browser, so the label photo is a tiny stand-in blob (the scanner uploads
// it like any photo) and the lot code is typed, as staff can on a phone.
// The recall is closed again at the end so staging does not fill up with
// live test recalls.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { PASSWORD, ACTIVE, ORG_NAME, centralSignIn, scannerSignIn, watchErrors, onPath } from './env.mjs';

test.skip(!PASSWORD, 'E2E_PASSWORD is not set');
test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36).toUpperCase();
const LOT = 'E2E' + TAG;
const GTIN = '00812345000016';
const PRODUCT = 'E2E Creamy Peanut Butter 16 oz';
const STORE = 'QA Store 1';
let recallEventId = null;

// Stand in for the camera: a label photo blob, then the product name typed.
async function startShelfScan(page) {
  await page.click('#scan-mode-shelf');
  await expect(page.locator('#phase-1')).toHaveClass(/active/);
  await page.evaluate(() => { productBlob = new Blob([new Uint8Array(64)], { type: 'image/jpeg' }); });
  await page.fill('#field-product-name', PRODUCT);
  await page.evaluate(() => goToPhase(2));
  await expect(page.locator('#phase-2')).toHaveClass(/active/);
  // The typed-lot state normally opens after the lot photo is taken.
  await page.evaluate(() => _showP2TypeState());
  await page.fill('#p2-manual-input', LOT);
  await page.click('#btn-manual-continue');
  await expect(page.locator('#phase-3')).toHaveClass(/active/);
}

test('1. a delivery is recorded from a GS1 label string with its lot and GTIN', async ({ page }) => {
  const errors = watchErrors(page);
  await scannerSignIn(page, ACTIVE, STORE);
  await page.click('#scan-mode-receiving');
  await expect(page.locator('#rcv-raw')).toBeVisible();
  await page.fill('#rcv-raw', `(01)${GTIN}(10)${LOT}(17)271231`);
  await page.locator('#rcv-raw').dispatchEvent('change');
  await expect(page.locator('#rcv-lot')).toHaveValue(LOT);
  await expect(page.locator('#rcv-gtin')).toHaveValue(/812345000016/);
  if (!(await page.locator('#rcv-product').inputValue())) await page.fill('#rcv-product', PRODUCT);
  await page.fill('#rcv-qty', '5');
  await page.click('#rcv-btn-save');
  await expect.poll(async () => page.evaluate(async (l) => {
    const { data } = await sb.from('receiving_events').select('traceability_lot_code,gtin,quantity,status,best_by').eq('traceability_lot_code', l).limit(1);
    return data?.[0] || null;
  }, LOT), { timeout: 20_000 }).toMatchObject({ traceability_lot_code: LOT, quantity: 5, status: 'received', best_by: '2027-12-31' });
  expect(errors).toEqual([]);
});

test('2. a shelf scan of the same lot is linked to that delivery and saved', async ({ page }) => {
  const errors = watchErrors(page);
  await scannerSignIn(page, ACTIVE, STORE);
  await startShelfScan(page);
  await expect(page.locator('#p3-receiving-link')).toContainText('Linked to delivery', { timeout: 20_000 });
  await expect(page.locator('#pre-placement-recall-alert')).toBeHidden();
  await page.fill('#field-quantity', '3');
  await page.click('#btn-save');
  const scan = await expect.poll(async () => page.evaluate(async (l) => {
    const { data } = await sb.from('scans').select('lot_number,quantity,store_id,receiving_event_id,removed_from_shelf_at').eq('lot_number', l).limit(1);
    return data?.[0] || null;
  }, LOT), { timeout: 30_000 }).toMatchObject({ lot_number: LOT, quantity: 3, removed_from_shelf_at: null });
  const row = await page.evaluate(async (l) => (await sb.from('scans').select('store_id,receiving_event_id').eq('lot_number', l).limit(1)).data[0], LOT);
  expect(row.store_id, 'the scan carries the store').toBeTruthy();
  expect(row.receiving_event_id, 'the scan is linked to the delivery').toBeTruthy();
  expect(errors).toEqual([]);
});

test('3. the admin pushes a recall for the lot and produces the FSMA 204 records', async ({ page }) => {
  const errors = watchErrors(page);
  await centralSignIn(page, ACTIVE, 'retail');
  await expect(page.getByText(ORG_NAME).first()).toBeVisible();
  // "Push a Recall" sits on the Dashboard overview, where sign-in lands.
  await page.getByRole('button', { name: /Push a Recall/ }).first().click();

  // Step 1: identify. The scope preview finds the store that received the lot.
  await page.fill('#composer-product', PRODUCT);
  await page.fill('#composer-lot', LOT);
  await page.locator('#composer-lot').blur();
  await expect(page.locator('#composer-scope')).toContainText(/Received or shelved at/, { timeout: 30_000 });
  await expect(page.locator('#composer-scope')).toContainText(STORE);
  await page.click('#composer-continue-btn');

  // Step 2: classify. Severity and hazard are pickers; the reason is typed.
  await page.evaluate(() => { _composerState.severity = 'class_i'; _composerState.hazardType = 'contamination'; renderRecallComposer(); });
  await page.fill('#composer-reason', 'End-to-end test recall (fictional): possible Salmonella contamination.');
  await page.click('#composer-continue-btn');
  // Step 3: strategy, defaults. Step 4: review and push.
  await page.click('#composer-continue-btn');
  await page.click('#composer-push-btn');

  // Lands on the live recall for the chain just started.
  await expect(page.locator('#btn-produce-fsma204')).toBeVisible({ timeout: 30_000 });
  recallEventId = await page.evaluate(() => _currentRecallDetailId);
  expect(recallEventId).toBeTruthy();
  // The push matched the shelf scan and stamped the event on the match row,
  // so the Live Recall page and the export can find it by event id.
  await expect.poll(async () => page.evaluate(async (id) => {
    const { data } = await sb.from('scan_recall_matches').select('recall_event_id, recall_source, scans!inner(lot_number)').eq('recall_event_id', id);
    return (data || []).map((m) => m.scans.lot_number);
  }, recallEventId), { timeout: 20_000 }).toEqual([LOT]);

  // "Produce records" downloads the sortable spreadsheet with the lot in it.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-produce-fsma204')]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  expect(csv).toContain('Traceability Lot Code');
  expect(csv).toContain(LOT);
  expect(csv).toContain(STORE);
  expect(errors).toEqual([]);
});

test('4. the store sees the recall at sign-in and when the lot is scanned again', async ({ page }) => {
  await centralSignIn(page, ACTIVE, 'scan');
  // The sign-in alert lists the recall because the shelf scan is still on shelf.
  const overlay = page.locator('#login-recall-overlay');
  await expect(overlay).toBeVisible({ timeout: 60_000 });
  await expect(overlay).toContainText(PRODUCT);
  await page.evaluate(() => dismissLoginRecall());
  await expect(overlay).toBeHidden();
  // A fresh browser always asks "Where are you working today?"; the picker
  // can open after the alert, so wait for it.
  await page.getByRole('button', { name: STORE, exact: true }).filter({ visible: true }).first().click({ timeout: 60_000 });
  await expect(page.locator('#session-store-modal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (typeof _currentStoreId !== 'undefined' ? _currentStoreId : null) || null)).not.toBeNull();

  // Scanning the recalled lot again warns before placement.
  await startShelfScan(page);
  await expect(page.locator('#pre-placement-recall-alert')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#pre-placement-recall-text')).toContainText(PRODUCT);
  await page.evaluate(() => cancelScan());
});

// Close the test recall so it does not stay live on staging.
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
