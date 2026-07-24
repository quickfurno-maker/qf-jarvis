# Report 02 — Rebuild Design Contract

**Date:** 2026-07-24. **Slice:** QFJ-P03.08. **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

## Cursor and horizon

- **Authoritative input:** the gap-free projection **position map** (`qf_jarvis.projection_event_position`), read through the existing `readEventAtPosition`.
- **Cursor:** `projection_event_position.position`. `event.sequence` is storage identity only and never determines rebuild order (ADR-0036 supersedes ADR-0022 §1/§3 "sequence-order" wording).
- **Order:** contiguous, ascending, one position at a time.
- **Range:** `[1 .. horizon]`.
- **Horizon:** `MAX(position)` captured **once** at rebuild start. Dense, commit-ordered positions make `[1..horizon]` a stable prefix; later commits get positions `> horizon` and are excluded from that run.
- **No ingestion lock** is required to define the stable prefix; the bounded proof runs against a **quiescent local/CI fixture database**.

## Event privacy boundary

The driver consumes only the metadata-only `ProjectionEvent`: `position`, `eventType`, `eventVersion`, `acceptedAt`. It must not receive or expose payload, subject, correlation/causation ids, event id, source, signature, digest, or personal data. **`ProjectionEvent` is not widened in QFJ-P03.08** (preserves ADR-0026 and reference-never-reproduce).

## Isolation model (approved for the bounded proof)

- **Model 1 — in-place destroy-and-rebuild** (ADR-0022 §7), inside a disposable/local-CI context or a rollback-contained test transaction: digest live → destroy/reset isolated derived state via trusted test/admin capability → rebuild `[1..horizon]` → digest rebuilt → compare.
- **Model 2 — ephemeral test-only target**: a disposable target for non-destructive comparison; no production migration or durable schema object.

**Deferred / rejected from QFJ-P03.08:** production shadow-table rebuild; zero-downtime cutover; parallel versioned read-model storage; durable/restartable rebuild jobs; persisted rebuild status; production operator rebuild; production concurrency. These would need separate owner approval and may require a separately designed schema change.

**Schema facts that justify "no schema":** the read-model tables carry no `projection_version` column (single-version), and the projection runtime role holds no `DELETE`/`TRUNCATE` — "a version-bump rebuild is a trusted admin operation, not a runtime grant" (migration 0004). Model 1/2 respect both and need no schema.

## Checkpoint and failure separation

- Rebuild must not reuse or mutate the live projection checkpoint; a one-shot **in-memory** cursor suffices; no durable rebuild cursor is required.
- Rebuild must not invoke `runProjectionOnce`. It reuses only the position-ordered reader, the frozen registry/definition, the pure `apply`, and an isolated target.
- Rebuild must not create or mutate checkpoints, attempts, failure aggregates, action-ledger rows, quarantine state, or replay authorizations.
- A handler or infrastructure failure **aborts** the rebuild proof (fail closed); no retry/backoff/block.
- The QFJ-P03.07 retry/backoff/block/quarantine/replay machinery remains authoritative for the **live** runtime and is not reused as the rebuild lifecycle.

## Concurrency

- Single-threaded; one position at a time in ascending order.
- Production live-worker/rebuild concurrency: out of scope and prohibited.
- Multiple rebuilds of the same target: prohibited.
- A future rebuild-scoped advisory key may be used; the live runner's name+version lock contract must not change.
- Parallel rebuild: non-goal.

## Operator surface

Smallest surface: an **internal library-only rebuild driver** plus a test harness. No package-root export, no CLI, no worker mode, no scheduler, no daemon, no queue, no network API, no production job. `apps/worker` is unchanged.

## Migration verdict

**NO_MIGRATION_REQUIRED.** Input uses the existing position map; the cursor is in-memory; isolation uses controlled existing/ephemeral targets; comparison is an application-level canonical digest; no durable rebuild status is needed. Migrations 0001–0006 remain immutable; **migration 0007 remains absent and unreserved**; no prose allocates it.
