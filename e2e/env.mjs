// Shared settings and helpers for the end-to-end tests.
import { expect } from '@playwright/test';

export const BASE = process.env.E2E_BASE_URL || 'http://localhost:8788';
const host = new URL(BASE).hostname;
// Staging only: localhost or a Netlify deploy preview ("name--site.netlify.app").
// The real domains use production and must never be tested against.
if (!(host === 'localhost' || host === '127.0.0.1' || /--[a-z0-9-]+\.netlify\.app$/.test(host))) {
  throw new Error(`Refusing to run end-to-end tests against ${host}: it is not a staging host.`);
}
export const IS_PREVIEW = /netlify\.app$/.test(host);
export const ACTIVE = process.env.E2E_EMAIL_ACTIVE || 'qa-active-038@batchd-staging.test';
export const DEACTIVATED = process.env.E2E_EMAIL_DEACTIVATED || 'qa-deactivated-038@batchd-staging.test';
export const PASSWORD = process.env.E2E_PASSWORD;
export const ORG_NAME = 'QA 038 Grocer';

// Console "Failed to load resource" lines carry no address, so failed
// requests are tracked by URL instead. Expected on staging hosts: the map
// tiles are locked to the real domains; the local static server has no
// Netlify functions.
const IGNORED_URLS = [/api\.maptiler\.com/, /favicon/];

export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
  });
  page.on('response', (r) => {
    const url = r.url();
    if (r.status() < 400 || IGNORED_URLS.some((re) => re.test(url))) return;
    if (!IS_PREVIEW && url.includes('/.netlify/functions/')) return;
    errors.push(`HTTP ${r.status()}: ${url.split('?')[0]}`);
  });
  return errors;
}

export async function dashboardSignIn(page, email) {
  // Central sign-in (2026-11-01): the apps send signed-out visitors to /login.
  await centralSignIn(page, email, 'retail');
}

// Signs in at /login and asks for one app; the router opens it.
export async function centralSignIn(page, email, app) {
  await page.goto('/login' + (app ? '?app=' + app : ''));
  await expect(page.locator('text=STAGING DATABASE').first()).toBeVisible();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#signin-btn').click();
}

export async function scannerSignIn(page, email, storeName = 'QA Store 1') {
  await centralSignIn(page, email, 'scan');
  if (storeName) {
    // Since the central sign-in the scanner opens with a restored session,
    // which may preselect the person's store; the store picker overlay only
    // shows when none is chosen. The same names also exist as hidden <option>s.
    const pick = page.getByText(storeName, { exact: true }).filter({ visible: true });
    await expect.poll(async () => {
      if (await pick.count()) await pick.first().click().catch(() => {});
      else await page.selectOption('#field-store', { label: storeName }).catch(() => {});
      return page.evaluate(() => (typeof _currentStoreId !== 'undefined' ? _currentStoreId : null) || null);
    }, { timeout: 30_000 }).not.toBeNull();
    // A recall alert may open after sign-in on staging; close it if it does.
    const dismiss = page.getByRole('button', { name: 'Dismiss' }).filter({ visible: true });
    if (await dismiss.count()) await dismiss.first().click();
  }
}

export async function openDashboardPanel(page, id) {
  await page.click(`#nav-${id}`);
}
