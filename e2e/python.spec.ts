import { expect, test } from '@playwright/test';
import {
  preparePack,
  runAll,
  setFirstCase,
  setSource,
  testCase,
  withoutAutoDownload,
} from './helpers.js';

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

    await runAll(page);
    // 1 + 2 + 3 + 4 from the default stdin.
    await expect(testCase(page).output).toContainText('10', { timeout: 120_000 });
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

    await runAll(page);
    await expect(testCase(page).output).toContainText('10');
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

    await setSource(page, 'import numpy\nprint(numpy.array([1, 2, 3]).sum())');

    await runAll(page);
    await expect(testCase(page).output).toContainText('6');
  });

  test('will not offer Run until the runtime is actually available', async ({ page }) => {
    // Previously Run was always enabled and a click with no pack produced silence. It is
    // now gated on the pack, and the bar says what is missing.
    await withoutAutoDownload(page);
    await page.goto('/');
    await expect(page.locator('[data-pack="python"]')).toContainText('Pobierz teraz');
    await expect(page.getByRole('button', { name: 'Uruchom wszystkie' })).toBeDisabled();

    await downloadPacks(page, ['python']);
    await expect(page.getByRole('button', { name: 'Uruchom wszystkie' })).toBeEnabled();
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

  test('preserves newlines in multi-line output', async ({ page }) => {
    // Pyodide's batched stdout callback fires per line with the newline stripped, so
    // joining chunks naively ran every line together - "1\n9\n3" arrived as "193", which
    // made every multi-line comparison meaningless.
    // preparePack navigates first; the local downloadPacks helper assumes an open page,
    // so calling it on a blank tab waited three minutes for a button that was never there.
    await preparePack(page, 'python');
    await setSource(page, 'for i in (1, 9, 3):\n    print(i)');
    await setFirstCase(page, '', '1\n9\n3');

    await runAll(page);
    // Byte-identical but for the final newline, which is a match.
    await expect(testCase(page).chip).toHaveText('zgodne', { timeout: 120_000 });
    await expect(testCase(page).output).toHaveText('1\n9\n3\n');
  });
});
