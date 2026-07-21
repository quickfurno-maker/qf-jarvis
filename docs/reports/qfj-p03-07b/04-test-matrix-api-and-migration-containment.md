# Report 04 — Test Matrix, API and Migration Containment

**Date:** 2026-07-22.

## Unit test matrix (`projection-failure-taxonomy.test.ts`, no database)

Covers, table-driven where useful: explicit deterministic contract; every exact deterministic SQLSTATE + class-22 prefix; every exact infrastructure SQLSTATE + `08*`/`57P0*`/`53*` prefixes; valid-but-unrecognised SQLSTATE; plain Error / custom Error / no code; `undefined`/`null`/empty/malformed/lowercase/overlong codes; string/number/null/undefined/symbol/array thrown; hostile getters for `code` and `message` (never invoked); Proxy throwing on property access; revoked Proxy; cyclic object; recognised repository invariant (contract + `ProjectionSafeErrorCodeError`); cancellation contract + `AbortError`; precedence of cancellation/invariant over coincidental SQLSTATE; deterministic-contract detail sanitization (control chars stripped, length capped); classification result carries no free-text detail; result is frozen; the classifier never throws across a broad hostile set and always returns a valid category; and the taxonomy symbols are **not** reachable from the package root.

`projection-runner-classification.test.ts` retains the runner-owned guards: `isProjectionRunnerErrorSafely`, `assertFailedAttempts` reconciliation, and `ProjectionRunnerError` normalization — plus a new assertion that `projection-unknown-failure` exists and is distinct from `projection-infrastructure-failed`.

## Runner/integration matrix (`projection-runner.integration.test.ts`, local PostgreSQL 17 — run in CI)

- **The correction:** a plain Error with no recognised code → `projection-unknown-failure`; transaction rolls back; **no** attempt recorded; checkpoint not advanced or blocked; advisory lock released.
- Restart after an unknown failure observes **no** fabricated attempt and does not advance.
- Recovery: after correcting the handler, the same position applies exactly once and advances the checkpoint once.
- The deterministic fixture (`failHandler`) now throws the explicit `deterministicHandlerFailure()` contract, so all existing deterministic retry/block/reconciliation/isolation tests continue to exercise `DETERMINISTIC_HANDLER_FAILURE` unchanged (attempts 1–4 retry, 5th blocks).
- Infrastructure (`infraHandler`, SQLSTATE `40P01`), hostile-getter, and revoked-Proxy handler throws remain `TRANSIENT_INFRASTRUCTURE_FAILURE` (no attempt, full rollback, no leak) — behaviour unchanged.

## Test results

| Suite                                                                                       | Result                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused (`projection-failure-taxonomy` + `projection-runner-classification` + `public-api`) | **106 passed / 106**, 4 files                                                                                                                                                                                                                                     |
| Full unit (`pnpm test:unit`)                                                                | **2449 passed / 2449**, 54 files                                                                                                                                                                                                                                  |
| `format:check` · `lint` · `typecheck` · `git diff --check`                                  | all pass (exit 0)                                                                                                                                                                                                                                                 |
| Integration (`test:integration`)                                                            | **not run locally** — the local PostgreSQL environment is not provisioned in this session (requires the deliberately-absent local-only `QF_JARVIS_POSTGRES_PASSWORD`); credentials were not altered; **CI runs the repository-standard integration environment**. |

## Public API containment

The package-root runtime surface remains **exactly 39 symbols** — `public-api.test.ts` (`EXPECTED_ROOT_SURFACE.length === 39`) passes unchanged. No taxonomy symbol is exported from `index.ts`; a dedicated test asserts none of `classifyProjectionFailure`, `deterministicHandlerFailure`, `inspectSqlstate`, `ProjectionDeterministicHandlerFailure`, `PROJECTION_FAILURE_CATEGORIES`, `repositoryInvariantFailure`, `projectionCancellation` is reachable from the root. No new package dependency, lockfile, or workspace change.

## Migration / SQL containment

`git diff --exit-code main -- "**/migrations/**"` → exit 0. `git diff --exit-code main -- "**/*.sql"` → exit 0. **Migration 0006 and 0007 remain absent.** No SQL created or modified; migrations 0001–0005 unchanged. No schema, checkpoint, or attempt-table change.

## Changed-file inventory (6)

- **New:** `packages/event-backbone/src/projections/projection-failure-taxonomy.ts`; `packages/event-backbone/src/tests/projection-failure-taxonomy.test.ts`.
- **Modified:** `packages/event-backbone/src/projections/projection-runner.ts`; `.../projection-runner-errors.ts`; `.../tests/projection-runner-classification.test.ts`; `.../tests/projection-runner.integration.test.ts`.
- Plus this slice's documentation: five reports, a minimal Roadmap v3 status line, and a one-paragraph accuracy correction to `docs/architecture/event-backbone.md` (recording the taxonomy change).
