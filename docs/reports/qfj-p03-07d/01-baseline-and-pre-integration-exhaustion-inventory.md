# Report 01 — Baseline and Pre-Integration Exhaustion Inventory

**Task:** QFJ-P03.07D — Atomic Retry-Exhaustion Integration (implementation).
**Date:** 2026-07-22.

## Verified baseline

| Fact                          | Value                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `main` at start               | `43137a551c70a09311fcd1815a7a1ce2718a12ba` (sync 0 0, clean)                        |
| PR #30 (QFJ-P03.07C)          | MERGED (merge commit = current main)                                                |
| Migration 0006                | present; SHA-256 `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4` |
| Migrations 0001–0005 / 0007   | 0001–0005 present & immutable; 0007 absent                                          |
| Package-root runtime surface  | 39 symbols                                                                          |
| Overlapping P03.07D branch/PR | none                                                                                |
| Managed PostgreSQL rollout    | migration 0001 only; 0006 NOT applied / not authorized                              |

**Branch:** `qfj-p03-07d-atomic-retry-exhaustion-integration`, started from the verified main SHA.

## Migration 0006 (path and checksum — unchanged this slice)

- **Path:** `packages/event-backbone/src/persistence/migrations/0006_projection_failure_operations.sql`
- **SHA-256:** `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4`
- QFJ-P03.07D creates **no** new migration and modifies **no** migration byte.

## Pre-P03.07D fifth-failure behaviour (exact, from the code as merged)

The runner (`projection-runner.ts`, `runProjectionOnce` → `executeRun`) owns one explicit
`BEGIN` + `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` transaction under a non-blocking
transaction-scoped advisory lock derived from **projection name + version**. On a handler rejection it
`ROLLBACK`s to `SAVEPOINT projection_handler`, classifies the caught value through the closed
five-category taxonomy (QFJ-P03.07B), and:

1. attempts **1–4** (deterministic): `appendFailedAttempt` (attempt N) → `recordCheckpointRetryPending`
   (equal-jitter `next_attempt_at`) → `COMMIT` → `retry-scheduled`; checkpoint stays `active`.
2. attempt **5** (deterministic): `appendFailedAttempt` (attempt 5) → `recordCheckpointBlocked`
   (`status='blocked'`, `blocked_position = last_position + 1`, `failed_attempt_count = 5`) → `COMMIT` →
   `blocked-now`. **No durable `projection_failure` aggregate and no `created` action were written** —
   the block existed only in `projection_checkpoint`.
3. a later invocation of an already-blocked checkpoint reconciled the attempts (exactly 5 failed,
   numbered 1..5, poison event present) and returned `blocked-existing`, writing nothing.
4. non-deterministic categories (infrastructure, repository-invariant, cancellation, unknown) rolled the
   whole transaction back and recorded **no** attempt.

## What P03.07C already provided (and how it is used)

Every `projection-failure-repository.ts` primitive operates on an **already-borrowed client** and opens
no transaction, takes no lock, and calls no handler — so the runner's single transaction is exactly the
composition boundary QFJ-P03.07D needs. **No transaction-ownership refactor was required.** The runner
composes `createProjectionFailure` + `appendProjectionFailureAction` (+ a new plural active-failure
reader) inside its existing `BEGIN … COMMIT`.

## The exact retry-exhaustion path inventoried (per the prompt's 13 questions)

1. attempts 1–4 written by `appendFailedAttempt` in the deterministic branch of `executeRun`.
2. the fifth attempt is the same `appendFailedAttempt` call with `attemptNumber === MAX_PROJECTION_ATTEMPTS (5)`.
3. `next_attempt_at` = `projectionRetryBackoff(...)` (equal jitter), persisted by `recordCheckpointRetryPending` (attempts 1–4 only; the fifth clears it).
4. the checkpoint becomes blocked via `recordCheckpointBlocked` (guarded transition `active`+count 4 → `blocked`+count 5).
5. `blocked_position` is the failing projection position (`last_position + 1`), unchanged `last_position`.
6. runner returns the frozen `blocked-now` (this invocation) or `blocked-existing` (later) result.
7. one transaction (the runner's) owns attempt insertion and checkpoint mutation.
8. commit failures normalize to `projection-commit-outcome-unknown` (client destroyed; re-invoke to observe durable state).
9. the transaction-scoped advisory lock is derived only from name + version and held for the whole transaction.
10. the P03.07C primitive requires an existing transaction client (it owns none) — so it is caller-owned already.
11. actor/action/lifecycle/category/code vocabularies are the closed sets in `projection-failure-persistence.ts` / taxonomy; exhaustion uses actor `system`, action `created`, status `open`, category `DETERMINISTIC_HANDLER_FAILURE`, code `projection-handler-failed`.
12. `generation` starts at 0; a replay authorization binds to an exact generation (unused this slice).
13. idempotency keys are bounded (≤128) `VARCHAR`; the exhaustion `created` action uses a deterministic key.

No ADR contradiction was found; no new ADR was required.
