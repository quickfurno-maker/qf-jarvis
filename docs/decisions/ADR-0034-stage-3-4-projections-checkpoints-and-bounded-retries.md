# ADR-0034 — Stage 3.4 Projections, Checkpoints and Bounded Retries

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Keshav Sharma — Founder and business owner, QuickFurno

**Relates to:** [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) (event store) · [ADR-0021](./ADR-0021-processing-retries-dead-letters-and-replay.md) (processing, retries, dead letters, replay) · [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md) (projections, ordering, rebuild determinism) · [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) (dedicated managed PostgreSQL) · [ADR-0033](./ADR-0033-stage-3-3-5-concurrency-duplicate-key-and-managed-readiness.md) (Stage 3.3.5)

> **This ADR is the implementing decision for Stage 3.4.** It builds on the accepted, immutable design of ADR-0021 and ADR-0022 and does not rewrite them; it fixes the concrete, previously-open Stage 3.4 parameters. It **concretizes ADR-0021 §2's retry count of five exactly** (a preservation, not a narrowing) and **widens ADR-0022 §9's "one reference projection" to two infrastructure-metadata projections** (a clarifying widening), stating each explicitly. Historical ADRs remain immutable.

---

## Context

ADR-0021 chose a checkpoint-driven, queue-free projection model with bounded retries and a poison event that **halts** its own projection; ADR-0022 made projections pure functions of the log in ingestion (`sequence`) order with a destroy-and-rebuild determinism guarantee. Those decisions are accepted. What remained open for implementation were the exact schema, the transaction protocol, the lock mechanism, the retry count, the initial read models, the projection role, and the export boundary. This ADR locks them for Stage 3.4. **Stage 3.4.1 (this slice) implements only the schema, the internal vocabulary, and the checkpoint/attempt repositories with their tests** — the registry, advisory lock, runner, and handlers are later Stage 3.4 slices.

## Decision

### 1. Migration — `0004_projection_foundation.sql`

The next forward-only migration is `0004_projection_foundation.sql` (the strict `NNNN_...` pattern makes 0004 the next available version; the roadmap's "0003 family" is a conceptual target, not a literal file number, and 0003 is taken). Migrations `0001`–`0003` are **byte-for-byte unchanged**. Stage 3.5's eventual migration therefore shifts to `0005`+; no roadmap renumbering is performed.

### 2. Package location — `packages/event-backbone/src/projections/`

Projections read the event log and write read models in the **same** database, using event-backbone's own pool, transaction, and READ COMMITTED primitives. They live in `packages/event-backbone/src/projections/`. ADR-0022 §4's purity constraint on handlers applies to this directory.

### 3. Processing unit — exactly one event per invocation and per transaction

A runner invocation processes **at most one event** and returns exactly one result; one event is applied per transaction. (A bounded batch is an evidence-driven optimisation to revisit later, ADR-0021 consequences.)

### 4. Advisory lock — `pg_try_advisory_xact_lock`

Each projection run takes a **non-blocking, transaction-scoped** advisory lock (`pg_try_advisory_xact_lock`) whose key is derived **deterministically from the projection name and version only** — never from an event or payload. It auto-releases at commit/rollback (it cannot leak on a crash or connection loss). A second same-projection runner that cannot acquire the lock returns **`busy`** (not a failure), records no attempt, and mutates no state. Different projections use different keys and never block each other.

### 5. Handler transaction model — one outer transaction, a SAVEPOINT around the handler

Processing runs in **one outer transaction**:

1. `BEGIN`; `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`;
2. take the advisory lock (return `busy` if not acquired);
3. read/lock the checkpoint `FOR UPDATE` (create it lazily if absent); return `blocked` if blocked; return `retry-pending` if the injected `now` is before `next_attempt_at`;
4. read exactly the next event (`sequence = last_sequence + 1`);
5. `SAVEPOINT projection_handler`; apply the handler with the **same** client.

On **handler success**: append a `succeeded` attempt, advance the checkpoint (clear failure state), `COMMIT`.

On **deterministic handler failure**: `ROLLBACK TO SAVEPOINT projection_handler` (the outer transaction stays valid), append a `failed` attempt, increment `failed_attempt_count`, set `next_attempt_at` or the `blocked` state, then `COMMIT`. The failed attempt and the retry/blocked state are recorded **before** the outer `COMMIT`, so there is no separate post-rollback bookkeeping race.

On a **database/infrastructure/invariant failure**: `ROLLBACK` the entire transaction and **throw**. The runner must not manufacture a successful result and must not claim a failed attempt was durably recorded.

This SAVEPOINT protocol is **mandatory for the runner in later slices**. Stage 3.4.1 documents it and provides the checkpoint/attempt repositories it will use; it does not implement the runner.

### 6. Retry maximum — `MAX_PROJECTION_ATTEMPTS = 5`

The retry bound is **5** (a repository constant, dependency-injectable in tests). The fifth failure **blocks** the projection. This preserves ADR-0021 §2's number exactly; it is neither environment-controlled nor a scheduler.

### 7. Backoff — bounded intent preserved, no scheduler

ADR-0021's bounded-backoff intent is preserved by a `next_attempt_at` column on the checkpoint and an **injected current time** at the runner: a call before `next_attempt_at` returns `retry-pending` **without** a new attempt. **No scheduler and no worker loop is added in Stage 3.4** (a time-driven re-attempt loop needs the worker, which is out of scope). ADR-0021 does not fix exact backoff constants; **the exact `next_attempt_at` interval constants are LOCKED in Stage 3.4.4 before the runner's retry logic is implemented**, not invented in this slice.

### 8. Blocked state — observation-only in Stage 3.4

A blocked projection halts at `last_sequence` (the event before the poison). **No event after the poison event is processed or skipped.** Stage 3.4 is **observation-only**: the block is queryable (checkpoint status + attempt rows); there is **no auto-unblock and no manual mutation command**. Repair, replay, and unblock (ADR-0021 §4–5, plus a dead-letter table and quarantine ledger) are **Stage 3.5**.

### 9. Attempt records — successes and failures

Both `succeeded` and `failed` attempts are recorded in `qf_jarvis.projection_attempt` (append-only). There is **no dead-letter outcome** here.

### 10. Initial proof projections — two, and they do not replace `rm_subject_activity`

Stage 3.4 ships two small proof projections: **`event-type-activity`** and **`daily-event-acceptance`**. They exist because the locked Stage 3.4 exit gate requires **at least two independent projections** — a single projection cannot demonstrate that a blocked projection does not stall another (isolation). They are domain-neutral, agent-free, non-authoritative, and **metadata-only** (event type/version, ingestion sequence, acceptance instant); they hold no subject, correlation id, event id, payload, or free text, so erasure survives rebuild trivially.

**This is a clarifying widening of ADR-0022 §9** ("one reference projection, and no more — `rm_subject_activity`") — from one proof projection to two. ADR-0022 §9's intent was to forbid **agent/domain/business** projections in Phase 3; two infrastructure-metadata projections honour that intent while satisfying the isolation requirement. **`rm_subject_activity` remains a later Stage 3.6 model** and is not built now; these two do not replace it.

### 11. Projection role — `qf_jarvis_projection_runtime`

A **dedicated deployment role**, `qf_jarvis_projection_runtime`, separate from the ingestion role `qf_jarvis_runtime`, receives least privilege conditionally (as 0002/0003 grant the ingestion role): `USAGE` on the schema; **column-level `SELECT`** on `qf_jarvis.event` for only `sequence, event_type, event_version, accepted_at` (no payload); `SELECT, INSERT, UPDATE` on `projection_checkpoint`; column `INSERT` + safe `SELECT` on the append-only `projection_attempt` (no `UPDATE`/`DELETE`); and `SELECT, INSERT, UPDATE` on the two read models (no `DELETE`/`TRUNCATE`). It gets **no** schema `CREATE`, no `schema_migration` access, no event `UPDATE`/`DELETE`, no audit-table content reads, and no ownership. **The ingestion role gains nothing on the projection tables.** It is a deployment artifact with **no LOGIN password in Git**.

### 12. Public API — internal in Stage 3.4.1

The Stage 3.4.1 vocabulary and repositories remain **internal**. **No root package export is added in this slice** (the event-backbone barrel and the event-ingestion 14-symbol surface are unchanged).

### 13. Managed status — unchanged

`0004` is **local/CI only**. Managed PostgreSQL remains **`0001`-only**; `0002`, `0003` and `0004` remain unapplied; **no managed readiness or authorization for `0004` is claimed**. A future managed application of `0004` requires a **new, separately-reviewed managed-readiness report** and **explicit owner authorization**, with its own preflight, checksum verification, credential rotation, backup/PITR evidence, and synthetic `BEGIN`/`SAVEPOINT`/`ROLLBACK` smoke test.

#### 13a. Operational consequence — the default migrator applies ALL pending migrations

`db:migrate` applies **every pending migration, in order**. It has **no target-version option**, and this ADR deliberately **does not add one** (no migration-runner code changes in Stage 3.4.1). Placing `0004` in the default migration directory therefore changes what a managed run would do: it would apply **`0002`, then `0003`, then `0004`** — the default command **cannot** be asked to apply only `0002`/`0003`.

Consequently, **the Stage 3.3.5 managed-readiness report's `READY_FOR_SEPARATE_OWNER_AUTHORIZED_MANAGED_RUN` execution status is superseded** as of this ADR. Its technical readiness evidence for `0002`/`0003` — checksums, preconditions, verification steps, abort conditions — **remains valid historical evidence**; only its execution authorization is revoked, and it now reads `SUPERSEDED_BLOCKED_PENDING_0004_MANAGED_READINESS`.

**No managed `pnpm db:migrate` is currently authorized.** It stays blocked until `0004` receives its own separately-reviewed managed readiness and explicit owner authorization for the full `0002`+`0003`+`0004` scope, and **both** deployment roles — `qf_jarvis_runtime` and `qf_jarvis_projection_runtime` — exist with correctly rotated credentials. **This ADR claims no managed authorization of any kind.**

## Consequences

**Positive.** The projection foundation is a single migration with strict, self-documenting invariants; the SAVEPOINT-in-one-transaction protocol removes the post-rollback bookkeeping race; the two metadata projections prove isolation with strictly better privacy than a subject-keyed model; and nothing managed or external is touched.

**Negative — accepted.** A blocked projection needs a human, and Stage 3.4 offers only observation (unblock/replay is Stage 3.5). The retry backoff has no scheduler yet (no worker in this phase). **Adding `0004` to the default migration directory widens what any future managed run would apply (§13a), superseding the Stage 3.3.5 execution status and leaving no managed migration authorized** — accepted rather than adding target-version support to the migration runner in this slice. Two clarifications of accepted ADRs are recorded here rather than by editing the historical ADRs: ADR-0021 §2's retry number of five is **preserved (concretized) exactly**, and ADR-0022 §9's "one projection" is **widened to two metadata projections**.

## Explicit exclusions

Stage 3.4 does **not** add: a dead-letter table, quarantine ledger, or replay/unblock command (Stage 3.5); an HTTP endpoint, `apps/api`, worker loop, or `apps/worker` change; a live emitter, agent, model, or external integration; a new public runtime export in this slice; a PostgreSQL enum (statuses/outcomes are CHECK-constrained TEXT); any change to migrations `0001`–`0003`; and any Supabase, managed-database, Core, n8n, WhatsApp, or provider access. Managed PostgreSQL still carries only `0001`.
