# Report 03 — Replay Execution, Leases, Atomic Completion and Reconciliation

**Date:** 2026-07-22.

## One-shot executor

`executeAuthorizedProjectionReplay` is explicitly invoked with `{failureId, authorizationId, leaseOwner,
leaseDurationMs, now}` — **no scheduler, poller, timer, background loop, queue consumer, or
authorization discovery**. It runs in two durable phases: **claim** (one transaction) then **complete**
(a second transaction). The projection advisory lock (key from **name + version only**, non-blocking
`pg_try_advisory_xact_lock`) serialises replay with the normal runner.

## Replay-start / claim transaction

`claimReplayAttempt` (one `withTransaction`):

1. lock the failure; authorize (`projection-failure:execute-replay`); `failure-not-found` if absent; a
   `resolved` failure short-circuits to **already-resolved** (idempotent);
2. acquire the name+version advisory lock (`infrastructure-failed` if held);
3. `assertBlockedCheckpoint`;
4. **resume path** (failure already `replaying`): the live attempt must be ours (same authorization +
   lease owner) → reuse it; another owner (expired or not) → `lease-held`;
5. **claim path** (failure `replay-authorized`): validate the active authorization (belongs, active,
   generation matches, not expired); prove no live attempt; allocate `attempt_number = count + 1`; create
   one **`started`** attempt with `{lease_owner, lease_acquired_at = now, lease_expires_at = now +
leaseDurationMs}` (bounded 1s–1h); transition replay-authorized → replaying; append `replay-started`;
6. `COMMIT` — the started attempt + lease are **durable before handler execution**.

An exact duplicate by the same lease owner returns the same live attempt (no second attempt, no second
`replay-started`); a competing live owner fails closed with `lease-held`.

## Event and handler resolution

`loadPoisonEvent` reads `event_storage_sequence` from `projection_event_position` at the failure's
projection position and **fails closed** unless it equals the failure's stored `event_storage_sequence`
(`event-identity-mismatch`), a missing map/event row is `event-not-found`, and a malformed row is
`repository-invariant`. Position is the ordering identity; `event.sequence` stays storage-only. The
handler comes **only** from the canonical registry (`registry.get(name)`, version-checked → `unknown-definition`
on a miss/mismatch); there is no caller-supplied handler, no caller-supplied event, and no payload
injection. The event payload is never exposed to any operator response.

## Atomic replay-success transaction

`runReplaySuccess` (one `withTransaction`, READ COMMITTED, borrowed client), in order: reacquire the
name+version lock; validate the failure is `replaying`; validate our live attempt (`attempt-not-live`
otherwise) and lease ownership (`lease-held` otherwise); validate the active authorization matches; revalidate
the blocked checkpoint; load + validate the exact poison event; **apply the registered handler**; then
atomically —

1. `resumeCheckpointAfterReplay` — `blocked → active`, `last_position := blocked_position`, blocked state
   cleared, retry state reset (the ONLY transition out of `blocked`; refuses any other position);
2. `completeReplayAttempt('succeeded', resultingPosition = blocked position)`;
3. `resolveProjectionFailure` (replaying → resolved, generation-guarded);
4. `consumeReplayAuthorization` (active → consumed, records the succeeding attempt);
5. append `replay-succeeded` + `authorization-consumed` + `resolved` actions;
6. `COMMIT`.

**Atomic invariant:** read-model mutation + checkpoint advancement + blocked clearing + attempt success +
failure resolution + authorization consumption + append-only evidence = **one commit**. Any pre-commit
error rolls back **every** effect (the handler runs inside this transaction; a handler throw becomes a
private sentinel that rolls the whole transaction back). No partial success is possible.

### Checkpoint success semantics

`last_position` becomes exactly the failed position (never beyond); blocked state and `blocked_position`
are cleared **only** in the success transaction; the next normal runner invocation processes
`last_position + 1`; no later position is applied by the replay service; there is no skip.

## Replay-failure semantics (by taxonomy category)

The handler throw is classified through the **existing** five-category taxonomy (no second classifier):

- **Deterministic handler failure** → `recordReplayFailure` (a separate transaction): `completeReplayAttempt('failed', 'projection-handler-failed')`, consume the one-shot authorization, transition replaying → **quarantined**, append `replay-failed` + `authorization-consumed`. **Checkpoint stays blocked; `last_position`/`blocked_position` untouched; no read-model mutation committed; no automatic retry.**
- **Transient infrastructure** → fail closed with `infrastructure-failed`; the success transaction rolled back, so nothing is committed; the `started` attempt + lease remain for reconciliation/takeover; no false success, no checkpoint advance.
- **Repository invariant** → fail closed with `repository-invariant`; no advance, no repair.
- **Cancellation/shutdown** → fail closed with `cancelled`; no advance, no false success; control returns to the caller.
- **Unknown/unclassified** → fail closed with `unknown-failure`; no advance, no blind retry.

The failure is **never** resolved on replay failure; the checkpoint is **never** advanced; a new
authorization is **never** created automatically.

## Idempotency

Deterministic, repository-owned identities: `authorize-replay:{failure-id}:g{generation}`,
`start-replay:{authorization-id}`, `complete-replay:{attempt-id}:success`,
`complete-replay:{attempt-id}:failure`, `takeover-replay:{previous-attempt-id}:{new-owner}` — enforced by
the action ledger's partial-unique `idempotency_key` index. An exact duplicate produces no duplicate
authorization, attempt, handler application, checkpoint advancement, or action, and returns the stable
existing result; a conflicting duplicate fails closed.

## Optimistic concurrency and leases

Every mutation is generation-guarded (DB-enforced over the FOR UPDATE row lock + advisory lock). One live
attempt per failure (partial-unique index). Because migration 0006 makes the lease **immutable**,
`takeOverExpiredProjectionReplayLease` — refused before expiry (`lease-not-expired`) — **abandons** the
expired attempt (`started → abandoned`) and starts a **fresh** attempt (next number, new lease), appending
`lease-taken-over`; it never executes the handler and is idempotent. Takeover after an _ambiguous_ prior
outcome is not blind: the failure must still be `replaying` with the expired live attempt.

## Unknown / ambiguous COMMIT

Any non-replay error (including a commit-phase failure) becomes `commit-outcome-unknown`. The caller
`reconcileProjectionReplayOutcome` (read-only) reports the durable failure status, live attempt/lease,
active authorization, and divergences — never repairing. A `resolved` failure is a committed success (do
not re-run); a `replaying` failure with our live attempt may be resumed by re-invoking execute (idempotent
via the durable state); a `quarantined` failure with a terminal attempt is a recorded failure; a
divergence or unprovable state fails closed. No replay authorization is created during reconciliation.

## Concurrency and restart (integration-proven)

Two concurrent executors apply the handler **once** and resolve the failure once (the FOR UPDATE row lock +
advisory lock serialise them; the loser gets `lease-held`/`infrastructure-failed`/`already-resolved`). A
restart after a committed success reconciles to **already-resolved** (handler not re-invoked, checkpoint
advanced exactly once, failure resolved, authorization consumed); a restart after a start commit leaves the
live attempt for the same owner to resume; a restart after a rolled-back success leaves no partial state; a
restart after an expired lease requires explicit authorized takeover (no background auto-takeover).
