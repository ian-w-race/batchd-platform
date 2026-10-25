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
  await page.goto('/dashboard.html');
  await expect(page.locator('text=STAGING DATABASE').first()).toBeVisible();
  await page.getByPlaceholder('you@company.com').fill(email);
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /^Sign in/ }).last().click();
}

export async function scannerSignIn(page, email, storeName = 'QA Store 1') {
  await page.goto('/index.html');
  await page.locator('input[type=email]').first().fill(email);
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.click('#btn-signin');
  if (storeName) {
    // The store picker overlay; the same names also exist as hidden <option>s.
    await page.getByText(storeName, { exact: true }).filter({ visible: true }).first().click();
    await expect.poll(() => page.evaluate(() => (typeof _currentStoreId !== 'undefined' ? _currentStoreId : null) || null)).not.toBeNull();
    // A recall alert may open after sign-in on staging; close it if it does.
    const dismiss = page.getByRole('button', { name: 'Dismiss' }).filter({ visible: true });
    if (await dismiss.count()) await dismiss.first().click();
  }
}

export async function openDashboardPanel(page, id) {
  await page.click(`#nav-${id}`);
}
