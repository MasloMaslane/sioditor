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

/** Downloads the named packs and waits for each to report ready. */
async function downloadPacks(page: import('@playwright/test').Page, ids: string[]) {
  for (const id of ids) {
    const bar = page.locator(`[data-pack="${id}"]`);
    // Selecting per pack rather than by index: clicking one bar re-renders it, which
    // shifts every index-based locator taken beforehand.
    await bar.getByRole('button', { name: 'Pobierz teraz' }).click();
  }
  for (const id of ids) {
    await expect(page.locator(`[data-pack="${id}"]`)).toContainText(
      'gotowy - dziala bez internetu',
    );
  }
}

test.describe('python runtime', () => {
  test('page is cross-origin isolated', async ({ page }) => {
    await page.goto('/');
    // SharedArrayBuffer backs the interrupt buffer. A proxy that drops COOP/COEP would
    // silently downgrade us, so this is asserted rather than assumed.
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  });

  test('downloads the pack, then runs a program against stdin', async ({ page }) => {
    await page.goto('/');
    await downloadPacks(page, ['python']);

    await page.getByRole('button', { name: 'Uruchom' }).click();
    // 1 + 2 + 3 + 4 from the default stdin.
    await expect(page.locator('.console pre')).toContainText('10');
    await expect(page.locator('.status')).toContainText('zakonczono');
  });

  test('still runs with the network gone', async ({ page, context }) => {
    await page.goto('/');
    await downloadPacks(page, ['python']);

    // Wait for the service worker to take control, otherwise the reload below has
    // nothing serving the app shell.
    await page.evaluate(() => navigator.serviceWorker.ready);

    await context.setOffline(true);
    await page.reload();

    // The pack probe re-runs on load. Wait for it, rather than racing it.
    await expect(page.locator('[data-pack="python"]')).toContainText('gotowy');

    await page.getByRole('button', { name: 'Uruchom' }).click();
    await expect(page.locator('.console pre')).toContainText('10');
  });

  test('runs numpy from the cached pack while offline', async ({ page, context }) => {
    await page.goto('/');

    // numpy is a separate optional pack, so both must be fetched. Downloading only the
    // Python pack left the wheel to be pulled over the network, which passed online and
    // failed the moment it mattered.
    await downloadPacks(page, ['python', 'numpy']);

    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-pack="python"]')).toContainText('gotowy');
    await expect(page.locator('[data-pack="numpy"]')).toContainText('gotowy');

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

  test('cached pack entries carry no stale Content-Encoding', async ({ page }) => {
    // Regression guard with teeth. The dev/preview server gzips pyodide.mjs, and storing
    // the response headers verbatim alongside an already-decoded body produced a cache
    // entry claiming gzip over plain bytes. cache.match() still found it - so the pack
    // reported ready - and only the later decode failed, which made the app work online,
    // work locally off the HTTP cache, and fail offline in CI.
    await page.goto('/');
    await downloadPacks(page, ['python', 'numpy']);

    const offenders = await page.evaluate(async () => {
      const found: string[] = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith('sioditor-pack-')) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          const encoding = response?.headers.get('content-encoding');
          if (encoding) found.push(`${request.url} -> ${encoding}`);
        }
      }
      return found;
    });

    expect(offenders).toEqual([]);
  });
});
