# Report 04 — Test Results, API, Migration and Scope Containment

**Date:** 2026-07-22.

## Test suites

- **`projection-retry-exhaustion.test.ts`** (unit, DB-free): a recording fake client proves the seam
  composes the P03.07C primitives with the exact ADR-0040 vocabularies — the failure INSERT carries
  category `DETERMINISTIC_HANDLER_FAILURE`, code `projection-handler-failed`, automatic attempt count 5,
  and the blocked position/storage sequence; the `created` action carries actor `system` /
  `projection-runner` and the deterministic idempotency key; the write order is read-storage → failure →
  action; a missing poison event fails closed before any INSERT; and `reconcileBlockedExhaustion` passes
  for exactly one active failure at the position and fails closed for zero, many, or a position mismatch.
- **`projection-retry-exhaustion.integration.test.ts`** (integration, CI PostgreSQL): the fifth
  deterministic failure atomically establishes five attempts + blocked checkpoint + one active failure +
  one `created` action; attempts 1–4 create none; pre-commit failure injection at every establishment step
  rolls everything back; a restart after a committed exhaustion is idempotent (handler not re-invoked); an
  ambiguous COMMIT reconciles; concurrent workers establish exactly one aggregate/action/attempt; and
  infrastructure / unknown / cancellation / repository-invariant failures on the would-be fifth invocation
  establish nothing.

## Test results

| Suite                                                       | Result                                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New exhaustion unit (`projection-retry-exhaustion.test.ts`) | **11 passed / 11**                                                                                                                                              |
| Full unit (`pnpm test:unit`)                                | **2488 passed / 2488**, 57 files                                                                                                                                |
| `format:check` · `lint` · `typecheck` · `git diff --check`  | all pass (exit 0)                                                                                                                                               |
| Integration (`test:integration`)                            | **runs in CI** — local PostgreSQL not provisioned (deliberately-absent `QF_JARVIS_POSTGRES_PASSWORD`); credentials not altered; managed PostgreSQL not accessed |

The existing runner / worker / production-projection integration suites continue to pass in CI: every
blocked state they produce goes through the runner's real five-failure path, which now also establishes
the failure aggregate, so the `blocked-existing` reconciliation is satisfied; no existing test forges a
runner-read blocked checkpoint without a failure, and no runner test was weakened.

## Public API containment

Package-root runtime surface remains **exactly 39 symbols** (`public-api.test.ts` unchanged and green).
The new module and the new repository reader are internal (`projections/*`); nothing new is root-exported,
nothing was removed or renamed, and there is no export-order change. `index.ts` is untouched.

## Migration / SQL containment

- Migration 0006 SHA-256 is **unchanged**: `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4`.
- `git diff --exit-code origin/main...HEAD -- "**/migrations/**"` → exit 0 (no migration byte changed).
- `git diff --exit-code origin/main...HEAD -- "**/*.sql"` → exit 0 (**no SQL file created anywhere**).
- Migrations 0001–0006 unchanged; **migration 0007 absent**; migration 0006 not deployed (local/CI only).

## Source / package containment

- `apps`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.json` → all `git diff` exit 0.
- No dependency added; no lockfile/workspace/deployment change; no model gateway, agents, RAG, WhatsApp,
  or Core code.

## Changed-file inventory (14)

- **New source:** `projections/projection-retry-exhaustion.ts`.
- **Modified source:** `projections/projection-runner.ts` (fifth-failure establishment + blocked-existing
  reconciliation), `projections/projection-failure-repository.ts` (added `readActiveProjectionFailuresForProjection`).
- **New tests:** `tests/projection-retry-exhaustion.test.ts`, `tests/projection-retry-exhaustion.integration.test.ts`.
- **Docs:** `architecture/event-backbone.md`, `architecture/qf-jarvis-roadmap-v3.md`,
  `operations/projection-failure-operations-runbook.md`, `governance/migration-ledger.md`.
- **Reports:** the five `docs/reports/qfj-p03-07d/` files.
