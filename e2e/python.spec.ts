import { expect, test } from '@playwright/test';

/**
 * Attach browser-side diagnostics to every test.
 *
 * Without this a failure in CI reports only "expected 10, received empty string", which
 * says nothing about why - and the offline path is precisely where the interesting
 * failures live and where they cannot be reproduced locally.
 */
test.beforeEach(async ({ page }, testInfo) => {
  const log: string[] = [];
  page.on('console', (message) => log.push(`[${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => log.push(`[pageerror] ${error.message}`));
  page.on('requestfailed', (request) =>
    log.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`),
  );
  testInfo.attach; // keep the reference explicit for readers
  (testInfo as unknown as { _sioditorLog: string[] })._sioditorLog = log;
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const log = (testInfo as unknown as { _sioditorLog?: string[] })._sioditorLog ?? [];
  // Printed rather than attached: CI shows stdout inline, and an attachment would have
  // to be downloaded from the run to be read.
  console.log(`\n--- browser log for "${testInfo.title}" ---`);
  for (const line of log.slice(-60)) console.log(line);
  console.log('--- end browser log ---\n');
});

/**
 * The offline path is the whole product promise, so it is tested the way a contestant
 * would hit it: install online, lose the network, keep working.
 */
test.describe('python runtime', () => {
  test('page is cross-origin isolated', async ({ page }) => {
    await page.goto('/');
    // SharedArrayBuffer backs the interrupt buffer. A proxy that drops COOP/COEP would
    // silently downgrade us, so this is asserted rather than assumed.
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  });

  test('downloads the pack, then runs a program against stdin', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pobierz teraz' }).click();
    await expect(page.getByText(/gotowy - dziala bez internetu/)).toBeVisible();

    await page.getByRole('button', { name: 'Uruchom' }).click();
    // 1 + 2 + 3 + 4 from the default stdin.
    await expect(page.locator('.console pre')).toContainText('10');
    await expect(page.locator('.status')).toContainText('zakonczono');
  });

  test('still runs with the network gone', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pobierz teraz' }).click();
    await expect(page.getByText(/gotowy - dziala bez internetu/)).toBeVisible();

    // Wait for the service worker to take control, otherwise the reload below has
    // nothing serving the app shell.
    await page.evaluate(() => navigator.serviceWorker.ready);

    await context.setOffline(true);
    await page.reload();

    // The pack probe re-runs on load. Wait for it, rather than racing it.
    await expect(page.getByText(/gotowy - dziala bez internetu/)).toBeVisible();

    await page.getByRole('button', { name: 'Uruchom' }).click();
    await expect(page.locator('.console pre')).toContainText('10');
  });

  test('runs numpy from the cached pack while offline', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pobierz teraz' }).click();
    await expect(page.getByText(/gotowy - dziala bez internetu/)).toBeVisible();

    // The wheel rides along in the Python pack, so it is already cached by now.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(/gotowy - dziala bez internetu/)).toBeVisible();

    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('import numpy\nprint(numpy.array([1, 2, 3]).sum())');

    await page.getByRole('button', { name: 'Uruchom' }).click();
    await expect(page.locator('.console pre')).toContainText('6');
  });

  test('Run always produces feedback, never silence', async ({ page }) => {
    // The regression this guards: the pack readiness probe had not resolved when Run was
    // clicked, so the app took an early-return path that produced no output and no
    // status - the user saw nothing at all. Asserting the transient disabled state would
    // itself be a race, so this asserts the invariant instead: a click always says
    // something. Run is additionally gated on the probe having landed.
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Uruchom' })).toBeEnabled();
    await page.getByRole('button', { name: 'Uruchom' }).click();
    await expect(page.locator('.status')).not.toBeEmpty();
  });
});
