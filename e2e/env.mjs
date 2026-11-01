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

// Netlify injects <script src="/.netlify/scripts/cdp"> into every deploy
// preview page. It draws the "Collaborate on this Deploy Preview" drawer
// across the bottom of the viewport, which covered the composer's Continue
// button in the workflow runs of 2026-11-01 (local runs have no drawer).
// Blocking that one request keeps the preview identical to production.
export async function blockNetlifyDrawer(page) {
  if (page._batchdDrawerBlocked) return;
  page._batchdDrawerBlocked = true;
  await page.route('**/.netlify/scripts/cdp', (route) => route.abort());
}

// Signs in at /login and asks for one app; the router opens it.
export async function centralSignIn(page, email, app) {
  await blockNetlifyDrawer(page);
  await page.goto('/login' + (app ? '?app=' + app : ''));
  await expect(page.locator('text=STAGING DATABASE').first()).toBeVisible();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#signin-btn').click();
  // Wait until the router has opened the app (path, not the ?app= query),
  // or has stopped on the deactivated screen.
  if (app) {
    // Promise.any: the losing wait rejects later and must not go unhandled.
    await Promise.any([
      page.waitForURL((u) => new URL(u).pathname === '/' + app, { timeout: 30_000 }),
      page.getByRole('heading', { name: 'Account deactivated' }).waitFor({ timeout: 30_000 }),
    ]);
  }
}

// True when the page is on that app's path (ignores ?app= on /login).
export const onPath = (path) => (u) => new URL(u).pathname === path;

export async function scannerSignIn(page, email, storeName = 'QA Store 1') {
  await centralSignIn(page, email, 'scan');
  if (storeName) {
    // The scanner asks "Where are you working today?" whenever no store
    // was chosen on this device in the last 12 hours, which is always true
    // in a fresh test browser. Pick the store there (by role: a text match
    // also finds the hidden dropdown <option>) and wait for the modal to go.
    await page.getByRole('button', { name: storeName, exact: true }).filter({ visible: true }).first().click({ timeout: 60_000 });
    await expect(page.locator('#session-store-modal')).toBeHidden();
    await expect.poll(() => page.evaluate(() => (typeof _currentStoreId !== 'undefined' ? _currentStoreId : null) || null)).not.toBeNull();
    // A recall alert may open after sign-in on staging; close it if it does.
    const dismiss = page.getByRole('button', { name: 'Dismiss' }).filter({ visible: true });
    if (await dismiss.count()) await dismiss.first().click();
  }
}

export async function openDashboardPanel(page, id) {
  await page.click(`#nav-${id}`);
}
