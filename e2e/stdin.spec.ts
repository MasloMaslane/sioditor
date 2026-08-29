import { expect, test } from '@playwright/test';
import {
  enableInteractive,
  preparePack,
  prepareCpp,
  requireCppToolchain,
  runAll,
  setFirstCase,
  setSource,
  testCase,
} from './helpers.js';

/**
 * Interactive input. A program that asks for more than the test case provides used to see
 * end-of-input silently; it can now block and be answered live, which is what makes the
 * editor usable for poking at a solution rather than only running fixed cases.
 *
 * This is the one feature that genuinely needs cross-origin isolation: the worker blocks
 * in Atomics.wait on a SharedArrayBuffer while the page fills it.
 *
 * It is opt-in per problem, and has to be: the commonest shape here reads until end of
 * input, and those programs block forever rather than finishing if input is always
 * interactive. The last test in this file guards that default.
 */
test.describe('interactive stdin', () => {
  test.setTimeout(300_000);

  test('python: answers input() while the program waits', async ({ page }) => {
    await preparePack(page, 'python');
    await enableInteractive(page);
    await setSource(page, 'a = int(input())\nb = int(input())\nprint(a * b)');
    await setFirstCase(page, '6', '42');

    await runAll(page);

    // The first value came from the case; the second has to be typed.
    await expect(page.locator('.await-input')).toBeVisible({ timeout: 120_000 });
    await page.locator('.await-input input').fill('7');
    await page.getByRole('button', { name: 'Wyslij' }).click();

    await expect(testCase(page).chip).toHaveText('zgodne', { timeout: 120_000 });
    await expect(page.locator('.await-input')).toBeHidden();
  });

  test('python: EOF ends a program that keeps reading', async ({ page }) => {
    await preparePack(page, 'python');
    await enableInteractive(page);
    await setSource(
      page,
      'import sys\ntotal = 0\nfor line in sys.stdin:\n    total += int(line)\nprint(total)',
    );
    await setFirstCase(page, '1\n2', '');

    await runAll(page);
    await expect(page.locator('.await-input')).toBeVisible({ timeout: 120_000 });
    await page.getByRole('button', { name: 'EOF' }).click();

    await expect(testCase(page).output).toContainText('3', { timeout: 120_000 });
  });

  test('c++: cin blocks and is answered live', async ({ page, request }) => {
    await requireCppToolchain(request);
    await prepareCpp(page);
    await enableInteractive(page);
    await setSource(
      page,
      '#include <bits/stdc++.h>\nint main(){ long long a, b; std::cin >> a >> b;' +
        ' std::cout << a + b << "\\n"; }',
    );
    await setFirstCase(page, '20\n', '');

    await runAll(page);
    await expect(page.locator('.await-input')).toBeVisible({ timeout: 300_000 });
    await page.locator('.await-input input').fill('22');
    await page.getByRole('button', { name: 'Wyslij' }).click();

    await expect(testCase(page).output).toContainText('42', { timeout: 120_000 });
  });

  test('is off by default, so read-to-EOF programs still finish', async ({ page }) => {
    // The regression this guards: with input always interactive, a program reading until
    // end of input blocks for a line nobody types and dies on the time limit instead of
    // producing an answer. That is the commonest shape in competitive programming.
    await preparePack(page, 'python');
    await setSource(page, 'import sys\nprint(sum(int(x) for x in sys.stdin.read().split()))');
    await setFirstCase(page, '1 2 3 4', '10');

    await runAll(page);
    await expect(testCase(page).chip).toHaveText('zgodne', { timeout: 120_000 });
    await expect(page.locator('.await-input')).toBeHidden();
  });
});
