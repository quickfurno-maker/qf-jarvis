import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Phase 1 ships no tests, and that is deliberate. There is no business logic to
 * test yet, and a test that asserts `expect(true).toBe(true)` — or that checks a
 * constant the test itself invented — proves nothing, costs review attention,
 * and turns a green suite into a signal that means nothing. `pnpm test` is wired
 * to pass on an empty suite (see the `test` script) precisely so that the first
 * real test can be written without anyone having first deleted a fake one.
 *
 * What arrives here from Phase 2 onward is not optional, however. The rules
 * listed in docs/governance/engineering-principles.md §2 — idempotency, expiry,
 * authorization, bounds, signature and replay, and anything touching money — are
 * developed test-first, without exception: write the test, watch it fail, then
 * make it pass. For those rules the test is not a check on the implementation;
 * it is the only evidence the rule exists at all.
 *
 * See docs/engineering/quality-gates.md.
 */
export default defineConfig({
  test: {
    // Jarvis is a Node service. There is no browser, and there will not be one
    // in this repository — the future founder control plane is a separate
    // concern in a later phase.
    environment: 'node',

    // Tests live beside the source they cover, inside a workspace package.
    include: ['apps/*/src/**/*.{test,spec}.ts', 'packages/*/src/**/*.{test,spec}.ts'],

    // Never treat generated output as a test source.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
