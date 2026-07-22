# Report 04 — Test Results, API, Migration and Scope Containment

**Date:** 2026-07-22.

## Test suites

- **`projection-failure-replay.test.ts`** (unit, DB-free): a recording fake pool/client proves the closed
  replay-capability vocabulary; input validation failing closed before the database (invalid actor type,
  correlation id, identifier, expiry in the past / beyond bound, out-of-bounds lease duration);
  authorization denial before any write for authorize/execute/takeover; and the fail-closed authorize
  paths (failure-not-found, stale-generation, invalid-source-status, divergence gate,
  authorization-already-active). **15 tests.**
- **`projection-failure-replay.integration.test.ts`** (integration, CI PostgreSQL): blocks a projection
  through the runner and quarantines it, then proves the happy path (authorize → execute resumes the
  checkpoint exactly one position, resolves the failure, consumes the authorization, succeeds the attempt,
  writes the read model once, and the runner then continues), idempotency (a repeat execute after success
  is `already-resolved`, handler applied once), deterministic replay failure (checkpoint stays blocked,
  `failed` attempt, authorization consumed, failure back to quarantined, no read-model mutation),
  authorization denial (no write), invalid source status, concurrency (two executors apply the handler
  once and resolve once), and expired-lease takeover (transient failure leaves a live lease → takeover
  before expiry refused → takeover after expiry abandons the old attempt and starts a fresh one → the new
  owner resumes and succeeds).

## Test results

| Suite                                                      | Result                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New replay unit (`projection-failure-replay.test.ts`)      | **15 passed / 15**                                                                                                                                              |
| Full unit (`pnpm test:unit`)                               | **2533 passed / 2533**, 59 files                                                                                                                                |
| `format:check` · `lint` · `typecheck` · `git diff --check` | all pass (exit 0)                                                                                                                                               |
| Integration (`test:integration`)                           | **runs in CI** — local PostgreSQL not provisioned (deliberately-absent `QF_JARVIS_POSTGRES_PASSWORD`); credentials not altered; managed PostgreSQL not accessed |

The existing runner / worker / production-projection / failure-persistence / failure-operations suites
continue to pass in CI; the repository additions are backward-compatible (new named transitions +
readers; `resolveProjectionFailure` gained an optional `expectedGeneration`).

## Public API containment

Package-root runtime surface remains **exactly 39 symbols** (`public-api.test.ts` unchanged and green).
The replay service, the replay authorizer contract, the replay capabilities, the result types, the replay
error class, and the new repository/checkpoint primitives are all internal (`projections/*`); nothing new
is root-exported, nothing removed or renamed, no export-order change, and no new package subpath.

## Migration / SQL containment

- Migration 0006 SHA-256 **unchanged**: `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4`.
- `git diff --exit-code origin/main...HEAD -- "**/migrations/**"` → exit 0; `-- "**/*.sql"` → exit 0
  (**no SQL file created anywhere**). Migrations 0001–0006 unchanged; **migration 0007 absent**; migration
  0006 not deployed (local/CI only).

## Source / package containment

- `apps`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.json` → all `git diff` exit 0.
- **`projection-runner.ts` and the projection worker are unchanged** (no runner/worker behavior change; the
  replay executor is a separate internal service that reuses the same advisory-lock derivation).
- No dependency added; no lockfile/workspace/deployment change; no dashboard/frontend; no scheduler/worker
  daemon; no model gateway, agents, RAG, WhatsApp, or Core code.

## Changed-file inventory (15)

- **New source:** `projections/projection-failure-replay.ts`, `projections/projection-failure-replay-errors.ts`.
- **Modified source:** `projections/projection-failure-repository.ts` (replay-lifecycle transitions;
  `readReplayAttemptById`; `countReplayAttemptsForFailure`; optional `expectedGeneration` on
  `resolveProjectionFailure`), `projections/checkpoint-store.ts` (`resumeCheckpointAfterReplay`).
- **New tests:** `tests/projection-failure-replay.test.ts`, `tests/projection-failure-replay.integration.test.ts`.
- **Docs:** `architecture/event-backbone.md`, `architecture/qf-jarvis-roadmap-v3.md`,
  `architecture/projection-failure-operations.md`, `operations/projection-failure-operations-runbook.md`.
- **Reports:** the five `docs/reports/qfj-p03-07f/` files.
