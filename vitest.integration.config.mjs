import { defineConfig } from 'vitest/config';

/**
 * The **integration** test configuration. Real PostgreSQL, and serial.
 *
 * These tests require `DATABASE_URL`. They **fail** without it — they do not skip. A
 * skipped database test is a green build that proves nothing, and proving the database
 * behaviour is the entire point of the stage that introduced them.
 *
 * ### Why one worker, and why serialisation is the whole mechanism
 *
 * Every integration file **shares and rebuilds the one `qf_jarvis` schema** in the local test
 * database: each drops it and re-runs the real migrations so it starts from nothing. Files must
 * **not** run concurrently, because one file can drop or migrate the schema underneath another —
 * surfacing as `relation "qf_jarvis.schema_migration" does not exist`, `relation "qf_jarvis.event"
 * does not exist`, a virgin-database check seeing a table appear underneath it, or `duplicate key
 * value violates unique constraint "pg_namespace_nspname_index"`.
 *
 * Three supported Vitest 4 settings together keep the run serial in a single worker:
 *
 * - `fileParallelism: false` serialises the integration test *files* (one at a time);
 * - `maxWorkers: 1` explicitly pins the whole integration run to **one worker**; and
 * - `isolate: false` preserves the shared-worker execution model — the files reuse one worker
 *   context rather than each getting a fresh isolated one. This is the supported Vitest 4 way to
 *   get the single-process behaviour the removed pool option used to provide.
 *
 * These three change only *where* the files run, not *what* they assert: **no test is skipped, no
 * assertion is lowered, nothing is retried, and no database error is suppressed.**
 *
 * Concurrency is still tested **explicitly, inside individual tests** (e.g. parallel
 * `storeValidatedEvent` races and repeated conflicting redeliveries) using concurrent promises and
 * connections against this shared schema — running the *files* serially does not weaken those
 * in-test concurrency assertions.
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

    // One file at a time, in one worker — the load-bearing lines that prevent the shared-schema
    // race. `fileParallelism: false` serialises the files; `maxWorkers: 1` pins the run to a single
    // worker; `isolate: false` keeps that worker shared across files (the supported Vitest 4
    // replacement for the removed single-process pool option).
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,

    // A hung PostgreSQL connection should fail the test, not the CI job's timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
