import { expect, type Page } from '@playwright/test';

/**
 * Replaces the editor contents.
 *
 * Pastes rather than types. `keyboard.type` feeds CodeMirror one character at a time,
 * which triggers auto-indent and bracket closing and quietly mangles any multi-line
 * program - an earlier version of these tests failed with compile errors on source that
 * was correct as written. Paste is verbatim, and is what a contestant actually does.
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

/** Downloads a language pack and waits for it to be usable. */
export async function preparePack(page: Page, language: 'cpp' | 'python'): Promise<void> {
  await page.goto('/');
  if (language === 'cpp') {
    // Scoped to the language switcher: "+ C++" in the problem list matches on name too.
    await page.locator('.langs').getByRole('button', { name: 'C++' }).click();
  }
  const bar = page.locator(`[data-pack="${language}"]`);
  const download = bar.getByRole('button', { name: 'Pobierz teraz' });
  if (await download.isVisible().catch(() => false)) await download.click();
  await expect(bar).toContainText('gotowy', { timeout: 300_000 });
}

export const prepareCpp = (page: Page) => preparePack(page, 'cpp');

/** The nth test case's input and expected boxes. */
export function testCase(page: Page, index = 0) {
  const root = page.locator('.case').nth(index);
  return {
    root,
    input: root.locator('textarea').nth(0),
    expected: root.locator('textarea').nth(1),
    output: root.locator('pre'),
    chip: root.locator('.chip'),
  };
}

/** Sets the first case, adding one if the problem has none. */
export async function setFirstCase(page: Page, input: string, expected = ''): Promise<void> {
  if ((await page.locator('.case').count()) === 0) {
    await page.getByRole('button', { name: '+ test' }).click();
  }
  const first = testCase(page, 0);
  await first.input.fill(input);
  await first.expected.fill(expected);
}

export const runAll = (page: Page) =>
  page.getByRole('button', { name: 'Uruchom wszystkie' }).click();
