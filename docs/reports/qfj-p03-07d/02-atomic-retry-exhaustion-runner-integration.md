# Report 02 — Atomic Retry-Exhaustion Runner Integration

**Date:** 2026-07-22.

## The seam

A single new internal module — `projections/projection-retry-exhaustion.ts` (not root-exported) —
composes the QFJ-P03.07C persistence primitives into two runner-facing operations that run **inside the
runner's own transaction** (no pool, no `BEGIN`/`COMMIT`, no lock of their own):

- `establishRetryExhaustionFailure(client, input)` — creates the failure aggregate + `created` action.
- `reconcileBlockedExhaustion(client, input)` — proves the active-failure biconditional at a blocked checkpoint.

Plus one **minimal internal repository addition** — `readActiveProjectionFailuresForProjection` — the
plural active-failure reader the reconciliation needs (the existing single-row reader cannot distinguish
"one" from "many"). No generic setter, no `executeRawSql`, no new root export.

## Exact atomic transaction operation order (fifth deterministic failure)

Inside the runner's one `BEGIN` + `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`, under the
name+version advisory lock, after `ROLLBACK TO SAVEPOINT projection_handler` and a deterministic
classification:

1. `appendFailedAttempt(... attemptNumber = 5, safeErrorCode = 'projection-handler-failed')` — the **final attempt**.
2. `recordCheckpointBlocked(... blocked_position = last_position + 1, failed_attempt_count = 5)` — the **blocked checkpoint + position** (guarded `active`+4 → `blocked`+5; `last_position` unchanged).
3. `readPoisonEventStorageIdentity(position)` — read the poison event's `event_storage_sequence` (+ `event_id`) from the position map ⋈ event log (fail closed if absent).
4. `createProjectionFailure(...)` — **exactly one** `open` failure aggregate.
5. `appendProjectionFailureAction(... 'created')` — the append-only **creation action**.
6. `COMMIT`.

All five effects (final attempt + blocked checkpoint + blocked position + one active failure + creation
action) therefore commit or roll back **together**. Any establishment failure (`ProjectionCheckpointInvalidError`
→ `projection-attempt-checkpoint-divergent`; anything else → `projection-infrastructure-failed`) triggers
the runner's `abortAndThrow` → `ROLLBACK`, so no attempt, block, failure, or action is claimed.

## Transaction ownership

- The runner keeps its explicit `BEGIN` + `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`; the shared
  `withTransaction`/`withClient` helpers are **not** used.
- The retry-exhaustion module and the repository primitives all take the runner's **already-borrowed
  client** — no nested/independent transaction, no second connection, no separate commit.
- The transaction-scoped advisory lock (name + version only) remains held across the establishment.
- The client lifecycle is unchanged: NORMAL release only after a confirmed `COMMIT` or confirmed outer
  `ROLLBACK`; otherwise destroyed. No P03.07C test or contract was changed.

## Exact persisted values (repository-owned; never raw text)

| Field                         | Value                                                               |
| ----------------------------- | ------------------------------------------------------------------- |
| `category`                    | `DETERMINISTIC_HANDLER_FAILURE` (only the exhaustion path persists) |
| `safe_error_code`             | `projection-handler-failed`                                         |
| `status` (initial)            | `open` (ADR-0040 lifecycle start)                                   |
| `automatic_attempt_count`     | `5` (`MAX_PROJECTION_ATTEMPTS`)                                     |
| `projection_position`         | the blocked position                                                |
| `event_storage_sequence`      | the poison event's raw storage identity (reconciliation)            |
| `event_id`                    | the poison event's canonical id (optional metadata)                 |
| action `action_type`          | `created`                                                           |
| action `actor_type`           | `system`                                                            |
| action `actor_id`             | `projection-runner`                                                 |
| action `idempotency_key`      | `retry-exhaustion:{name}:v{version}:p{position}` (deterministic)    |
| action `resulting_generation` | `0` (the fresh aggregate's generation)                              |

No raw handler message, stack, SQL, payload, or arbitrary metadata is persisted; `first_failed_at` /
`last_failed_at` are the injected exhaustion instant.

## Failure identity and matching (fail-closed)

The blocked checkpoint and active failure are matched by the approved natural identity — **projection
name, version, and blocked position** — with the raw `event_storage_sequence` retained on the aggregate.
`reconcileBlockedExhaustion` requires **exactly one** active (non-terminal) failure for the projection,
sitting at the blocked position; zero, more than one, or a position mismatch each fail closed
(`projection-attempt-checkpoint-divergent`) and are **never repaired**. Per ADR-0040 the full biconditional
is the composition of database uniqueness (the `projection_failure_active_unique` partial index), the
atomic repository transaction, and the reconciliation read/divergence detector — no single database
constraint is claimed to prove it alone.

## Runner behaviour by category (preserved from QFJ-P03.07B)

| Category                 | Attempt? | Checkpoint           | Aggregate?  | Runner outcome                            |
| ------------------------ | -------- | -------------------- | ----------- | ----------------------------------------- |
| DETERMINISTIC (1–4)      | yes      | retry-pending        | no          | `retry-scheduled`                         |
| DETERMINISTIC (5th)      | yes      | **blocked**          | **yes (1)** | `blocked-now` (then `blocked-existing`)   |
| TRANSIENT_INFRASTRUCTURE | no       | unchanged (rollback) | no          | throws `projection-infrastructure-failed` |
| REPOSITORY_INVARIANT     | no       | unchanged (rollback) | no          | throws `projection-infrastructure-failed` |
| CANCELLATION_OR_SHUTDOWN | no       | unchanged (rollback) | no          | throws `projection-infrastructure-failed` |
| UNKNOWN_UNCLASSIFIED     | no       | unchanged (rollback) | no          | throws `projection-unknown-failure`       |

## Result / error contract compatibility

The externally-observed results are unchanged: `blocked-now` and `blocked-existing` keep their exact
shapes (no new result strings), and no new runner error code was introduced — establishment failures reuse
the existing closed `projection-attempt-checkpoint-divergent` and `projection-infrastructure-failed`
codes. No raw database error, handler message, stack, or failure UUID crosses the runner boundary; the
failure id stays internal to the transaction.
