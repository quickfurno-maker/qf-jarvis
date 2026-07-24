# Report 05 — Exit-Readiness and Non-Goal Audit

**Date:** 2026-07-24. **Slice:** QFJ-P03.09. **ADR:** [ADR-0044](../../decisions/ADR-0044-qfj-p03-09-subject-activity-projection.md).

> QFJ-P03.09 is IMPLEMENTED ON A FEATURE BRANCH / DRAFT PR. Not complete, not merged; merge is separately authorized after owner review.

## Acceptance criteria

| #   | Criterion                                                                    | Status                               |
| --- | ---------------------------------------------------------------------------- | ------------------------------------ |
| 1   | ADR-0044 committed first; implemented without contradiction                  | **PASS**                             |
| 2   | Subject = existing opaque EntityReference `(subject_type, subject_id)`       | **PASS**                             |
| 3   | No global `ProjectionEvent` widening; narrow internal reader                 | **PASS**                             |
| 4   | Metadata reducers remain subject-blind (module boundary)                     | **PASS** (lint + test)               |
| 5   | Permanent minimal tombstone; no reactivation                                 | **PASS** (integration)               |
| 6   | Erasure-recorded contract reused (no new event contract)                     | **PASS**                             |
| 7   | Position ordering only; runner/checkpoint/failure lifecycle unchanged        | **PASS**                             |
| 8   | QFJ-P03.08 rebuild driver signature unchanged; digest spec added internally  | **PASS**                             |
| 9   | Rebuild digest equality incl. erased state; pre-erasure no resurrection      | **PASS** (integration)               |
| 10  | SCHEMA_REQUIRED → migration 0007 (table + minimum grant, no DELETE/TRUNCATE) | **PASS**                             |
| 11  | Migrations 0001–0006 unchanged; no other role grant changed                  | **PASS**                             |
| 12  | Root API remains 39; barrel unchanged; no package-manifest change            | **PASS**                             |
| 13  | No worker/CLI/network/scheduler/queue; existing worker drives the new entry  | **PASS**                             |
| 14  | Least-privilege grant proven (subject readable, payload denied)              | **PASS** (integration)               |
| 15  | No managed access/deployment                                                 | **PASS**                             |
| 16  | Unit + real-PostgreSQL integration pass; lint/typecheck/build/dist pass      | **PASS locally**; CI is merge-gating |
| 17  | Reports complete; PR remains draft/unmerged                                  | **PASS**                             |

## Non-goal audit — none breached

No global `ProjectionEvent` subject field; no payload/PII exposure; no separate worker/runner/service/credential; no reactivation contract; no physical deletion of the immutable log; no legal-retention/compliance claim; no analytics dashboard; no tenant architecture; no CLI/network/scheduler/queue; no package-root expansion; no managed migration/deployment; no QFJ-P03.10 work.

## Owner decisions honoured

Erasure = minimal permanent tombstone (not deletion); post-erasure events do not reactivate; no global `ProjectionEvent` widening; SCHEMA_REQUIRED accepted → migration 0007 created after verifying 0007 absent/unreserved. Managed deployment remains paused.

## Risks and rollback

- **Determinism**: reducer purity is mechanically enforced; every write is position-guarded; the digest includes the erased state and is proven equal live-vs-rebuild.
- **Shared-role visibility**: the projection role can technically read the granted subject columns; per-projection visibility is enforced by the module boundary + tests (documented honestly in ADR-0044).
- **Rollback/containment**: additive (one migration, two source files, one digest spec, one eslint block); the barrel, the global event contract, and the rebuild driver signature are untouched. Reverting the branch removes the feature; the existing projection paths are unaffected.

## Managed lane and next

Managed PostgreSQL remains at 0001; 0002–0007 unapplied and not deployed; managed migration + password-rotation lanes remain paused. After owner review and merge, **QFJ-P03 has one remaining slice — QFJ-P03.10 (Operational Readiness and Exit Audit)** — before QFJ-P04 (Model Gateway) is unblocked.
