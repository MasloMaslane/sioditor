import { expect, type Page } from '@playwright/test';

/**
 * Replaces the editor contents.
 *
 * Pastes rather than types. `keyboard.type` feeds CodeMirror one character at a time,
 * which triggers auto-indent and bracket closing and quietly mangles any multi-line
 * program - an earlier version of these tests failed with compile errors for exactly that
 * reason, on source that was correct as written. Paste is inserted verbatim, and it is
 * also what a contestant actually does.
 */
export async function setSource(page: Page, source: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.evaluate((text) => {
    const target = document.querySelector('.cm-content');
    if (!target) throw new Error('no editor');
    const data = new DataTransfer();
    data.setData('text/plain', text);
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, source);
  await expect(page.locator('.cm-content')).toContainText(
    source.split('\n')[0]!.trim().slice(0, 20),
  );
}

/** Downloads the C++ pack and waits for it to be usable. */
export async function prepareCpp(page: Page): Promise<void> {
  await page.goto('/');
  // Scoped to the language switcher: "+ C++" in the problem list also matches on name.
  await page.locator('.langs').getByRole('button', { name: 'C++' }).click();
  await page.locator('[data-pack="cpp"]').getByRole('button', { name: 'Pobierz teraz' }).click();
  await expect(page.locator('[data-pack="cpp"]')).toContainText('gotowy', { timeout: 300_000 });
}
