import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the running Docker Compose stack (`make up`), not a dev server:
 * they exercise the same images a reviewer runs. Override the URLs with E2E_BASE_URL and
 * E2E_API_URL to point at another deployment.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // The suites share one database (drivers, riders), so they run one at a time. Each test uses
  // its own rider and trip and releases the rider afterwards, so the order does not matter.
  workers: 1,
  fullyParallel: false,
  // No automatic retries: a flaky end-to-end test must be visible, not hidden.
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  // Ride status polls every 3 s, so status changes can take a few seconds to show.
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
