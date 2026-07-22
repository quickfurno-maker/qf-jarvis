# Report 01 — Baseline and Pre-Operations Inventory

**Task:** QFJ-P03.07E — Failure Inspection and Quarantine Operations (implementation).
**Date:** 2026-07-22.

## Verified baseline

| Fact                          | Value                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `main` at start               | `8c040a9c82268af54665740985782cad9b2e0fef` (sync 0 0, clean)                        |
| PR #31 (QFJ-P03.07D)          | MERGED (merge commit = current main)                                                |
| Migration 0006                | present; SHA-256 `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4` |
| Migrations 0001–0005 / 0007   | 0001–0005 present & immutable; 0007 absent                                          |
| Package-root runtime surface  | 39 symbols                                                                          |
| Atomic retry exhaustion       | active (QFJ-P03.07D)                                                                |
| Overlapping P03.07E branch/PR | none                                                                                |
| Managed PostgreSQL rollout    | migration 0001 only; 0006 NOT applied / not authorized                              |

**Branch:** `qfj-p03-07e-failure-inspection-quarantine`, started from the verified main SHA.
**Migration 0006** is used unchanged this slice — **no** new migration, **no** migration 0007, **no** SQL.

## Pre-operations inventory (from the merged code)

1. **Failure statuses:** `open · acknowledged · quarantined · replay-authorized · replaying · resolved · superseded · retired` (terminal: resolved/superseded/retired).
2. **Acknowledge transition (existing repository primitive):** `open → acknowledged` (generation +1).
3. **Quarantine transition (existing repository primitive):** `open|acknowledged → quarantined` (generation +1).
4. **Failure generation:** `NOT NULL DEFAULT 0`, incremented once per repository transition; an authorization binds to an exact generation.
5. **Action types (closed):** created · acknowledged · quarantined · replay-authorized · replay-started · lease-taken-over · replay-succeeded · replay-failed · authorization-consumed · reconciled · resolved · superseded.
6. **Actor types (closed):** system · read-only-operator · failure-operator · replay-approver · administrator.
7. **Action idempotency-key rule:** `VARCHAR(128)`, partial-unique where present (`projection_failure_action_idempotency_unique`).
8. **List/read repository methods present:** `readProjectionFailureById`, `readActiveProjectionFailure(sForProjection)`, `listProjectionFailures` (offset), `readProjectionFailureActions`, `detectProjectionFailureDivergences`, `readActiveReplayAuthorization`, `readLiveReplayAttempt`.
9. **Divergence query:** `detectProjectionFailureDivergences` — the closed seven-code detector (fail-closed, no repair).
10. **Checkpoint blocked representation:** `projection_checkpoint.status='blocked'`, `blocked_position`, `failed_attempt_count=5`, `last_safe_error_code`.
11. **Attempt evidence:** `projection_attempt` rows (append-only), numbered 1..5 for the blocked position.
12. **Safe exposed diagnostic fields:** the `ProjectionFailureRow` safe shape — closed category/code/status, bounded `detail_digest`, counters, timestamps; never a payload/message/stack.
13. **Existing authorization abstractions:** **none** — this slice introduces the first (an injected authorizer contract).
14. **Pagination conventions:** `listProjectionFailures` uses offset; QFJ-P03.07E adds a **keyset** inspection list (created_at DESC, failure_id DESC) per the prompt's recommended order.
15. **Instant/identifier validators:** `assertUuid`, `assertBoundedText`, `assertValidDate`, `assertNonNegativeInteger` (persistence module).
16. **Package subpath/export conventions:** the root barrel publishes `.` + one internal worker subpath only; all projection internals are off the barrel — the new operations boundary stays internal too.

## What this slice adds

- **Repository (minimal additions):** an optional expected-generation guard on `transitionFailure`/acknowledge/quarantine; `readProjectionFailureByIdForUpdate`; `readProjectionFailureActionByIdempotencyKey`; `listProjectionFailuresKeyset`.
- **Operations boundary:** `projection-failure-operations.ts` (+ its closed error vocabulary in `projection-failure-operations-errors.ts`) — inspection, action-history, divergence inspection, and the acknowledge/quarantine mutations, all internal.

No ADR contradiction was found; no new ADR was required. The existing schema fully supports the approved inspection and quarantine operations (no `NEEDS_CORRECTION`).
