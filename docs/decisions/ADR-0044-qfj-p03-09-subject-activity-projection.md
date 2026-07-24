# ADR-0044 — QFJ-P03.09 Subject Activity Projection

**Status:** Accepted (2026-07-24) — QFJ-P03.09
**Deciders:** Owner
**Phase:** QFJ-P03.09 — Subject Activity Projection (canonical Roadmap v3.0; historical alias the deferred `rm_subject_activity`, Stage 3.6)

**Relates to:** [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md) §8–§9 (erasure-survives-rebuild; the `rm_subject_activity` reference projection) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) (payload privacy boundary) · [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7 (retention deferred to Phase 11) · [ADR-0034](./ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md) (checkpoint/attempt foundation, migration 0004) · [ADR-0036](./ADR-0036-stage-3-4-3-gap-free-projection-ordering.md) (commit-ordered positions) · [ADR-0037](./ADR-0037-stage-3-4-4-projection-runner.md) (the runner) · [ADR-0040](./ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md) (failure operations, migration 0006) · [ADR-0043](./ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md) (rebuild determinism and erasure)

**Design documents introduced:** [docs/reports/qfj-p03-09/](../reports/qfj-p03-09/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It authorizes exactly ONE new migration (**0007**), one narrow internal subject reader, one production handler, an internal rebuild digest spec, and tests. Migrations 0001–0006 are immutable; the package-root runtime API remains **exactly 39 symbols**; managed deployment remains paused.

---

## Context

QFJ-P03.08 (Rebuild Determinism and Erasure) is complete on `main` (`8a9ec8a`, PR #37). It proved rebuild determinism over the two metadata read models and proved — with a synthetic tombstone fixture — that an erasure event's _effect_ survives rebuild, and it **deferred the subject-keyed proof to QFJ-P03.09**. ADR-0022 §9 names the deferred reference projection: **`rm_subject_activity`** — per subject: event count, first/last seen, erasure state.

The subject is already present in the log: migration 0001 stores the Phase-2 EntityReference as `subject_type` + `subject_id` (NOT NULL, constrained, indexed). But the projection runtime role is **not** granted those columns (migration 0004 grants only `sequence, event_type, event_version, accepted_at`), and the metadata-only `ProjectionEvent` deliberately excludes subject (ADR-0026; `projection-definition.ts`). So a subject-keyed projection is **SCHEMA_REQUIRED**: a new read-model table plus the minimum subject-column grant.

## Decision

### 1. Subject is the existing opaque Phase-2 EntityReference

The projection keys on `(subject_type, subject_id)` exactly as migration 0001 stores and constrains them (machine-token type ≤64; opaque id ≤128, charset `[A-Za-z0-9._:-]`). It is an **opaque Core reference, not personal data** — the charset guardrail forbids free text, and Core resolves the actual contact from its own records (reference-never-reproduce, ADR-0022 §8). Subject is **required** on every event, so there is no "no-subject" case.

### 2. No global `ProjectionEvent` widening — a narrow internal reader instead

`ProjectionEvent` and `ProjectionDefinition` are **unchanged**. Widening the global event would give every current and future projection subject visibility — a least-privilege regression (ADR-0026). Instead, QFJ-P03.09 adds one **narrow internal reader**, `readSubjectReferenceAtPosition(client, position)`, that joins the position map to the event and selects **only** `subject_type, subject_id`, validates both against the canonical grammar, returns a frozen internal EntityReference, and fails closed with bounded safe codes. It is **not** exported from the package root and exposes no payload/correlation/event-id/source/signature/digest.

**Honesty about the shared DB role.** The single deployment role `qf_jarvis_projection_runtime` will hold the subject-column grant, so at the SQL layer it _can_ query those columns. Per-projection visibility is therefore enforced at the **code/module boundary**: only the subject-activity handler may import the subject reader (a restricted-import ESLint rule + tests), and the metadata projections remain subject-blind in code. A separate subject worker/runner/pool/credential is **not** introduced for the MVP.

### 3. The `rm_subject_activity` read model (migration 0007)

One new table `qf_jarvis.rm_subject_activity`, PK `(subject_type, subject_id)`, holding per subject: an activity event count, first/last activity position, first/last activity acceptance instant, the last activity event type/version, and the erasure state (`erased`, `erased_at_position`, `erased_at`). CHECK constraints mirror the 0001 subject grammar and enforce the active/tombstone shapes. It is disposable and fully rebuildable. Timestamps come from the **event** (`acceptedAt`), never a wall clock.

### 4. Erasure — a permanent minimal tombstone (owner-locked)

The projection reacts to the **existing** `qf.privacy.erasure-recorded` event contract (v1/v2 in `@qf-jarvis/contracts`; no new event contract). On erasure for a subject it writes a **minimal tombstone** (not physical deletion): `erased = true`, `erased_at_position`, `erased_at`, `activity_event_count = 0`, and every activity detail column cleared to NULL. The tombstone is **permanent** for that `(subject_type, subject_id)`: later ordinary events do **not** reactivate or repopulate activity. Reactivation would require a future explicit event contract + ADR, or a new opaque subject reference — **not** added here. A second erasure preserves the first tombstone (idempotent). An erasure before any activity creates a valid zero-count tombstone. `qf.privacy.erasure-requested` is ordinary activity until `-recorded` arrives.

This proves **technical projection erasure** and that it survives rebuild. It makes **no** claim about source-system deletion, immutable-log retention, or legal/privacy compliance — those are separated and deferred (Phase 11, ADR-0019 §7).

### 5. Ordering, runner, rebuild — unchanged machinery

Position is the only cursor (`event.sequence` stays storage identity only); one event per transaction through the **existing** runner; checkpoint + read-model write remain atomic; the **existing** worker drives the new registry entry with no `apps/worker` change; the lock-key derivation, the QFJ-P03.07 failure/retry/replay lifecycle, and the **QFJ-P03.08 rebuild driver signature are unchanged**. The rebuild driver needs no change because the handler resolves the subject internally **by position** — so the live path and the rebuild path use the same reader and reducer. QFJ-P03.08's digest utility gains an **internal** `rm_subject_activity` digest spec (all authoritative columns incl. the tombstone fields); no root export.

### 6. Migration verdict — SCHEMA_REQUIRED, migration 0007

Migration **0007** (`0007_subject_activity_projection.sql`) is the owning migration for this accepted slice. It creates only `rm_subject_activity` and grants the projection role the minimum: `SELECT(subject_type, subject_id)` on `qf_jarvis.event` and `SELECT, INSERT, UPDATE` on the new table (**no** DELETE/TRUNCATE — a version-bump rebuild destroy stays a trusted admin/test operation, per the 0004 precedent). It adds no trigger, enum, tenant column, queue, job, or audit table. It is applied **local/CI only**; managed PostgreSQL remains at migration 0001 and this migration is **not** deployed. Migrations 0001–0006 are unchanged.

### 7. API / package boundary

Owner: `@qf-jarvis/event-backbone`. **No** new package, **no** package-root export (root stays 39), **no** package-manifest/dependency change, **no** `apps/worker` change, **no** CLI/network/scheduler/queue. The new reader, handler, and digest spec are internal.

## Rejected alternatives

- **Widen the global `ProjectionEvent` with subject.** Rejected — a least-privilege regression across all projections (ADR-0026); the narrow reader achieves the same with a bounded surface.
- **Physical deletion on erasure.** Rejected by owner decision — a minimal permanent tombstone answers "has this subject been forgotten?" and keeps rebuild deterministic.
- **Post-erasure reactivation.** Rejected by owner decision — the tombstone is permanent; reactivation needs a future explicit contract.
- **A separate subject worker/runner/pool/credential.** Rejected for the MVP — unnecessary; the existing runner/worker drive it.
- **NO_MIGRATION_REQUIRED.** Rejected — a subject-keyed table and the subject grant are genuinely missing invariants.

## Consequences

**Positive.** The QFJ-P03 reference projection exists; subject-keyed erasure is proven and survives rebuild; the MVP gains a "forgotten?" / latest-activity safety signal for P04 retrieval; least privilege is preserved at the module boundary; no root-API growth, no new dependency, no worker change.

**Negative — accepted.** The shared projection role can technically read the granted subject columns (enforced by module boundary + tests, not by a second role); permanent tombstones cannot be reactivated without future work; the migration is local/CI only until a separate, still-paused managed deployment.

## Non-goals

No global `ProjectionEvent` subject field; no payload/PII exposure; no separate worker/runner/service/credential; no reactivation contract; no physical deletion of the immutable log; no legal-retention/compliance claim; no analytics dashboard; no tenant architecture; no CLI/network/scheduler/queue; no package-root expansion; no managed migration/deployment; no QFJ-P03.10 work.

## Change-control rule

Changing the subject contract, the tombstone/reactivation semantics, the migration-0007 scope, or the rebuild-driver signature requires a superseding ADR. Operational status may advance without replacing this design.
