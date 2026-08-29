import { expect, test } from '@playwright/test';
import { prepareCpp, runAll, setSource, testCase } from './helpers.js';

/**
 * The C++ path end to end in a real browser: fetch a ninety-megabyte toolchain, compile
 * with clang running as wasm, link with lld running as wasm, and execute the result.
 * Timeouts are generous because that is genuinely what it costs on a first visit.
 */
test.describe('c++ toolchain', () => {
  test.setTimeout(600_000);

  test('compiles and runs a program reading stdin', async ({ page }) => {
    await prepareCpp(page);
    await runAll(page);

    // The sample sums stdin, which defaults to "1 2 3 4". Asserted on the console pane
    // alone and anchored, because a bare "10" also appears in compiler output and line
    // numbers - an earlier version of this test passed on exactly that coincidence.
    await expect(testCase(page).output).toHaveText(/^10\s*$/, { timeout: 300_000 });
    await expect(testCase(page).chip).toHaveText('brak wzorca');
  });

  test('reports compiler errors against the right line', async ({ page }) => {
    await prepareCpp(page);
    await setSource(page, 'int main() { undeclared_thing(); }');
    await runAll(page);

    await expect(page.locator('.build')).toContainText('undeclared_thing', {
      timeout: 300_000,
    });
    await expect(page.locator('.build')).toContainText('blad kompilacji');
  });

  test('warns that `long` is 32-bit here and 64-bit on the judge', async ({ page }) => {
    await prepareCpp(page);
    await setSource(page, '#include <iostream>\nint main() { long n = 1; std::cout << n; }');
    await runAll(page);

    await expect(page.locator('.build')).toContainText('ILP32', { timeout: 300_000 });
  });

  test('explains that exceptions are unavailable, instead of a raw link error', async ({
    page,
  }) => {
    await prepareCpp(page);
    await setSource(page, '#include <stdexcept>\nint main() { throw std::runtime_error("x"); }');
    await runAll(page);

    // clang rejects this at compile time rather than at link, which is clearer - but the
    // message does not say the limitation belongs to this editor, so we prepend our own.
    await expect(page.locator('.build')).toContainText('Wyjatki', { timeout: 300_000 });
    await expect(page.locator('.build')).not.toContainText('\x1b[', { timeout: 5_000 });
  });
});
