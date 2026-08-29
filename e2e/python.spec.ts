import { expect, test } from '@playwright/test';

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

    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('import numpy\nprint(numpy.array([1, 2, 3]).sum())');

    await page.getByRole('button', { name: 'Uruchom' }).click();
    await expect(page.locator('.console pre')).toContainText('6');
  });
});
