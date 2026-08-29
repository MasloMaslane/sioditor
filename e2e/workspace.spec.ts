import { expect, test } from '@playwright/test';
import { setFirstCase, setSource, testCase } from './helpers.js';

/**
 * Persistence. The failure this guards against is the worst one this tool has: a
 * contestant loses a solution because a tab closed or a browser crashed mid-round.
 */
test.describe('workspace', () => {
  test('keeps your code across a reload', async ({ page }) => {
    await page.goto('/');
    await setSource(page, 'print("survives a reload")');
    // Autosave is debounced; give it room rather than racing it.
    await page.waitForTimeout(1500);

    await page.reload();
    await expect(page.locator('.cm-content')).toContainText('survives a reload');
  });

  test('keeps the test cases too', async ({ page }) => {
    await page.goto('/');
    await setFirstCase(page, '11 22 33', '66');
    await page.waitForTimeout(1500);

    await page.reload();
    await expect(testCase(page).input).toHaveValue('11 22 33');
    await expect(testCase(page).expected).toHaveValue('66');
  });

  test('holds several problems at once and switches between them', async ({ page }) => {
    await page.goto('/');
    await setSource(page, 'print("first problem")');
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: '+ Py' }).click();
    await setSource(page, 'print("second problem")');
    await page.waitForTimeout(1200);

    await expect(page.locator('.problems li')).toHaveCount(2);

    // Back to the first: its source must be intact, not the one just typed.
    await page.locator('.problems li').last().locator('.problem-open').click();
    await expect(page.locator('.cm-content')).toContainText('first problem');

    await page.reload();
    await expect(page.locator('.problems li')).toHaveCount(2);
  });

  test('a new C++ problem starts from the C++ template', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ C++' }).click();
    await expect(page.locator('.cm-content')).toContainText('bits/stdc++.h');
    await expect(page.locator('.problems li').first()).toContainText('C++');
  });

  test('deleting the last problem leaves a usable one behind', async ({ page }) => {
    await page.goto('/');
    await page.locator('.problems li').first().hover();
    await page.locator('.problem-remove').first().click();
    await expect(page.locator('.problems li')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Uruchom wszystkie' })).toBeVisible();
  });

  test('exports the workspace and reads it back', async ({ page }) => {
    await page.goto('/');
    await setSource(page, 'print("exported problem")');
    await setFirstCase(page, '5', '25');
    await page.waitForTimeout(1500);

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Eksport' }).click(),
    ]).then(([d]) => d);
    const archive = await download.path();
    expect(archive).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/^sioditor-\d{4}-\d{2}-\d{2}\.zip$/);

    // Importing adds rather than replaces: losing an open problem to an import would be
    // unforgivable mid-contest.
    await page.setInputFiles('input[type="file"]', archive!);
    await expect(page.locator('.problems li')).toHaveCount(2);
    await expect(page.locator('.cm-content')).toContainText('exported problem');
    await expect(testCase(page).input).toHaveValue('5');
    await expect(testCase(page).expected).toHaveValue('25');
  });

  test('limits are editable and survive a reload', async ({ page }) => {
    await page.goto('/');
    // Addressed by name rather than position: a field added to this row previously
    // shifted every index and broke this test.
    const time = page.locator('[data-field="time-limit"]');
    const memory = page.locator('[data-field="memory-limit"]');
    await expect(time).toHaveValue('5000');
    await expect(memory).toHaveValue('256');

    await time.fill('1500');
    await memory.fill('64');
    await page.waitForTimeout(1500);

    await page.reload();
    await expect(page.locator('[data-field="time-limit"]')).toHaveValue('1500');
    await expect(page.locator('[data-field="memory-limit"]')).toHaveValue('64');
  });
});
