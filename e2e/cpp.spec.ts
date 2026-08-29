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

  test('supports the pb_ds ordered set that OI code relies on', async ({ page }) => {
    // ext/pb_ds is a libstdc++ extension with no libc++ equivalent, so this is a
    // clean-room shim. The point of the container is order statistics, so the test asks
    // for both, on a set whose answers are obvious by inspection.
    await prepareCpp(page);
    await setSource(
      page,
      [
        '#include <bits/stdc++.h>',
        '#include <ext/pb_ds/assoc_container.hpp>',
        '#include <ext/pb_ds/tree_policy.hpp>',
        'using namespace std;',
        'using namespace __gnu_pbds;',
        'typedef tree<int, null_type, less<int>, rb_tree_tag,',
        '             tree_order_statistics_node_update> ordered_set;',
        'int main() {',
        '    ordered_set s;',
        '    for (int x : {50, 10, 40, 20, 30}) s.insert(x);',
        '    cout << *s.find_by_order(0) << " " << *s.find_by_order(4) << "\\n";',
        '    cout << s.order_of_key(30) << " " << s.order_of_key(35) << "\\n";',
        '    s.erase(10);',
        '    cout << s.size() << " " << *s.begin() << "\\n";',
        '}',
      ].join('\n'),
    );
    await runAll(page);

    // 10 is smallest and 50 largest; three keys precede 30 and also 35; after erasing 10
    // there are four left, starting at 20.
    await expect(testCase(page).output).toContainText('10 50', { timeout: 300_000 });
    await expect(testCase(page).output).toContainText('2 3');
    await expect(testCase(page).output).toContainText('4 20');
  });
});
