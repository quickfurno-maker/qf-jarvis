# Report 04 — Test Results, API, Migration and Scope Containment

**Date:** 2026-07-22.

## Test suites

- **`projection-failure-operations.test.ts`** (unit, DB-free): a recording fake pool/client proves
  authorization denial before any write (list/acknowledge/quarantine), context/input validation
  (invalid actor type, oversized/control-bearing actor id, invalid correlation id, invalid page size,
  malformed cursor, invalid status/category/name filter, SQL-looking filter), bounded keyset list with
  next-cursor, the bounded detail model (checkpoint/attempt correlation, no sensitive fields), detail
  `failure-not-found` and `divergence-detected`, action-history, acknowledge (transition + one action, no
  checkpoint write, deterministic idempotency, stale generation, already-acknowledged, invalid
  transition, oversized reason), and quarantine (transition, divergence gate blocks, idempotent). **30
  tests.**
- **`projection-failure-operations.integration.test.ts`** (integration, CI PostgreSQL): drives a genuine
  blocked failure through the runner, then proves list/inspect/history over real data; acknowledge and
  quarantine atomically transition status + append exactly one action while leaving the blocked
  checkpoint/position/attempts unchanged; the runner still returns `blocked-existing` after quarantine; no
  replay authorization/attempt row is created; idempotent duplicate acknowledge/quarantine; stale
  generation rejected; concurrent acknowledge / concurrent quarantine / acknowledge-vs-quarantine each
  yield exactly one transition; an inspect-only operator cannot acknowledge; a forged second active
  failure (divergence) blocks quarantine; a missing failure is rejected; and the action ledger still
  refuses a direct UPDATE (append-only trigger).

## Test results

| Suite                                                         | Result                                                                                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New operations unit (`projection-failure-operations.test.ts`) | **30 passed / 30**                                                                                                                                              |
| Full unit (`pnpm test:unit`)                                  | **2518 passed / 2518**, 58 files                                                                                                                                |
| `format:check` · `lint` · `typecheck` · `git diff --check`    | all pass (exit 0)                                                                                                                                               |
| Integration (`test:integration`)                              | **runs in CI** — local PostgreSQL not provisioned (deliberately-absent `QF_JARVIS_POSTGRES_PASSWORD`); credentials not altered; managed PostgreSQL not accessed |

The existing runner / worker / production-projection / failure-persistence suites continue to pass in CI;
the repository additions are backward-compatible (the new `expectedGeneration` guard is optional, so the
QFJ-P03.07C transition tests are unchanged).

## Public API containment

Package-root runtime surface remains **exactly 39 symbols** (`public-api.test.ts` unchanged and green).
The operations service, the authorizer contract, the inspection models, the operation-error class, and
the new repository readers are all internal (`projections/*`); nothing new is root-exported, nothing
removed or renamed, no export-order change, and no new package subpath (`package.json` `exports` unchanged
at `.` + the one worker subpath).

## Migration / SQL containment

- Migration 0006 SHA-256 **unchanged**: `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4`.
- `git diff --exit-code origin/main...HEAD -- "**/migrations/**"` → exit 0; `-- "**/*.sql"` → exit 0
  (**no SQL file created anywhere**). Migrations 0001–0006 unchanged; **migration 0007 absent**; migration
  0006 not deployed (local/CI only).

## Source / package containment

- `apps`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.json` → all `git diff` exit 0.
- **`projection-runner.ts` and the projection worker are unchanged** (no runner/worker behavior change).
- No dependency added; no lockfile/workspace/deployment change; no dashboard/frontend; no model gateway,
  agents, RAG, WhatsApp, or Core code.

## Changed-file inventory (14)

- **New source:** `projections/projection-failure-operations.ts`, `projections/projection-failure-operations-errors.ts`.
- **Modified source:** `projections/projection-failure-repository.ts` (optional expected-generation guard;
  `readProjectionFailureByIdForUpdate`; `readProjectionFailureActionByIdempotencyKey`;
  `listProjectionFailuresKeyset`).
- **New tests:** `tests/projection-failure-operations.test.ts`, `tests/projection-failure-operations.integration.test.ts`.
- **Docs:** `architecture/event-backbone.md`, `architecture/qf-jarvis-roadmap-v3.md`,
  `architecture/projection-failure-operations.md`, `operations/projection-failure-operations-runbook.md`.
- **Reports:** the five `docs/reports/qfj-p03-07e/` files.
