# Report 03 — Acknowledge, Quarantine, Idempotency and Concurrency

**Date:** 2026-07-22.

## Acknowledge

**Transition:** `open → acknowledged`. **Capability:** `projection-failure:acknowledge`.

**Atomic operation order** (one `withTransaction`, implicit READ COMMITTED):

1. validate context + input (actor type/id, correlation id, expected generation, bounded reason);
2. `readProjectionFailureByIdForUpdate` — row-lock the failure;
3. authorize (with the real current status; runs even when absent, so existence is not leaked);
4. `failure-not-found` if absent;
5. idempotency: `readProjectionFailureActionByIdempotencyKey(acknowledge-failure:{id}:g{gen})` → if present, return the stable prior result (no second action, no second increment);
6. `stale-generation` if `generation ≠ expectedGeneration`; `already-acknowledged` if already in the target status; `invalid-transition` otherwise;
7. `acknowledgeProjectionFailure` (generation-guarded transition) **+** `appendProjectionFailureAction('acknowledged')` — atomic;
8. `COMMIT`.

The blocked checkpoint, blocked position, `last_position`, and every attempt are untouched; no replay is
authorized, no failure resolved, no event skipped, no attempt mutated.

## Quarantine

**Transition:** `open → quarantined` or `acknowledged → quarantined`. **Capability:**
`projection-failure:quarantine` (strictly stronger than inspect).

**Atomic operation order** adds a divergence gate (step 7):

1–6. as acknowledge (idempotency key `quarantine-failure:{id}:g{gen}`; `already-quarantined` when already quarantined); 7. **divergence gate:** `detectProjectionFailureDivergences`, filtered to this failure/projection — any relevant divergence → `divergence-detected` (no transition, no action); 8. `quarantineProjectionFailure` (generation-guarded) **+** `appendProjectionFailureAction('quarantined')` — atomic; 9. `COMMIT`.

**Quarantine preserves:** checkpoint `status='blocked'`, `blocked_position`, `last_position`, all
attempts, the failure identity, the event storage sequence, the action history, and active-failure
uniqueness. **Quarantine never:** advances/resets the checkpoint, clears the blocked position, resolves /
supersedes / retires the failure, skips the event, creates a replay authorization or attempt, invokes a
handler, mutates a read model, repairs a divergence, or deploys a migration.

## Idempotency

Deterministic, repository-owned keys derived ONLY from operation + stable target identity + expected
generation: `acknowledge-failure:{failure-id}:g{gen}` and `quarantine-failure:{failure-id}:g{gen}`. No
free-form reason, timestamp, stack, or request body enters the key. The action ledger's partial-unique
`idempotency_key` index is the durable enforcement.

- **Exact duplicate** (same operation + target + generation): returns the stable existing result — no
  duplicate action, no duplicate transition, no extra generation increment.
- **Partial / conflicting** (different generation, wrong source status): fails closed — no automatic
  completion, no repair.

## Optimistic concurrency

Every mutation carries `expectedGeneration`; the transition UPDATE additionally requires
`generation = expectedGeneration` at the database (defense in depth over the FOR UPDATE row lock). Under
the row lock, concurrent mutations serialize: the loser re-reads the now-incremented generation and either
returns the idempotent prior result (same key) or fails closed with `stale-generation` (different intent).
Proven by integration tests: concurrent acknowledge attempts yield exactly one `acknowledged` action;
concurrent quarantine attempts yield exactly one `quarantined` action; an acknowledge racing a quarantine
yields exactly one valid serial transition with the loser rejected. No last-write-wins, no silent retry of
a conflicting action, no lost update, no skipped generation.

## Unknown / ambiguous COMMIT

Mutations are safe under an ambiguous COMMIT: any non-operation error (including a commit-phase failure)
becomes `commit-outcome-unknown`. The caller re-invokes with the **same** deterministic idempotency key;
the action ledger reconciles the truth — if the action landed, the re-invocation returns the idempotent
result; if it rolled back, the re-invocation re-applies. No replay authorization is created during
reconciliation.

## Checkpoint safety

No operation in this slice calls `recordCheckpointBlocked`, `advanceCheckpointOnSuccess`,
`recordCheckpointRetryPending`, or any checkpoint write — the unit test asserts the operations never issue
an `UPDATE qf_jarvis.projection_checkpoint`, and the integration test asserts the checkpoint row is
byte-for-byte unchanged after acknowledge and quarantine and that the runner still returns
`blocked-existing`. Quarantine is failure-lifecycle metadata, not projection progress.
