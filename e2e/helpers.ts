import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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

/**
 * Turns off automatic downloading before the app boots.
 *
 * For tests that drive the pack buttons themselves: with auto-download on, a pack is
 * usually already fetched by the time the test looks for its "Pobierz" button, and the
 * test then waits for a control that will never appear.
 *
 * Must run before navigation - the preference is read once when the hook initialises.
 */
export async function withoutAutoDownload(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sioditor.auto-download', 'off');
    } catch {
      // Private windows can refuse; the test will simply exercise the default.
    }
  });
}

/** Downloads a language pack and waits for it to be usable. */
export async function preparePack(page: Page, language: 'cpp' | 'python'): Promise<void> {
  await page.goto('/');
  if (language === 'cpp') {
    // Scoped to the language switcher: "+ C++" in the problem list matches on name too.
    await page.locator('.langs').getByRole('button', { name: 'C++' }).click();
  }
  const bar = page.locator(`[data-pack="${language}"]`);
  // The button may be gone already: automatic downloading is on by default, so the pack
  // is often fetched before a test gets here.
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

/**
 * Skips the calling suite when the C++ toolchain has not been built.
 *
 * The artifacts are ~115 MB and are produced by toolchain/build-local.sh or the toolchain
 * workflow; they are deliberately not in the repository. Without this guard CI spent five
 * minutes per test waiting for a download that could never finish, and reported a bare
 * timeout rather than the actual reason.
 */
export async function requireCppToolchain(request: APIRequestContext): Promise<void> {
  // A 200 is not enough: the preview server falls back to index.html for unknown paths,
  // so a missing artifact answers 200 with text/html. The content type is what actually
  // distinguishes "here is the compiler" from "here is the app shell".
  const response = await request.head('/toolchain/cpp/dev/clang.wasm').catch(() => null);
  const type = response?.headers()['content-type'] ?? '';
  test.skip(
    !response?.ok() || !type.includes('application/wasm'),
    'C++ toolchain artifacts are absent - build them with ./toolchain/build-local.sh',
  );
}

/** Turns on interactive input for the open problem. */
export async function enableInteractive(page: Page): Promise<void> {
  await page.locator('[data-field="interactive"]').check();
}
