# Report 04 — Migration, Repository Tests, API and Containment

**Date:** 2026-07-22.

## Test suites added

- **`projection-failure-migration-conformance.test.ts`** (unit, DB-free): proves the eight SQL CHECK vocabularies in migration 0006 are set-equal to the TypeScript closed vocabularies (category, diagnostic code, status, action type, actor type, authorization state, attempt state, attempt outcome code); proves 0006 creates exactly the four failure tables; proves the SQL body contains no out-of-scope tokens; proves fully-qualified `qf_jarvis` and no PUBLIC grant.
- **`projection-failure-persistence.test.ts`** (unit, DB-free): closed-vocabulary guards; `assertUuid`/`assertBoundedText` (rejects empty/oversized/control-bearing/non-string); repository input validation rejects invalid failure/action/authorization/attempt input **before any SQL** (a fake client throws if queried); and asserts none of the persistence symbols are reachable from the package root.
- **`projection-failure-persistence.integration.test.ts`** (integration, CI PostgreSQL): migrations 0001–0006 apply in order with 0001–0005 checksums intact; the four tables + guard functions exist; the full lifecycle happy path (create → acknowledge → quarantine → authorize → start → complete(succeeded) → consume → resolve + audit); the four uniqueness invariants (active failure, active authorization + single-consume, live attempt, attempt number) and the composite authorization/failure FK; append-only + DELETE + identity-immutability protection; terminal-attempt no-re-transition; least-privilege grants (INSERT/UPDATE but no DELETE on the aggregate, no UPDATE on the ledger, no PUBLIC); the projection runtime role driving the repositories end to end; divergence detection (blocked-without-failure, position-mismatch); and atomic rollback leaving no partial state.

Existing `migrate-gate` and `migration-runner` integration tests were updated to include `0006_projection_failure_operations.sql` in the applied-migration list; the Stage 3.4.5B containment test was updated to bound migrations at 0001–0006 with no 0007.

## Test results

| Suite                                                      | Result                                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused DB-free (conformance + persistence unit)           | **28 passed / 28**                                                                                                                                                                                   |
| Full unit (`pnpm test:unit`)                               | **2477 passed / 2477**, 56 files                                                                                                                                                                     |
| `format:check` · `lint` · `typecheck` · `git diff --check` | all pass (exit 0)                                                                                                                                                                                    |
| Integration (`test:integration`)                           | **runs in CI** — local PostgreSQL not provisioned this session (the deliberately-absent local-only `QF_JARVIS_POSTGRES_PASSWORD`); credentials were not altered; managed PostgreSQL was not accessed |

## Public API containment

Package-root runtime surface remains **exactly 39 symbols** (`public-api.test.ts` unchanged and green). No failure-persistence repository, failure-lifecycle, or replay-authorization symbol is root-exported; a dedicated test asserts the persistence symbols are unreachable from `index.ts`. No new package dependency, lockfile, or workspace change.

## Migration / SQL containment

- `git diff --exit-code main -- "**/migrations/0001*..0005*"` → clean (0001–0005 byte-for-byte unchanged; their reviewed checksums are re-asserted in the integration test).
- **Exactly one new migration exists: `0006_projection_failure_operations.sql`.** SHA-256 `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4`.
- **Migration 0007 is absent.** No SQL exists outside the migration and its test fixtures.

## Changed-file inventory (source/tests)

- **New source:** `projections/projection-failure-persistence.ts`, `projections/projection-failure-repository.ts`, `persistence/migrations/0006_projection_failure_operations.sql`.
- **New tests:** `tests/projection-failure-migration-conformance.test.ts`, `tests/projection-failure-persistence.test.ts`, `tests/projection-failure-persistence.integration.test.ts`.
- **Modified tests:** `tests/migrate-gate.integration.test.ts`, `tests/migration-runner.integration.test.ts`, `tests/stage-3-4-5b-containment.test.ts` (migration-list / bound updates).
- **Docs:** migration-ledger, roadmap v3 status, event-backbone persistence boundary, runbook persistence note, five reports.

## Runner containment verdict

The production projection runner (`projection-runner.ts`) is **unchanged**: it still blocks on the fifth deterministic failure via the pre-0006 `blocked` checkpoint mechanism, creates **no** failure aggregate, initiates **no** replay, runs **no** automatic reconciliation, starts **no** worker, and introduces **no** timer. No behaviour change; no scope leak into QFJ-P03.07D.
