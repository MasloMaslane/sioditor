import { expect, test } from '@playwright/test';
import { preparePack, runAll, setSource, testCase } from './helpers.js';

/**
 * The test-case panel. This is the feature the tool exists for: paste the samples from a
 * task statement, run them all, see which differ and where.
 */
test.describe('test cases', () => {
  test.setTimeout(300_000);

  test('runs several cases and judges each one', async ({ page }) => {
    await preparePack(page, 'python');
    await setSource(page, 'print(int(input()) * 2)');

    await page.getByRole('button', { name: '+ test' }).click();
    await testCase(page, 0).input.fill('5');
    await testCase(page, 0).expected.fill('10');
    await testCase(page, 1).input.fill('7');
    await testCase(page, 1).expected.fill('99');

    await runAll(page);

    await expect(testCase(page, 0).chip).toHaveText('zgodne', { timeout: 120_000 });
    await expect(testCase(page, 1).chip).toHaveText('rozne');
    await expect(testCase(page, 1).output).toContainText('14');
  });

  test('accepts a missing final newline, saying so without crying wolf', async ({ page }) => {
    await preparePack(page, 'python');
    // print() emits a trailing newline; the expected value here deliberately has none.
    await setSource(page, 'print("abc")');
    await testCase(page, 0).input.fill('');
    await testCase(page, 0).expected.fill('abc');

    await runAll(page);
    await expect(testCase(page, 0).chip).toHaveText('zgodne', { timeout: 120_000 });
    await expect(testCase(page, 0).root).toContainText('tak samo jak robi to sedzia');
  });

  test('points at the first differing line', async ({ page }) => {
    await preparePack(page, 'python');
    await setSource(page, 'print("1\\n9\\n3")');
    await testCase(page, 0).input.fill('');
    await testCase(page, 0).expected.fill('1\n2\n3');

    await runAll(page);
    await expect(testCase(page, 0).root).toContainText('linii 2', { timeout: 120_000 });
  });

  test('pastes several cases out of a task statement', async ({ page }) => {
    await preparePack(page, 'python');
    await page.getByRole('button', { name: 'Wklej' }).click();
    await page.locator('.paste-box textarea').fill('5\n\n25\n---\n6\n\n36');
    await page.getByRole('button', { name: 'Dodaj' }).click();

    // One case existed already, so pasting two makes three.
    await expect(page.locator('.case')).toHaveCount(3);
    await expect(testCase(page, 1).input).toHaveValue('5');
    await expect(testCase(page, 1).expected).toHaveValue('25');
    await expect(testCase(page, 2).expected).toHaveValue('36');
  });

  test('runs a case with no expected output and just shows what came back', async ({ page }) => {
    await preparePack(page, 'python');
    await setSource(page, 'print("hello")');
    await testCase(page, 0).input.fill('');
    await testCase(page, 0).expected.fill('');

    await runAll(page);
    await expect(testCase(page, 0).chip).toHaveText('brak wzorca', { timeout: 120_000 });
    await expect(testCase(page, 0).output).toContainText('hello');
  });
});
