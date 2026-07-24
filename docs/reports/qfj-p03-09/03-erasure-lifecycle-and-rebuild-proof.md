# Report 03 — Erasure Lifecycle and Rebuild Proof

**Date:** 2026-07-24. **Slice:** QFJ-P03.09. **ADR:** [ADR-0044](../../decisions/ADR-0044-qfj-p03-09-subject-activity-projection.md).

## Erasure lifecycle (owner-locked)

The projection reacts to the **existing** `qf.privacy.erasure-recorded` contract (`@qf-jarvis/contracts`; no new event contract). On erasure for a subject it writes a **permanent minimal tombstone**: `erased = true`, `erased_at_position`, `erased_at`, `activity_event_count = 0`, all activity-detail columns cleared to NULL. Determinism: every write is projection-position-guarded (`WHERE NOT rm.erased` for erasure; `WHERE NOT rm.erased AND EXCLUDED.last_activity_position > rm.last_activity_position` for activity), so a re-presented event is a no-op.

Proven against real PostgreSQL (`subject-activity.integration.test.ts`):

- **Ordinary activity** accumulates count, advances last fields, keeps first fields stable, and namespaces by `subject_type` (same `subject_id` under a different type is a distinct row).
- **Erasure after activity** clears the activity fields and records `erased_at_position`; a later ordinary event for that subject does **not** reactivate (permanent tombstone).
- **Erasure before any activity** creates a valid zero-count tombstone; a subsequent ordinary event is ignored.
- **Repeated erasure** preserves the first tombstone (`erased_at_position` unchanged).
- **Isolation:** erasing one subject leaves another subject's active row untouched.

## Rebuild determinism including erased state

The QFJ-P03.08 rebuild driver and digest utility are reused unchanged; the handler resolves the subject internally by position, so the live and rebuild paths use the same reader and reducer. A new **internal** `SUBJECT_ACTIVITY_DIGEST_SPEC` includes every authoritative column, including the tombstone fields (`erased` rendered to canonical `'true'/'false'` text server-side; the two `TIMESTAMPTZ` columns via the canonical UTC projection).

Proven (`subject-activity.integration.test.ts`): with a fixture containing an erased subject and an active subject, the **live digest equals a full destroy-and-rebuild digest**, and the rebuilt tombstone is intact — **pre-erasure activity does not resurrect** (a from-scratch rebuild replays the erasure in position order and re-reaches the same erased final state, ADR-0022 §8). A rollback-contained rebuild leaves the live checkpoint unchanged (rebuild does not mutate P03.07 state).

## Separation of concerns — no legal claim

This proves **technical projection erasure** and that it survives rebuild. It makes **no** claim about source-system deletion, immutable-log retention, or legal/privacy compliance. Those are separated and deferred to Phase 11 (ADR-0019 §7). Reactivation of an erased subject would require a future explicit event contract + ADR, or a new opaque subject reference — not added here.
