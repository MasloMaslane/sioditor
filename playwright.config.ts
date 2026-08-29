import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Some environments (our CI container included) ship a Chromium that does not match the
 * build @playwright/test would fetch. Point at it when it is there rather than pulling a
 * second browser down; fall back to Playwright's own resolution everywhere else.
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(PREINSTALLED_CHROMIUM)
  ? { executablePath: PREINSTALLED_CHROMIUM }
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
    launchOptions,
  },
  webServer: {
    command: 'pnpm --filter @sioditor/web preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
