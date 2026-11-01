// Central sign-in (docs/PORTALS-PLAN.md, Phase 2a): one sign-in at /login,
// then the router sends the person to their app. /retail and /scan share
// the address, so one sign-in opens both.
import { test, expect } from '@playwright/test';
import { PASSWORD, ACTIVE, DEACTIVATED, ORG_NAME, watchErrors, onPath } from './env.mjs';

test.skip(!PASSWORD, 'E2E_PASSWORD is not set');

async function loginPage(page, email) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#signin-btn').click();
}

test('an admin signs in once and opens both Retail and the scanner', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/login');
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  await loginPage(page, ACTIVE);

  // A corporate admin may open two apps, so the chooser shows both.
  await expect(page.getByRole('heading', { name: 'Choose an app' })).toBeVisible();
  await expect(page.locator('#apps .app')).toHaveCount(2);
  await page.locator('#apps .app[data-app="retail"]').click();

  // Retail opens already signed in: no dashboard sign-in form.
  await page.waitForURL(onPath('/retail'));
  await expect(page.getByText(ORG_NAME).first()).toBeVisible();

  // The scanner on the same address reads the same session.
  await page.goto('/scan');
  await expect(page.locator('#login-screen')).toBeHidden();

  // Back at the sign-in page the last app used opens directly...
  await page.goto('/login');
  await page.waitForURL(onPath('/retail'));
  // ...and "Switch app" (?choose=1) shows the chooser with it listed first.
  await page.goto('/login?choose=1');
  await expect(page.locator('#apps .app').first()).toHaveAttribute('data-app', 'retail');
  await expect(page.locator('#apps .tag')).toHaveText('Last used');

  // ?app= skips the chooser for an app the person may open.
  await page.goto('/login?app=scan');
  await page.waitForURL(onPath('/scan'));
  expect(errors).toEqual([]);
});

test('a wrong password is refused with a plain message', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill(ACTIVE);
  await page.locator('#password').fill('not-the-password-' + Date.now());
  await page.locator('#signin-btn').click();
  await expect(page.locator('#signin-msg')).toHaveText('Incorrect email or password.');
});

test('a deactivated member sees the deactivated screen at sign-in', async ({ page }) => {
  await loginPage(page, DEACTIVATED);
  await expect(page.getByRole('heading', { name: 'Account deactivated' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a signed-out visit to Retail goes through sign-in and keeps the link', async ({ page }) => {
  await page.goto('/retail?panel=recalls');
  await page.waitForURL(onPath('/login'));
  await page.locator('#email').fill(ACTIVE);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#signin-btn').click();
  await page.waitForURL((u) => new URL(u).pathname === '/retail' && new URL(u).search === '?panel=recalls');
  await expect(page.getByText('Got a recall notice from a supplier?')).toBeVisible();
});

test('signing out of Retail returns to the sign-in page', async ({ page }) => {
  await page.goto('/login?app=retail');
  await page.locator('#email').fill(ACTIVE);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#signin-btn').click();
  await page.waitForURL(onPath('/retail'));
  await page.evaluate(() => signOut());
  await page.waitForURL(onPath('/login'));
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

