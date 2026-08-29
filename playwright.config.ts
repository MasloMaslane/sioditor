import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Which browser to drive, in order of preference:
 *
 *  1. A Chromium already staged by the environment (our CI container does this, at a
 *     version that will not match what @playwright/test would fetch).
 *  2. The developer's installed Google Chrome, on a machine that has one. This keeps a
 *     local test run from silently downloading a second browser.
 *  3. Playwright's own managed Chromium, which is what GitHub Actions installs.
 */
const STAGED_CHROMIUM = '/opt/pw-browsers/chromium';
const SYSTEM_CHROME = '/Applications/Google Chrome.app';

const browser: { launchOptions?: { executablePath: string }; channel?: string } = existsSync(
  STAGED_CHROMIUM,
)
  ? { launchOptions: { executablePath: STAGED_CHROMIUM } }
  : !process.env.CI && existsSync(SYSTEM_CHROME)
    ? { channel: 'chrome' }
    : {};

/**
 * Runs against the production build, not the dev server: the service worker, the real
 * COOP/COEP headers and the pack download path only exist there, and those are precisely
 * what the offline guarantee rests on.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    ...browser,
  },
  webServer: {
    command: 'pnpm --filter @sioditor/web preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
