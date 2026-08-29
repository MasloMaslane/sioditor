import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/ belongs to Playwright; vitest would try to run those specs and fail on the
    // @playwright/test imports.
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
  },
});
