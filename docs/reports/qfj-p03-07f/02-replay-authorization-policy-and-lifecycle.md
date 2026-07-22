# Report 02 — Replay Authorization Policy and Lifecycle

**Date:** 2026-07-22.

## The replay service

`projections/projection-failure-replay.ts` (internal; not root-exported) composes the QFJ-P03.07C
repository, the QFJ-P03.07D failure state, the canonical registry, and the QFJ-P03.07E lifecycle into five
intent-specific operations — no generic status update, arbitrary target, arbitrary handler, raw SQL,
generic transaction client, direct checkpoint setter, bulk replay, or generic resolve:

| Operation                              | Kind    | Capability                            |
| -------------------------------------- | ------- | ------------------------------------- |
| `authorizeProjectionFailureReplay`     | mutate  | `projection-failure:authorize-replay` |
| `inspectActiveReplayAuthorization`     | inspect | `projection-failure:authorize-replay` |
| `executeAuthorizedProjectionReplay`    | execute | `projection-failure:execute-replay`   |
| `takeOverExpiredProjectionReplayLease` | mutate  | `projection-failure:take-over-replay` |
| `reconcileProjectionReplayOutcome`     | inspect | `projection-failure:execute-replay`   |

## Authorization policy

An **injected replay authorizer** (`ProjectionReplayAuthorizer.authorize(decision) → boolean |
Promise<boolean>`) receives the closed capability, actor type/id, target failure id, current status, and
correlation id. The three replay capabilities are **each strictly stronger** than
inspect/acknowledge/quarantine: the inspect/acknowledge/quarantine capabilities cannot authorize,
execute, or take over a replay; authorization requires `projection-failure:authorize-replay`, execution
requires `projection-failure:execute-replay`, and takeover requires `projection-failure:take-over-replay`.
A denial (false or a thrown authorizer) becomes a stable `authorization-denied` — no write, no misleading
action, no sensitive detail. Actor type/id are closed/bounded. This slice builds no authentication system;
it uses the established injected-authorizer pattern with test doubles.

## Authorize valid source state

**Only a quarantined failure may be authorized for replay** (ADR-0040 §39). A non-quarantined failure
fails closed with `invalid-source-status`.

## Authorize transaction order (one `withTransaction`, READ COMMITTED)

1. `readProjectionFailureByIdForUpdate` — lock the failure;
2. authorize (`projection-failure:authorize-replay`, with the real current status);
3. `failure-not-found` if absent;
4. idempotency: `readProjectionFailureActionByIdempotencyKey(authorize-replay:{id}:g{gen})` → if present, return the existing active authorization (idempotent);
5. `stale-generation` if `generation ≠ expectedGeneration`;
6. `invalid-source-status` if status ≠ quarantined;
7. divergence gate (`detectProjectionFailureDivergences`, filtered) → `divergence-detected`;
8. `assertBlockedCheckpoint` (status blocked at the failure position) → `divergence-detected` otherwise;
9. prove no active authorization exists → `authorization-already-active`;
10. `transitionFailureToReplayAuthorized` (quarantined → replay-authorized, generation +1);
11. `createReplayAuthorization` bound to the **new** failure generation, with a future expiry (≤ 24h);
12. append one `replay-authorized` action;
13. `COMMIT`.

**Invariants:** authorization + transition commit together; exactly one active authorization per failure;
the authorization belongs to the failure and is bound to the approved (post-transition) generation; **no
replay attempt is created; the checkpoint stays blocked; `blocked_position`/`last_position`/attempts are
untouched; no handler runs; no read model is mutated.** An exact duplicate returns the existing
replay-authorized result (no second authorization, no duplicate action, no extra increment); a conflicting
duplicate fails closed.

## Authorization identity and expiry (immutable)

The authorization is a repository-owned UUID bound to one failure; migration 0006 makes
`authorization_id`, `failure_id`, `failure_generation`, `idempotency_key`, and `created_at` **immutable**
(identity-guard trigger) and forbids DELETE. An expired, revoked, or consumed authorization **cannot**
start a replay. Idempotency is deterministic — `authorize-replay:{failure-id}:g{generation}` — never from
reason text, a timestamp alone, a stack, a payload, or a serialized request.

## Full lifecycle

`OPEN → ACKNOWLEDGED → QUARANTINED → REPLAY_AUTHORIZED → REPLAYING → (RESOLVED | back to QUARANTINED)`.
Authorize moves quarantined → replay-authorized; execute-claim moves replay-authorized → replaying;
success moves replaying → resolved; a deterministic replay failure moves replaying → quarantined (a further
replay needs a new authorization). There is no `SKIP`/`IGNORE` state and no path that resolves a failure
without a proven-successful handler application.
