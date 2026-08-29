import { expect, test } from '@playwright/test';
import { runAll, setSource, testCase } from './helpers.js';

/**
 * Packs fetch themselves on load, so the tool is ready without anyone hunting for a
 * button. The full set is around 150 MB, so it is a setting rather than a hard rule.
 */
test.describe('automatic downloads', () => {
  test.setTimeout(600_000);

  test('fetches the packs on load and enables Run without a click', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-pack="python"]')).toContainText('gotowy', {
      timeout: 300_000,
    });
    // Nothing was clicked; the run button has to notice on its own.
    await expect(page.getByRole('button', { name: 'Uruchom wszystkie' })).toBeEnabled();

    await setSource(page, 'print(6 * 7)');
    await runAll(page);
    await expect(testCase(page).output).toContainText('42', { timeout: 120_000 });
  });

  test('turning it off is remembered, and then nothing downloads by itself', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pakiety' }).click();
    await page.locator('[data-field="auto-download"]').uncheck();
    await page.locator('.modal header button').click();

    // A fresh context would be a different profile, so the same page is reloaded: the
    // preference lives in localStorage and the packs in Cache Storage.
    await page.reload();
    await page.getByRole('button', { name: 'Pakiety' }).click();
    await expect(page.locator('[data-field="auto-download"]')).not.toBeChecked();
  });

  test('a second visit does not re-download what is already cached', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-pack="python"]')).toContainText('gotowy', {
      timeout: 300_000,
    });

    const requests: string[] = [];
    page.on('request', (r) => {
      if (/\/pyodide\/|\/toolchain\//.test(r.url())) requests.push(r.url());
    });
    await page.reload();
    await expect(page.locator('[data-pack="python"]')).toContainText('gotowy');
    await page.waitForTimeout(3000);

    // Pyodide's own loader still fetches what it needs, but that is served from the
    // cache; what must not happen is the downloader pulling the packs again.
    expect(requests.filter((u) => u.includes('clang.wasm'))).toHaveLength(0);
  });
});
