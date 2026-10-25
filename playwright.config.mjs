// End-to-end tests (improvement plan A3). They run against a deploy preview
// (E2E_BASE_URL, set by .github/workflows/e2e.yml) or the local static server,
// both of which use the STAGING database. e2e/env.mjs refuses any other host.
import { defineConfig, devices } from '@playwright/test';

const local = !process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8788',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: local ? { command: 'node e2e/static-server.mjs', url: 'http://localhost:8788/index.html', reuseExistingServer: true } : undefined,
});
