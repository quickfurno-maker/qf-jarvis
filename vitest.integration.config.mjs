import { defineConfig } from 'vitest/config';

/**
 * The **integration** test configuration. Real PostgreSQL, and serial.
 *
 * These tests require `DATABASE_URL`. They **fail** without it — they do not skip. A
 * skipped database test is a green build that proves nothing, and proving the database
 * behaviour is the entire point of the stage that introduced them.
 *
 * ### Why serial, and why `fileParallelism` specifically
 *
 * Every file here drops and recreates the `public` schema so that it starts from nothing.
 * Two files doing that at once destroy each other mid-run, which surfaces as
 * `duplicate key value violates unique constraint "pg_namespace_nspname_index"` — about
 * half the time. **A flake that reproduces half the time is worse than a failure that
 * reproduces every time.**
 *
 * `fileParallelism: false` is the switch that actually matters: it runs test *files* one
 * at a time. `singleFork` alone is not enough — it puts the files in one process but
 * still interleaves them. Both are set; only the first is load-bearing.
 *
 * The alternative — a PostgreSQL schema per test file — was considered and rejected. It
 * would make the migration runner schema-aware **in production**, purely so that a test
 * could run in parallel. That is a production concern invented to serve a test, and this
 * suite takes about a second and a half.
 *
 * **This serialisation is scoped to this configuration.** The 988 database-free tests run
 * in parallel under `vitest.config.mjs` and are unaffected.
 */
export default defineConfig({
  test: {
    environment: 'node',

    // Only the database tests. The naming convention is the boundary.
    include: ['packages/*/src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],

    // One file at a time. See above — this is the line that prevents the schema race.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },

    // A hung PostgreSQL connection should fail the test, not the CI job's timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
