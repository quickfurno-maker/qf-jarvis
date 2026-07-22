# Report 01 — Baseline and Pre-Replay Inventory

**Task:** QFJ-P03.07F — Authorized Projection Replay Execution (implementation).
**Date:** 2026-07-22.

## Verified baseline

| Fact                           | Value                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `main` at start                | `ff70245ebfab9d0977f1dac8e7eed2c39693ba52` (sync 0 0, clean)                        |
| PR #32 (QFJ-P03.07E)           | MERGED (merge commit = current main)                                                |
| Migration 0006                 | present; SHA-256 `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4` |
| Migrations 0001–0005 / 0007    | 0001–0005 present & immutable; 0007 absent                                          |
| Package-root runtime surface   | 39 symbols                                                                          |
| Inspection/ack/quarantine ops  | present (QFJ-P03.07E)                                                               |
| Existing replay implementation | none                                                                                |
| Overlapping P03.07F branch/PR  | none                                                                                |
| Managed PostgreSQL rollout     | migration 0001 only; 0006 NOT applied / not authorized                              |

**Branch:** `qfj-p03-07f-authorized-replay-execution`, from the verified main SHA. Migration 0006 is used
**unchanged**; no new migration, no migration 0007, no SQL.

## Pre-replay inventory (from ADR-0040 and the merged code)

1. **Replay-authorization source state:** only **quarantined** (ADR-0040 §39; default safety rule).
2. **Transition into replay-authorized:** quarantined → replay-authorized (generation +1).
3. **Transition into replaying:** replay-authorized → replaying (generation +1) on claim.
4. **Transition into resolved:** replaying → resolved (existing `resolveProjectionFailure`, fromStatuses `['replaying']`).
5. **Authorization states:** active · consumed · expired · revoked.
6. **Attempt states:** started · succeeded · failed · abandoned (single started→terminal transition, trigger-enforced).
7. **Replay action vocabulary:** replay-authorized · replay-started · lease-taken-over · replay-succeeded · replay-failed · authorization-consumed · resolved.
8. **Authorization generation rule:** bound to an exact failure generation (`failure_generation`); `createReplayAuthorization` rejects a generation mismatch.
9. **Failure generation rule:** `NOT NULL DEFAULT 0`, +1 per transition; a stale expected generation is rejected.
10. **Lease fields/constraints (migration 0006, immutable via trigger):** `lease_owner`, `lease_acquired_at`, `lease_expires_at`, `started_at` — **identity + lease are immutable**; `lease_expires_at > lease_acquired_at`; a partial-unique index enforces one **live (`started`) attempt per failure**; `UNIQUE(failure_id, attempt_number)`.
11. **Authorization expiry:** `expires_at` (optional; when present must be after `created_at`); this slice requires a future expiry within 24h.
12. **Lease expiry:** `lease_expires_at`; expiry alone does not permit blind execution — takeover requires reconciliation + explicit authorization.
13. **Authorization consumption:** `consumeReplayAuthorization` (single-consume, active → consumed, records `consumed_attempt_id`).
14. **Replay-failure rule:** `completeReplayAttempt('failed', outcomeCode)`; the failure returns to a controlled state; ADR-0040 §39 `REPLAYING → back to a controlled state`.
15. **Unknown-commit rule (§45c):** never a blind duplicate replay; reconcile first.
16. **Checkpoint success mutation:** the existing `advanceCheckpointOnSuccess` **refuses a blocked checkpoint** (`status <> 'blocked'`), so replay success needs a distinct primitive.
17. **Handler transaction ownership:** the runner owns an explicit `BEGIN`/READ COMMITTED transaction and applies the handler under the name+version advisory lock; the repository primitives take a borrowed client.
18. **Advisory-lock contract:** transaction-scoped `pg_try_advisory_xact_lock`, key from **name + version only** (`projectionAdvisoryLockKeyParameter`).
19. **Divergence codes:** the closed seven-code `detectProjectionFailureDivergences`.
20. **Safe error-code vocabulary:** the five persisted diagnostic codes.
21. **Action idempotency convention:** `VARCHAR(128)` partial-unique `idempotency_key`, derived from stable identity.
22. **Actor-type vocabulary:** system · read-only-operator · failure-operator · replay-approver · administrator.
23. **Registered-handler resolution:** the canonical `ProjectionRegistry` (`registry.get(name)`, version-checked); no caller-supplied handler or event.

## Schema-support verdict (no NEEDS_CORRECTION)

The **only** gap — advancing a _blocked_ checkpoint on replay success — is closable **without any migration**:
a new checkpoint-store primitive `resumeCheckpointAfterReplay` performs the `blocked → active` UPDATE
(`last_position := blocked_position`, clear blocked state) guarded by `status='blocked' AND
blocked_position=$3 AND $3 = last_position + 1`. The immutable-lease model is honored by **abandoning** the
expired attempt and starting a fresh one on takeover (not mutating the lease). Migration 0006 fully
supports the required lifecycle; no ADR contradiction was found and no new ADR was required.
