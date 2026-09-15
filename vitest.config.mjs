import { defineConfig } from 'vitest/config';

/**
 * The **unit** test configuration. Database-free, and parallel.
 *
 * ### Two configurations, and why
 *
 * Stage 3.1 added PostgreSQL integration tests that share one database: they drop and
 * recreate the `public` schema to start from nothing, so two of them running at the same
 * time destroy each other's schema mid-run. They must run **serially**.
 *
 * The first fix was to make the *whole repository* serial. That worked, and it was the
 * wrong trade: it took 973 database-free contract tests — which have no shared state, no
 * I/O, and no reason to wait for anything — and made them queue behind a database. The
 * cost of a correct integration test should not be paid by every test that is not one.
 *
 * So the suites are split by what they actually need:
 *
 * | Configuration                | Files                     | Execution | `DATABASE_URL` |
 * | ---------------------------- | ------------------------- | --------- | -------------- |
 * | this one                     | `*.test.ts`               | parallel  | not used       |
 * | `vitest.integration.config`  | `*.integration.test.ts`   | serial    | **required**   |
 *
 * `pnpm test:unit` runs this one. `pnpm test:integration` runs the other. **`pnpm test`
 * runs both**, and `pnpm check` runs `pnpm test` — so the complete gate still requires a
 * real PostgreSQL, and no test is ever skipped for want of one.
 *
 * ### Nothing here may touch a database
 *
 * The exclusion below is what keeps that true. An integration test that lands in this
 * suite by accident would run in parallel with another one and corrupt it — so the naming
 * convention is load-bearing, not cosmetic: **a test that needs PostgreSQL is named
 * `*.integration.test.ts`.**
 *
 * See docs/engineering/quality-gates.md and docs/engineering/development-setup.md.
 */
export default defineConfig({
  test: {
    environment: 'node',

    /**
     * The per-test wall-clock budget.
     *
     * Raised from vitest's 5s default because this repository's containment suites are, by design,
     * whole-repository WALKS: dozens of them read every source file under `packages/**` and `apps/**`
     * to prove an import firewall. Each one is I/O-bound, each grows as the repository does, and under
     * the parallel suite they contend with each other — so on a loaded machine a walk that takes 1s
     * alone takes 6s beside fifteen others, and vitest reports a CONTAINMENT BREACH that is really a
     * stopwatch.
     *
     * That failure mode is worse than a slow test: it makes a red suite mean nothing, which is exactly
     * what a gate measured by exit code cannot afford. Two specs had already worked around it with
     * per-test budgets and a note saying why; this moves the fix to the cause instead of spreading the
     * workaround.
     *
     * It weakens nothing. Every assertion is unchanged, no lock is relaxed, and a test that genuinely
     * hangs still fails — 25 seconds later than it used to.
     */
    testTimeout: 30_000,

    // Tests live beside the source they cover, inside a workspace package.
    include: ['apps/*/src/**/*.{test,spec}.ts', 'packages/*/src/**/*.{test,spec}.ts'],

    // Never treat generated output as a test source — and never run a database test here.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
