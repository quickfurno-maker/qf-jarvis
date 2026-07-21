# Report 01 — Baseline and Existing Failure-Runtime Inventory

**Task:** QFJ-P03.07A — Projection Failure Operations Design and Invariant Audit (documentation/planning only).
**Date:** 2026-07-21. **Scope:** Read-only inventory of the merged projection runtime before any design decision.

## Baseline SHAs

| Fact                 | Value                                                |
| -------------------- | ---------------------------------------------------- |
| Local `main`         | `a7501d8361d982c5f3f2c618111092e26b41aa36`           |
| `origin/main`        | `a7501d8361d982c5f3f2c618111092e26b41aa36`           |
| Synchronization      | `0 0`, clean tree                                    |
| Root runtime surface | `@qf-jarvis/event-backbone` = exactly **39** symbols |

## PR #25 status

MERGED. Merge commit `a7501d8361d982c5f3f2c618111092e26b41aa36`; governance head `e12e0d2e837c90b8733b43b26ea58503b3c87ea8`; base `main`. Canonical Roadmap v3.0 and ADR-0039 are merged and locked.

## Relevant files (inspected)

- `packages/event-backbone/src/projections/projection-runner.ts` — the one-event runner.
- `.../projection-run-result.ts` — the seven frozen outcomes.
- `.../projection-runner-errors.ts` — the five closed runner error codes.
- `.../checkpoint-store.ts`, `.../attempt-store.ts` — checkpoint/attempt repositories.
- `.../projection-backoff.ts`, `.../projection-status.ts` — backoff and `MAX_PROJECTION_ATTEMPTS`.
- `.../projection-lock-key.ts` — advisory lock key derivation (name+version).
- `.../projection-event-reader.ts` — position→event join.
- `.../projection-worker.ts`, `.../projection-worker-cli.ts`, `apps/worker/src/*` — the worker + composition root.
- `packages/event-backbone/src/persistence/migrations/0004_projection_foundation.sql`, `0005_projection_event_positions.sql`.
- ADRs 0021, 0022, 0034, 0036, 0037, 0038, 0039.

## Current tables

| Table                                                           | Nature                                                       | Key columns                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qf_jarvis.projection_checkpoint`                               | mutable state, one row per (name, version)                   | `last_sequence`/position, `status` (`active` / `blocked`), `blocked_sequence`, `failed_attempt_count 0..5`, `last_safe_error_code`, `next_attempt_at` |
| `qf_jarvis.projection_attempt`                                  | append-only, immutable (UPDATE/DELETE trigger), payload-free | `projection_name/version`, `event_sequence`, `attempt_number 1..5`, `outcome` (`succeeded` / `failed`), `safe_error_code`, timestamps                 |
| `qf_jarvis.rm_event_type_activity`, `rm_daily_event_acceptance` | disposable metadata read models                              | metadata only                                                                                                                                         |

**No** dead-letter, quarantine, replay-authorization, operator-action, or failure-aggregate table exists (migration 0004 explicitly excluded them; ADR-0021 named `projection_quarantine`/`replay_audit` as future Stage 3.5 tables).

## Current retry behaviour

- `MAX_PROJECTION_ATTEMPTS = 5`. `attempt_number = failed_attempt_count + 1`.
- Deterministic failures 1–4 → `retry-scheduled`: append one failed attempt, set `next_attempt_at` via `projectionRetryBackoff` (deterministic equal-jitter: base 1s ×8, cap 5m), checkpoint stays `active` with `failed_attempt_count` 1–4.
- 5th deterministic failure → `blocked-now`: append the 5th failed attempt, `recordCheckpointBlocked` (status `blocked`, `blocked_position = last_position + 1`, `failed_attempt_count = 5`).
- Retry count is **durable** (checkpoint + attempt log). Backoff is deterministic and injected-clock-based (never `Date.now()`). Restart re-derives from durable state; reconciliation (`reconcileAttempts`) asserts exactly `failed_attempt_count` failed rows (or 5 for blocked) before any early return or write. Duplicate workers are prevented by the name+version advisory `xact` lock. Retry and checkpoint state advance in one transaction.

## Current runner classification

`classifyHandlerError` inspects the caught value's own SQLSTATE via a hostile-safe closed tri-state (`inspectSqlstate`: absent / valid / invalid — never invokes a getter/`toString`/`valueOf`):

- **Deterministic** (records a bounded attempt): absent code (ordinary error) **or** recognised handler SQLSTATE — `23505`, `23514`, `23503`, `23502`, `22*`, `42501`, `42P01`, `42703`, `42883`.
- **Infrastructure** (aborts, records nothing, throws `projection-infrastructure-failed`): every other valid SQLSTATE (including `40P01`, `40001`, `08*`, `57P0*`, `53*`) **and** every invalid/unreadable code.
- **Repository invariant** (`projection-attempt-checkpoint-divergent`): reconciliation divergence, missing checkpoint, malformed stored row.
- **Unknown COMMIT** (`projection-commit-outcome-unknown`); **runner unavailable** (`projection-runner-unavailable`).

The seven run-result outcomes: `busy`, `caught-up`, `succeeded`, `retry-scheduled`, `blocked-now`, `blocked-existing`, `retry-pending`.

## Current worker behaviour

`runProjectionWorker` (ADR-0038): deterministic name-order traversal, at most one position per projection per cycle, isolation (a blocked projection never stalls another), no busy-spin, injected time/sleep, graceful `AbortSignal` drain, borrows the pool. Cancellation/shutdown manufactures no result and no durable failure.

## Existing tests (relevant)

`projection-runner-classification.test.ts`, `projection-runner.integration.test.ts`, `projection-foundation.integration.test.ts`, `projection-ordering.integration.test.ts`, `projection-worker.{test,integration.test}.ts`, `projection-backoff.test.ts`, `projection-safe-error.test.ts`, `projection-store-input.test.ts`, `stage-3-4-5b-containment.test.ts`, `public-api.test.ts` (39-symbol surface).

## Gaps (what QFJ-P03.07 must add)

1. `blocked` is terminal — no path back to `active`.
2. No durable failure aggregate with an operator lifecycle.
3. No actor attribution, reason, idempotency key, correlation ID on any failure action.
4. No replay authorization (approval, expiry, single-consume).
5. No operator-action audit ledger.
6. No replay-attempt evidence distinct from automatic attempts.
7. No observability surface for failures/replays.

## Constraints (must not break)

Immutable event log; storage-sequence-vs-position separation; atomic handler+checkpoint; checkpoint never advances on failure; never skip; name+version advisory lock; classification distinctions; payload-free, sanitized diagnostics; least-privilege grants (no DELETE/TRUNCATE for the runtime role; immutable attempt log); 39-symbol root surface.

## Root API state

Package root exports exactly 39 symbols (asserted by `public-api.test.ts`). QFJ-P03.07 must keep this contained or grow it only through a reviewed, explicit change in a later slice.

## Managed-database state

Managed PostgreSQL carries **migration 0001 only**; 0002–0005 unapplied managed; **migration 0006 absent**; no managed migration authorized. No database was accessed by this task.
