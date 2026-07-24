# Report 03 — Erasure and Privacy Proof

**Date:** 2026-07-24. **Slice:** QFJ-P03.08. **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

## The property proven

An erasure event's **effect survives a full rebuild**: because an erasure/tombstone event is itself an event in the log, a rebuild replays it in position order and reaches the identical erased final state (ADR-0022 §8). QFJ-P03.08 proves this **structurally** with a synthetic, domain-neutral projection — the subject-keyed `rm_subject_activity` proof is **QFJ-P03.09**, under its own decision.

## How it is proven (`projection-rebuild.integration.test.ts`, real PostgreSQL)

- A synthetic, domain-neutral reducer counts events per **event type** into an **ephemeral test-only table** (`rm_p0308_synthetic_activity`, created and dropped inside the test transaction — Model 2), and treats the tombstone event type `qf.privacy.erasure-recorded` as **clearing** all derived state.
- Fixture stream (synthetic events only): two events, then the tombstone, then two more events. Applying `[1..horizon]` once ("live") leaves only the two post-erasure events; the pre-erasure rows are gone.
- Destroy-and-rebuild from position 1 replays the tombstone in order and reaches the **identical** erased digest. `expect(rebuiltDigest).toBe(liveDigest)` passes.

## Privacy boundary — verified intact

- **`ProjectionEvent` is not widened.** The reducer receives only `{position, eventType, eventVersion, acceptedAt}`; no subject, payload, correlation/causation id, event id, source, signature, or digest.
- **No real or realistic personal data** in any fixture: synthetic event types, positions, and instants only; no real subject/customer identifier; `subjectId` on seed records is a synthetic opaque token (`CORE-CLIENT-1`) never read by a reducer.
- **Reference-never-reproduce** holds: the reducer can reach no external source to rehydrate erased data (it is a pure function of the metadata event + its borrowed target); reducer purity is now mechanically enforced (report 04).
- **Diagnostics stay closed and bounded:** a rebuild aborts with a closed `ProjectionRebuildError` code and a fixed message; no payload/subject/message/stack/cause/SQL/URI/secret is emitted. The digest utility never logs row content, and a hostile reducer error's original text is discarded (proven by a unit test).

## Explicitly deferred

- `rm_subject_activity`, any opaque subject-reference contract expansion, and subject-keyed erasure-state representation → **QFJ-P03.09**.
- Production legal retention / deletion SLA → Phase 11 (ADR-0019 §7). This slice makes **no** production-deletion-compliance claim.
