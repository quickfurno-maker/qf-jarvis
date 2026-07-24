# ADR-0043 — QFJ-P03.08 Rebuild Determinism and Erasure

**Status:** Accepted (2026-07-24, design/planning only — no runtime implementation) — QFJ-P03.08A
**Deciders:** Owner
**Phase:** QFJ-P03.08 — Rebuild Determinism and Erasure (canonical Roadmap v3.0; historical alias Stage 3.4.5C controlled rebuild + Stage 3.6)

**Relates to:** [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md) (ordering, rebuild determinism — the originating architecture) · [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7 (retention/erasure decision deferred to Phase 11) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) (payload privacy boundary) · [ADR-0034](./ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md) (checkpoint/attempt foundation, migration 0004) · [ADR-0036](./ADR-0036-stage-3-4-3-gap-free-projection-ordering.md) (commit-ordered positions, migration 0005 — the rebuild cursor) · [ADR-0037](./ADR-0037-stage-3-4-4-projection-runner.md) (the one-event runner) · [ADR-0038](./ADR-0038-stage-3-4-5a-projection-worker.md) (the worker) · [ADR-0039](./ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md) (canonical roadmap, migration-allocation rule) · [ADR-0040](./ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md) (QFJ-P03.07 failure operations, migration 0006)

**Design documents introduced:** [docs/reports/qfj-p03-08-design/](../reports/qfj-p03-08-design/) (reports 01–05)

> **This ADR designs QFJ-P03.08 and decides the migration question (NO_MIGRATION_REQUIRED). It implements nothing.** No migration, no SQL, no source, no test, no lint rule, no operator tooling. Migration 0007 remains **absent and unreserved**. The package-root runtime API remains at **exactly 39 symbols**.

---

## Context

QFJ-P03.07 (Projection Failure Operations) is complete in the repository (A–G, PR #35 merged, `main` at `31d77c247f1201461b9567673f44a4d0c5738e92`). The major phase QFJ-P03 is **not** complete: QFJ-P03.08, QFJ-P03.09, and QFJ-P03.10 remain, and QFJ-P04 is gated on all of QFJ-P03.

QFJ-P03's hardest exit criterion, stated by [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md), is one sentence: **read models can be destroyed and rebuilt from the event history with identical results, and an erasure survives that rebuild.** ADR-0022 settled the *architecture* of that property in 2026-07-12; it did not build the rebuild driver, and — as the QFJ-P03.08 readiness audit established — the repository today contains **no rebuild driver, no digest utility, no rebuild-determinism test, and no projections-scoped purity lint.**

ADR-0022 predates the position map. Since ADR-0022 was accepted, [ADR-0036](./ADR-0036-stage-3-4-3-gap-free-projection-ordering.md) and migration 0005 introduced the gap-free, commit-ordered **projection position** (`qf_jarvis.projection_event_position.position`) as the live/rebuild cursor and renamed the projection-owned `sequence` vocabulary to `position`. This ADR reconciles that evolution and locks the bounded QFJ-P03.08 design so a separately authorized implementation can proceed against a fixed contract.

## Problem statement

Turn ADR-0022's rebuild guarantee from an aspiration into a bounded, mechanically-proven, local/CI-only capability — **without** widening the projection privacy boundary, **without** a schema change, **without** touching the live QFJ-P03.07 failure/retry/replay lifecycle, and **without** growing the package-root API — while honestly separating what QFJ-P03.08 proves (the rebuild machinery and the structural erasure property) from what QFJ-P03.09 owns (the subject-keyed `rm_subject_activity` read model).

## Decision (design)

### A. Slice purpose

QFJ-P03.08 delivers a **bounded, local/CI-only** proof that projection read models can be rebuilt **deterministically** from the immutable event history, and that an **erasure event's effect survives** a complete rebuild. It delivers an **internal, library-only** rebuild driver plus tests. **It does not deliver a production rebuild service.**

### B. Authoritative input and order

- The rebuild input is the existing gap-free **projection position map** (`qf_jarvis.projection_event_position`), read through the existing `readEventAtPosition`.
- The cursor is `projection_event_position.position`. **`event.sequence` is storage identity only and must never determine rebuild order.**
- The driver reads positions **contiguously in ascending order**, one at a time.
- The rebuild range is **[1 .. horizon]**.
- **Horizon = MAX(position)** captured **once** at rebuild start. Because positions are dense and commit-ordered (ADR-0036), [1..horizon] is a stable contiguous prefix; events committed after the captured horizon receive positions > horizon and are **excluded** from that run.
- No ingestion lock is required to define the stable prefix. The bounded proof itself runs against a **quiescent local/CI fixture database**.

This ADR records that **ADR-0036 and migration 0005 supersede ADR-0022 §1/§3's "sequence-order" wording** for projection/rebuild cursor semantics. Where ADR-0022 says "traverse `sequence` order," read "traverse `position` order."

### C. Event privacy boundary (unchanged, reaffirmed)

The rebuild driver consumes only the current metadata-only `ProjectionEvent`: `position`, `eventType`, `eventVersion`, `acceptedAt`. It must **not** receive or expose payload, subject, correlation/causation identifiers, event id, source, signature, digest, or any personal/customer data. **QFJ-P03.08 must not widen `ProjectionEvent`.** This preserves [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) and the reference-never-reproduce property that makes erasure-survives-rebuild free (ADR-0022 §8).

### D. Isolation model

Approved for the bounded proof:

- **Model 1 — controlled in-place destroy-and-rebuild** (ADR-0022 §7), only inside a disposable/local/CI context or a rollback-contained test transaction: derive the live digest → destroy/reset the isolated derived state using trusted test/admin capability → rebuild from position 1 through the fixed horizon → derive the rebuilt digest → compare.
- **Model 2 — ephemeral test-only target**: a disposable target used to compare rebuilt state without modifying the first result; no production migration or durable schema object.

Explicitly **deferred and rejected from QFJ-P03.08**: production shadow-table rebuild; zero-downtime cutover; parallel versioned read-model storage; durable/restartable rebuild jobs; persisted rebuild status; production operator rebuild; production concurrency. Those future models would need **separate owner approval** and may require a **separately designed schema change** — they are not authorized here and do not allocate migration 0007.

The read-model tables (`rm_event_type_activity`, `rm_daily_event_acceptance`) carry no `projection_version` column, and the projection runtime role holds no `DELETE`/`TRUNCATE` (migration 0004 — "a version-bump rebuild is a trusted admin operation, not a runtime grant"). Model 1/2 respect both facts and need no schema.

### E. Checkpoint and failure isolation

- Rebuild must **not** reuse or mutate the live projection checkpoint.
- A one-shot **in-memory** rebuild cursor is sufficient; no durable rebuild cursor is required.
- Rebuild must **not** invoke the full live `runProjectionOnce` path. It reuses only: the position-ordered reader; the frozen projection definition/registry; the pure `apply` handler; and an isolated target.
- Rebuild must **not** create or mutate projection checkpoints, projection attempts, projection failure aggregates, action-ledger rows, quarantine state, or replay authorizations.
- A handler or infrastructure failure **aborts the rebuild proof** (fail closed); it does not enter the retry/backoff/block lifecycle.
- The QFJ-P03.07 retry/backoff/block/quarantine/replay machinery remains **authoritative for the live runtime** and is not reused as the rebuild lifecycle.

### F. Concurrency and locking

- Rebuild is **single-threaded**; positions are applied one at a time in ascending order.
- Production live-worker/rebuild concurrency is **out of scope and prohibited**.
- Multiple rebuilds of the same target are **prohibited**.
- The future implementation may use a **rebuild-scoped advisory key**; it must **not** change or reuse the live runner's name+version lock key in a way that alters the established lock contract.
- Parallel-rebuild optimization is a **non-goal**.

### G. Deterministic equivalence contract

Define **`live result == rebuilt result`** as **identical SHA-256 digests** of a **canonical serialization** of all authoritative read-model rows. Canonicalization requires:

- `SELECT` all rows; **order by the complete primary key ascending**;
- include **every** authoritative read-model column; exclude **no** current read-model column;
- stable object/key ordering; **BIGINT** as canonical base-10 strings; **TIMESTAMPTZ** as canonical UTC ISO-8601; **DATE** as `YYYY-MM-DD`; explicit null encoding if ever applicable;
- **no** environment, random, process, clock, locale, or physical-page values;
- concatenate rows deterministically; compute SHA-256.

The contract is **semantic/canonical row equality**, not physical PostgreSQL page or binary-storage equality. **Core acceptance evidence must be a real PostgreSQL integration test**, not only a fake/in-memory test.

### H. Projection versioning

`(projection_name, projection_version)` already namespaces checkpoints and live advisory locks. A version bump can create a fresh checkpoint namespace. The current read-model tables do **not** include `projection_version`, so two versions cannot coexist in those tables without schema. **QFJ-P03.08 therefore proves destroy-and-rebuild, not parallel version cutover.** Old/new concurrent queryability is deferred. Registry rules and package-root exports do not change.

### I. Erasure-survives-rebuild

Approved **bounded structural proof**: use synthetic, domain-neutral events only, including a synthetic tombstone/erasure event type; the synthetic handler clears its synthetic derived state; prove the same final erased digest after a full rebuild; no real or realistic personal data; no real subject identifiers; no payload access; no external rehydration source; diagnostics use closed safe codes and reveal no erased state.

Explicitly **deferred to QFJ-P03.09**: `rm_subject_activity`; any opaque subject-reference contract expansion; subject-keyed erasure-state representation; subject-specific acceptance proof. **QFJ-P03.08 proves the erasure effect structurally; QFJ-P03.09 owns the subject-keyed proof.** This ADR does **not** define production legal retention or a deletion SLA ([ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7 → Phase 11).

### J. Purity-lint gap

Recorded verified gap: ADR-0022 §4 states projection reducer purity is mechanically linted, but the current `eslint.config.mjs` applies purity rules only to `packages/contracts` and `packages/event-ingestion` — **not** to the projections directory, and the byte-equal rebuild test that would otherwise catch impurity does not yet exist. **Decision:** the QFJ-P03.08 implementation must close this gap by adding a projections-scoped purity lint (or an equivalent mechanically-enforced rule) and prove the guard works, including a negative fixture or equivalent red test where practical. **This documentation task does not modify `eslint.config.mjs`.**

### K. Migration verdict — **NO_MIGRATION_REQUIRED**

Proof: the input uses migration 0005's existing position map; the cursor is in-memory; isolation uses controlled existing/ephemeral targets; comparison is an application-level canonical digest; no durable rebuild status is needed; production shadow/cutover is out of scope.

Migrations **0001–0006 are immutable**. **Migration 0007 remains absent and unreserved.** No roadmap/ADR prose allocates migration 0007 (Roadmap v3.0 permanent rule). Any future schema-bearing production rebuild requires separate design, necessity proof, owner authorization, and managed-impact analysis.

### L. Package / API / operator surface

- Owner: `@qf-jarvis/event-backbone`, projections subsystem. **No new package.** No `apps/worker` runtime wiring. **No root export; the package-root runtime API remains exactly 39 symbols.** No package-manifest change expected. No executable script required. No CLI, network API, scheduler, daemon, queue, exporter, or production job. The future implementation is an **internal library-only driver plus tests**.

### M. Non-goals

No QFJ-P03.09 `rm_subject_activity`; no subject field addition; no payload widening; no new business/domain projection; no production rebuild/cutover; no shadow/version schema; no restartable durable jobs; no scheduler/daemon/queue; no worker mode; no mutating production CLI; no QFJ-P03.07 correctness changes; no managed access/deployment; no migration; no root-API expansion; no retention-policy decision; no performance/parallelism project.

## Rejected alternatives

- **Rebuild by `event.sequence`.** Rejected — ADR-0036 makes `position` the cursor; ordering by raw sequence would leak storage identity into the rebuild contract and diverge from live.
- **Shadow-table / parallel-version rebuild in QFJ-P03.08.** Rejected as out of scope — needs schema (no version column; no runtime `DELETE`) and production-topology decisions the bounded proof does not require. Deferred to a separately authorized, owner-approved slice.
- **Drive the live `runProjectionOnce` for rebuild.** Rejected — it would write attempt/failure rows into the shared QFJ-P03.07 tables and entangle rebuild with the live retry/quarantine lifecycle. Rebuild reuses only the pure `apply`.
- **Add an opaque `subject` to `ProjectionEvent` now.** Rejected for QFJ-P03.08 — it widens the privacy boundary (ADR-0026) and belongs to QFJ-P03.09's `rm_subject_activity` under its own decision.
- **Choose SCHEMA_REQUIRED for convenience/observability.** Rejected — the bounded proof is provably schema-free (§K).
- **Physical/byte equality of stored pages.** Rejected — the correct target is canonical semantic row equality (§G).

## Consequences

**Positive.** The rebuild guarantee becomes a bounded, real-PostgreSQL test rather than an aspiration; erasure-survives-rebuild is proven structurally with synthetic data; the live QFJ-P03.07 lifecycle is untouched; no schema, no migration 0007, no root-API growth; the ADR-0022 §4 purity-lint gap is scheduled to close.

**Negative — accepted.** QFJ-P03.08 proves determinism only over the two existing metadata read models; the subject-keyed erasure proof waits for QFJ-P03.09. Production zero-downtime rebuild (shadow/cutover) is explicitly deferred and, if ever pursued, may require a separately designed schema change.

## Implementation slices

QFJ-P03.08 is a single bounded implementation slice (a library-only rebuild driver + digest utility + synthetic erasure fixture + unit and real-PostgreSQL integration tests + the projections purity lint + reports), separately authorized **after** this design is accepted. It adds no migration and no root export. QFJ-P03.09 (Subject Activity Projection) follows and owns the subject contract.

## Change-control rule

This ADR is design only; it changes no runtime behaviour and allocates no migration number. Implementation is a separate authorization. Changing the position cursor, the digest equivalence contract, the isolation model, the privacy boundary, or the migration verdict requires a superseding ADR. Operational status may advance (a slice implemented, a test added) without replacing this design.
