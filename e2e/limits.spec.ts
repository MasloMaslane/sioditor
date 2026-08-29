import { expect, test } from '@playwright/test';
import { prepareCpp, runAll, setSource, testCase, requireCppToolchain } from './helpers.js';

/**
 * Runtime measurement and limits, against real compiled programs.
 *
 * These exist because both behaviours were previously wrong in ways that looked right:
 * peak memory was sampled from a WebAssembly.Memory the module never used, so every run
 * reported an identical figure, and a stack overflow surfaced as a raw trap.
 */
test.describe('run limits and measurement', () => {
  test.setTimeout(600_000);

  test.beforeEach(async ({ request }) => requireCppToolchain(request));

  const prepare = async (page: import('@playwright/test').Page, source: string) => {
    await prepareCpp(page);
    await setSource(page, source);
    await runAll(page);
  };

  test('reports memory that reflects what the program actually allocated', async ({ page }) => {
    // Written to survive -O2: the buffer is filled with values the compiler cannot fold
    // and a checksum is printed, so the allocation cannot be elided. An earlier version
    // allocated a vector and printed only size(), which -O2 removed entirely.
    await prepare(
      page,
      [
        '#include <vector>',
        '#include <cstdio>',
        'int main(){',
        '  std::size_t n = 80u << 20;',
        '  std::vector<unsigned char> v(n);',
        '  for (std::size_t i = 0; i < n; i += 4096) v[i] = (unsigned char)(i * 31);',
        '  unsigned long long s = 0;',
        '  for (std::size_t i = 0; i < n; i += 4096) s += v[i];',
        '  printf("%llu\\n", s);',
        '}',
      ].join('\n'),
    );
    await expect(testCase(page).root).toContainText('MB', { timeout: 300_000 });

    const metrics = (await testCase(page).root.locator('.case-metrics').textContent()) ?? '';
    const mb = Number(/([\d.]+) MB/.exec(metrics)?.[1] ?? '0');
    // 80 MB allocated, so anything near the old constant 16 MB means the sampling is
    // reading the wrong memory again.
    expect(mb).toBeGreaterThan(70);
  });

  test('explains a stack overflow rather than showing a raw trap', async ({ page }) => {
    // Each frame carries a volatile buffer, so LLVM cannot flatten the recursion into a
    // loop the way it did with a plain accumulator - which turned an earlier version of
    // this test into an infinite loop that hit the time limit instead.
    await prepare(
      page,
      [
        '#include <cstdio>',
        'long long f(long long d) {',
        '  volatile char pad[512];',
        '  pad[0] = (char)d;',
        '  if (!d) return 0;',
        '  return f(d - 1) + pad[0];',
        '}',
        'int main(){ printf("%lld\\n", f(10000000)); }',
      ].join('\n'),
    );
    await expect(testCase(page).output).toContainText('rekursji', { timeout: 300_000 });
    await expect(testCase(page).chip).toHaveText('przepelnienie stosu');
  });
});
