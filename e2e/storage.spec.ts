import { expect, test } from '@playwright/test';
import { withoutAutoDownload } from './helpers.js';

/**
 * The storage panel. Its job is that a contestant can arm the tool deliberately before a
 * round, and can see whether the browser has agreed to keep what was downloaded.
 */
test.describe('storage panel', () => {
  test.setTimeout(300_000);

  const open = async (page: import('@playwright/test').Page) => {
    // This suite drives the download buttons itself, so the automatic fetch is off.
    await withoutAutoDownload(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Pakiety' }).click();
    await expect(page.locator('.modal')).toBeVisible();
  };

  test('lists every pack with its size and state', async ({ page }) => {
    await open(page);
    // Python, NumPy, C++ and the precompiled header.
    await expect(page.locator('.pack-list li')).toHaveCount(4);
    await expect(page.locator('.modal')).toContainText('Python 3.13');
    await expect(page.locator('.modal')).toContainText('NumPy');
    await expect(page.locator('.modal')).toContainText('MB');
  });

  test('reports how much is stored and whether it is persistent', async ({ page }) => {
    await open(page);
    await expect(page.locator('.storage-facts')).toContainText('Zajete');
    await expect(page.locator('.storage-facts')).toContainText('Trwale');
  });

  test('downloads a pack and then offers to remove it', async ({ page }) => {
    await open(page);
    const python = page.locator('.pack-list li').filter({ hasText: 'Python 3.13' });
    await python.getByRole('button', { name: 'Pobierz' }).click();
    await expect(python.locator('.chip')).toHaveText('gotowy', { timeout: 120_000 });

    await python.getByRole('button', { name: 'Usun' }).click();
    await expect(python.getByRole('button', { name: 'Pobierz' })).toBeVisible();
  });

  test('a pack downloaded here is usable without downloading it again', async ({ page }) => {
    await open(page);
    const python = page.locator('.pack-list li').filter({ hasText: 'Python 3.13' });
    await python.getByRole('button', { name: 'Pobierz' }).click();
    await expect(python.locator('.chip')).toHaveText('gotowy', { timeout: 120_000 });

    // Closing the panel must re-probe, or the main view still believes the pack is absent.
    await page.locator('.modal header button').click();
    await expect(page.locator('[data-pack="python"]')).toContainText('gotowy');
    await expect(page.getByRole('button', { name: 'Uruchom wszystkie' })).toBeEnabled();
  });
});
