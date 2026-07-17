import { defineConfig } from 'vitest/config';

/**
 * The **integration** test configuration. Real PostgreSQL, and serial.
 *
 * These tests require `DATABASE_URL`. They **fail** without it — they do not skip. A
 * skipped database test is a green build that proves nothing, and proving the database
 * behaviour is the entire point of the stage that introduced them.
 *
 * ### Why serial, and why `fileParallelism: false` is the whole mechanism
 *
 * Every file here drops and recreates its schema so that it starts from nothing. Two files
 * doing that at once destroy each other mid-run, which surfaces as
 * `duplicate key value violates unique constraint "pg_namespace_nspname_index"` — about
 * half the time. **A flake that reproduces half the time is worse than a failure that
 * reproduces every time.**
 *
 * `fileParallelism: false` runs test *files* one at a time. In Vitest 4 it **also forces
 * `maxWorkers` to 1**, so the whole integration suite runs in a single worker/process — which
 * is exactly what the removed `poolOptions.forks.singleFork` used to provide. So the one line
 * now carries both guarantees, and the deprecated `poolOptions` block is gone (Vitest 4 removed
 * it; its options are top-level, and for forks there is no separate `singleFork` to set —
 * `fileParallelism: false` subsumes it). No test is skipped and none is retried.
 *
 * The alternative — a PostgreSQL schema per test file — was considered and rejected. It
 * would make the migration runner schema-aware **in production**, purely so that a test
 * could run in parallel. That is a production concern invented to serve a test, and this
 * suite takes a few seconds.
 *
 * **This serialisation is scoped to this configuration.** The database-free unit tests run
 * in parallel under `vitest.config.mjs` and are unaffected.
 */
export default defineConfig({
  test: {
    environment: 'node',

    // Only the database tests. The naming convention is the boundary.
    include: ['packages/*/src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],

    // One file at a time — the load-bearing line that prevents the schema race. In Vitest 4
    // this also pins maxWorkers to 1, so every integration file runs serially in one process.
    fileParallelism: false,
    pool: 'forks',

    // A hung PostgreSQL connection should fail the test, not the CI job's timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
