# Report 03 — Idempotency, Reconciliation, Concurrency and Restart Proof

**Date:** 2026-07-22.

## Idempotency strategy

- **Failure identity** is a repository-supplied UUID (`randomUUID`, like `event.event_id`). A rolled-back
  establishment leaves no committed row, so a retried establishment simply inserts a fresh id; the
  `projection_failure_active_unique` partial index guarantees **at most one active failure** per
  `(name, version, position)` regardless of id.
- **Creation-action idempotency key** is **deterministic**, derived ONLY from stable repository-owned
  identity: `retry-exhaustion:{name}:v{version}:p{position}`. It uses no message, stack, thrown value, or
  timestamp. The action ledger's partial-unique `idempotency_key` index turns it into a database-level
  guarantee that a single blocked position yields a single `created` action.

### Duplicate behaviour

- **Exact already-committed state (A).** After a committed exhaustion the checkpoint is `blocked`; a later
  invocation takes the `blocked-existing` path, which **reconciles** (exactly one active failure at the
  blocked position) and returns the stable result — it re-invokes no handler, adds no sixth attempt,
  creates no second failure, and appends no second action.
- **Partial / mismatched state (B).** If establishment cannot complete (any pre-COMMIT failure), the whole
  transaction rolls back — there is no partial durable state to observe. A genuine divergence (blocked
  checkpoint with zero/many/position-mismatched active failures) fails closed with
  `projection-attempt-checkpoint-divergent`; nothing is silently completed, advanced, or repaired.

## Unknown / ambiguous COMMIT outcome

The runner's `outerCommit` maps a failed/ambiguous `COMMIT` to `projection-commit-outcome-unknown` and
destroys the client — it never assumes rollback, never repeats the handler in the same run, and never
reports success without evidence. The **next** invocation observes the durable state via the existing
read path:

1. **Committed exhaustion found** → `blocked` checkpoint → reconcile → `blocked-existing` (stable).
2. **Nothing committed / proven rollback** → `active` checkpoint at count 4 → the normal safe retry
   re-runs the fifth failure and establishes exhaustion exactly once.
3. **Partial / contradictory** → fail closed (`projection-attempt-checkpoint-divergent`).
4. **Outcome unprovable** → fail closed.

No replay authorization or replay execution is implemented; reconciliation is read-only.

## Failure-injection results (test-only; no production toggle)

`projection-retry-exhaustion.integration.test.ts` injects a deterministic failure at each pre-commit step
via a wrapping pool (no environment backdoor, no runtime fault toggle):

| Injection point                           | Result                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| after the fifth attempt (block UPDATE)    | full rollback: no fifth attempt, checkpoint active count 4, no failure/action |
| after the block (failure INSERT)          | full rollback: same                                                           |
| after the failure (created-action INSERT) | full rollback: same                                                           |
| immediately before COMMIT (pre-send)      | `projection-commit-outcome-unknown`; nothing durable                          |
| ambiguous COMMIT (ack-loss, landed)       | reconciled on the next invocation to `blocked-existing`; nothing added        |

## Concurrency results

Two workers racing the fifth failure at the same instant: the non-blocking transaction-scoped advisory
lock (name + version) serialises them — one establishes (`blocked-now`), the other observes `busy` or the
already-blocked checkpoint (`blocked-existing`). The durable state is single and consistent: **exactly one**
active failure, **exactly one** `created` action, **exactly five** attempts, the checkpoint blocked once —
never a sixth attempt, never a second aggregate, no unclassified deadlock. Additional coverage: a worker
arriving after the block, a duplicate job after exhaustion, and a non-deterministic fifth failure (which
establishes nothing).

## Restart results

1. **After attempts 1–4:** the retry schedule is intact, no failure aggregate exists, the checkpoint is
   `active` at count 4.
2. **After a committed fifth:** re-invocation returns `blocked-existing` WITHOUT re-invoking the handler
   (proven by a handler-call counter that stays at 5), adds no attempt, creates no second failure, appends
   no second action, and does not mutate the aggregate (generation stays 0).
3. **After a rolled-back fifth:** no partial state; a later normal invocation completes the exhaustion
   exactly once (five attempts, one failure, one action).
4. **After an ambiguous commit:** reconciliation determines the exact durable state; blind retry is
   prohibited.

## Checkpoint / ordering / lock invariants (unchanged)

Strict next position = `last_position + 1`; `projection_event_position` remains the ordering authority and
`event.sequence` remains storage identity only; `last_position` advances only on a successful apply and
never on the fifth failure; `blocked_position` is the failing position; no skip, no later-position
processing, no manual checkpoint jump/reset, no rebuild change. The advisory lock key remains derived from
**projection name + version only** — never worker id, event id, failure id, or position.
