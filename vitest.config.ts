import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

/**
 * Single root Vitest config for the whole workspace.
 *
 * `@qf/*` packages are aliased to their TypeScript source so tests (and the
 * code under test) run without a prior build step. The production build still
 * emits `dist/` for runtime consumption; these aliases only affect the test
 * runner.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@qf/contracts': fromRoot('./packages/contracts/src/index.ts'),
      '@qf/observability': fromRoot('./packages/observability/src/index.ts'),
      '@qf/testing': fromRoot('./packages/testing/src/index.ts'),
    },
  },
  test: {
    include: ['apps/**/tests/**/*.test.ts', 'packages/**/tests/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
  },
});
