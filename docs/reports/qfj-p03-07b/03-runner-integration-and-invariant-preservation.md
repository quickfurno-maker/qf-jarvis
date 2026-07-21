# Report 03 — Runner Integration and Invariant Preservation

**Date:** 2026-07-22. Integration of the classifier into `projection-runner.ts`.

## The change

In `executeRun`, after a handler throws and the SAVEPOINT is restored, the runner now calls `classifyProjectionFailure(handlerError)` and dispatches by category:

```
const classification = classifyProjectionFailure(handlerError);
if (classification.category !== 'DETERMINISTIC_HANDLER_FAILURE') {
  return abortAndThrow(client, state, failClosedRunnerCode(classification.category)); // no attempt
}
// deterministic: record ONE bounded attempt, then retry (1–4) or block (5th) — UNCHANGED path
```

`failClosedRunnerCode` maps `UNKNOWN_UNCLASSIFIED_FAILURE → 'projection-unknown-failure'`; infrastructure, repository-invariant, and cancellation all fail closed through the existing `'projection-infrastructure-failed'` code. The old two-valued `classifyHandlerError`, `inspectSqlstate`, and `isDeterministicHandlerSqlstate` were removed from the runner (moved to the taxonomy module).

## Behaviour by category

| Category                         | Records attempt?        | Checkpoint                         | Runner outcome                                                                    |
| -------------------------------- | ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| DETERMINISTIC_HANDLER_FAILURE    | **Yes** (1 bounded)     | retry 1–4 (backoff) / block on 5th | `retry-scheduled` / `blocked-now` (unchanged)                                     |
| TRANSIENT_INFRASTRUCTURE_FAILURE | No                      | unchanged (full rollback)          | throws `projection-infrastructure-failed`                                         |
| REPOSITORY_INVARIANT_FAILURE     | No                      | unchanged (full rollback)          | throws `projection-infrastructure-failed` (fail closed)                           |
| CANCELLATION_OR_SHUTDOWN         | No                      | unchanged (full rollback)          | throws `projection-infrastructure-failed` (control returns to worker supervision) |
| UNKNOWN_UNCLASSIFIED_FAILURE     | **No** (the correction) | unchanged (full rollback)          | throws `projection-unknown-failure`                                               |

## Preserved runner invariants (verified)

- Explicit `BEGIN` + `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` ownership; the shared `withTransaction` helper is **not** used.
- Advisory transaction lock derived from projection **name + version** (`pg_try_advisory_xact_lock`).
- Strict next-position processing (`checkpoint.last_position + 1`) via the projection-position map; `event.sequence` remains storage identity only.
- Handler mutation and checkpoint advancement remain atomic; the checkpoint advances **only** after a successful handler apply and **never** on failure.
- No skip semantics.
- `MAX_PROJECTION_ATTEMPTS` remains 5; the equal-jitter backoff constants are unchanged; deterministic failures 1–4 retry, the 5th blocks under the current pre-0006 mechanism.
- Infrastructure, repository-invariant, cancellation, and unknown failures consume **no** deterministic attempt.
- Reconciliation (`assertFailedAttempts` / `reconcileAttempts`) and unknown-COMMIT (`projection-commit-outcome-unknown`) behaviour are unchanged.

## Not implemented (QFJ-P03.07C+)

No failure aggregate, no `blocked ↔ failure` reconciliation table, no quarantine/replay persistence, no operator API, no action/audit ledger, no schema/attempt/checkpoint change, no migration 0006.
