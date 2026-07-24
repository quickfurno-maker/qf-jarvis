# Report 05 — Exit-Readiness and Non-Goal Audit

**Date:** 2026-07-24. **Slice:** QFJ-P03.08. **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

> QFJ-P03.08 is IMPLEMENTED ON A FEATURE BRANCH / DRAFT PR. It is **not** complete and **not** merged; merge is separately authorized after owner review.

## Acceptance criteria (ADR-0043 §18 / prompt §8)

| #   | Criterion                                                     | Status                                                     |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | ADR-0043 implemented without contradiction                    | **PASS**                                                   |
| 2   | Rebuild input uses positions only (never `Event.sequence`)    | **PASS** (reader + driver)                                 |
| 3   | Fixed-horizon behaviour proven                                | **PASS** (unit + integration)                              |
| 4   | Live/rebuild digest equality for both metadata read models    | **PASS** (integration)                                     |
| 5   | Synthetic erasure effect survives rebuild                     | **PASS** (integration)                                     |
| 6   | Rebuild does not mutate live checkpoint/attempt/failure state | **PASS** (integration, rollback + committed)               |
| 7   | Reducer purity mechanically enforced                          | **PASS** (lint block + test)                               |
| 8   | No source path outside the bounded implementation changed     | **PASS** (containment)                                     |
| 9   | No migration/schema change                                    | **PASS**                                                   |
| 10  | Migration 0007 absent/unreserved                              | **PASS**                                                   |
| 11  | Migrations 0001–0006 exact                                    | **PASS**                                                   |
| 12  | Root API remains 39                                           | **PASS**                                                   |
| 13  | No worker/CLI/scheduler/network/operator surface              | **PASS**                                                   |
| 14  | No subject/payload widening                                   | **PASS**                                                   |
| 15  | No managed access/deployment                                  | **PASS**                                                   |
| 16  | Unit tests pass                                               | **PASS** (2692/70)                                         |
| 17  | Real PostgreSQL integration tests pass                        | **PASS locally** (396/21); CI is the merge-gating evidence |
| 18  | Lint/typecheck/build/dist containment pass                    | **PASS**                                                   |
| 19  | Implementation reports complete                               | **PASS** (this set)                                        |
| 20  | Draft PR green on its exact head                              | recorded in the external report once CI completes          |
| 21  | PR remains unmerged                                           | **PASS** (draft)                                           |

## Non-goal audit — none breached

No `rm_subject_activity`; no subject/payload widening; no new business/domain projection; no production rebuild/cutover; no shadow tables / versioned parallel storage; no durable/restartable rebuild jobs or persisted status; no scheduler/daemon/queue; no worker mode; no CLI/network API; no mutating production operator surface; no QFJ-P03.07 correctness change; no managed/local-production DB access; no migration; no migration 0007; no root-API expansion; no package-manifest/dependency change; no retention/deletion-SLA decision; no performance/parallelism project.

## Contradiction/decision follow-through (from the design register)

- **ADR-0022 §4 purity-lint gap (C-4):** CLOSED — a projections-`handlers`-scoped purity rule now forbids the clock, `new Date()`, randomness, environment, and network/filesystem/process/crypto I/O in reducers, with a test proving it catches an intentional violation.
- **ADR-0022 "sequence"→"position" (C-1)** and **§9 one-reference-projection vs the P03.08/P03.09 split (C-2):** honoured in code — the cursor is `position`; `rm_subject_activity` is not implemented here.
- The remaining stale-doc notes are documentation-only and out of scope for this implementation.

## Risks and rollback

- **Determinism subtlety** — mitigated by the purity lint, the single canonicaliser, server-side rendering of DATE/TIMESTAMPTZ, and an explicit unsupported-value failure; proven by real-PostgreSQL `A === B`.
- **Rollback/containment** — library-only + test-only; no runtime wiring, no schema, no managed access, no root export. Reverting the branch removes the feature entirely; the live projection path is untouched.

## Managed lane

Managed PostgreSQL remains at migration 0001; 0002–0006 unapplied; password rotation and managed migration lanes remain paused; no deployment. This slice is local/CI only.

## Readiness

Ready for **owner review of the draft PR**. Merge is separately authorized. The next slice, **QFJ-P03.09 — Subject Activity Projection**, introduces the opaque subject reference and the subject-keyed erasure proof under its own decision.
