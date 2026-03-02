'use strict';
const { defineConfig, devices } = require('@playwright/test');

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 300_000,          // 5 min per test — full screening phase takes ~3 min
  expect: { timeout: 20_000 },
  fullyParallel: false,      // Run E2E tests serially (site has rate limits)
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'test_reports/playwright', open: 'never' }]],
  use: {
    baseURL: process.env.SITE_URL || 'https://lexi-cipher-org-git-dev-lexisolve-admins-projects.vercel.app/',
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
