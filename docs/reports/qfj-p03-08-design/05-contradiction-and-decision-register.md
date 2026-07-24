# Report 05 — Contradiction and Decision Register

**Date:** 2026-07-24. **Slice:** QFJ-P03.08. **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

## Contradiction / staleness register

| #   | Both sides                                                                                                                                                                                                      | Class                                      | Canonical source                                                | Blocks implementation? | Resolution (no edit to historical docs)                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| C-1 | ADR-0022 §1/§3 say live and rebuild "traverse **sequence** order"; the current cursor is the gap-free **position** map                                                                                          | stale document / naming alias (superseded) | ADR-0036 + migration 0005 + `readEventAtPosition`               | No                     | ADR-0043 §B records the supersession; ADR-0022 §1/§3 "sequence" reads as "position" post-0036 |
| C-2 | ADR-0022 §9 says Phase 3 creates exactly one reference projection, `rm_subject_activity`; the build created two metadata proof projections and deferred `rm_subject_activity`                                   | superseded scope / historical alias        | ADR-0034 §10 + Roadmap v3.0 (P03.09 owns `rm_subject_activity`) | No                     | ADR-0043 §I / §H record the P03.08↔P03.09 split                                               |
| C-3 | ADR-0022 §6 "version bump ⇒ destroy and rebuild" implies coexistence is unnecessary, yet a no-downtime live-vs-rebuild comparison needs a parallel target the read-model tables cannot hold (no version column) | ambiguous design gap (resolved by scoping) | ADR-0043 §D / §H                                                | No                     | Bounded proof = in-place/ephemeral; production coexistence deferred (Model 3/4)               |
| C-4 | ADR-0022 §4 claims projection purity is linted; `eslint.config.mjs` scopes purity only to `contracts` + `event-ingestion`, not projections; no rebuild test exists yet                                          | implementation gap / stale ADR claim       | `eslint.config.mjs` (actual config)                             | No                     | ADR-0043 §J: the implementation adds the projections purity lint                              |
| C-5 | Migration 0004 header comment calls `last_position` "the highest event **sequence** fully applied"; the column was renamed to `last_position` by 0005                                                           | stale in-file comment (naming)             | 0005 + `checkpoint-store.ts`                                    | No                     | Note only; no historical migration edit                                                       |

No **real architectural contradiction** blocks QFJ-P03.08. Every item is stale-doc / naming-alias / implementation-gap with a clear canonical source, resolved in ADR-0043 and these reports rather than by rewriting historical documents.

## Owner decisions vs engineering decisions

**True owner decisions (not settled here):**

- Whether a future **production** rebuild must be zero-downtime shadow/cutover (Model 3/4) — an operational-topology decision that would require a separately-designed schema change. Not needed for QFJ-P03.08.
- Whether to widen the projection handler contract with an opaque **subject** reference — a QFJ-P03.09 (`rm_subject_activity`) decision under its own ADR; flagged so it is not made implicitly here.

**Engineering decisions (settled by ADRs/invariants):**

- Position map is the rebuild cursor (ADR-0036).
- SHA-256 canonical-digest equality is the determinism contract (ADR-0022 §7).
- Version bump ⇒ destroy-and-rebuild (ADR-0022 §6).
- Reducers pure; timestamps from events (ADR-0022 §4).
- Reference-never-reproduce underpins erasure (ADR-0022 §8 / Phase 2).
- Rebuild reuses the pure `apply`, not the failure-recording runner (narrowest model).

## Deferred production-rebuild decisions

- Production shadow/cutover rebuild, durable/restartable rebuild jobs, persisted rebuild status, and any production operator surface — all deferred; each would require separate owner authorization and possibly a separately designed schema change (no migration 0007 is reserved).
- Legal retention / deletion SLA — deferred to Phase 11 (ADR-0019 §7).
- Alert delivery / metrics export — deferred (QFJ-P03.07G E8).
