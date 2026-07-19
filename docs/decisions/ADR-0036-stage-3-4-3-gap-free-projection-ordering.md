# ADR-0036 — Stage 3.4.3: gap-free, commit-ordered projection ordering

**Status:** Accepted (2026-07-19, under the owner's standing Stage 3.4 authorization)
**Deciders:** Owner
**Phase:** 3 — Stage 3.4.3 (ordering-foundation prerequisite; the runner itself is a later slice)

**Relates to:** [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) (event store) · [ADR-0021](./ADR-0021-processing-retries-dead-letters-and-replay.md) (processing, retries, replay) · [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md) (projection ordering, rebuild determinism) · [ADR-0034](./ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md) (Stage 3.4.1 checkpoints) · [ADR-0035](./ADR-0035-stage-3-4-2-projection-registry.md) (Stage 3.4.2 registry)

---

## Context

Stage 3.4.1 (ADR-0034 §3 step 4) and the checkpoint repository require the runner to read **exactly
the next event** with `sequence = last_sequence + 1`, and every checkpoint transition (advance,
retry-pending, blocked) is guarded by `= last_sequence + 1`. That contract assumes the event cursor is
**contiguous, gap-free, and commit-ordered**.

The Stage 3.4.3 audit proved — against real PostgreSQL 17, not by inference — that
`qf_jarvis.event.sequence` (`GENERATED ALWAYS AS IDENTITY`) provides **none** of those properties:

- **Permanent gaps from benign duplicates.** The event-store `INSERT ... ON CONFLICT DO NOTHING`
  draws the identity value _before_ the unique conflict is detected; on conflict the row is discarded
  but the value is consumed. Reproduced: committed identities `{1, 3}` with a permanent gap at `2`.
- **Permanent gaps from aborted transactions.** Identity allocation is non-transactional; a
  rolled-back insert permanently skips its value. Reproduced: a rolled-back insert took `4`, the next
  committed insert took `5`.
- **Commit inversion under READ COMMITTED.** A later identity can commit and be visible before an
  earlier one. Reproduced: `F` (id 7) committed and was visible while `E` (id 6) was still uncommitted.

Consequences for the runner if it used the raw identity:

- A cursor of `= last + 1` **stalls forever** at the first benign duplicate or aborted ingest: the
  query for the missing value returns nothing, the runner reports "caught up", and every later event
  is silently never processed.
- Relaxing to `MIN(sequence) > last` **silently skips** an earlier event that commits later (the
  inversion), which is data loss — strictly worse than a stall.

ADR-0022 §2 already, and correctly, states that the raw sequence has **no gap detection** and that
gaps are "not detectable, and not claimed." The error is not in ADR-0022's description of the storage
identity; it is in treating that identity as the **projection cursor**.

## Decision

Introduce a **separate, gap-free, commit-ordered projection position**, allocated **by the database**
on every genuine event INSERT, and make the projection layer read _that_ — never the raw storage
identity. `qf_jarvis.event.sequence` is **immutable and unchanged**: no event row is renumbered,
updated, dropped, or re-identified. It remains a storage identity only.

Migration **`0005_projection_event_positions.sql`** adds:

1. **A private singleton allocator** `qf_jarvis.projection_event_position_allocator` — one `TRUE` row
   (PK + `CHECK (singleton = TRUE)`), a `last_position BIGINT NOT NULL` with a non-negative CHECK,
   seeded once. No payload or personal data.
2. **An append-only map** `qf_jarvis.projection_event_position` — `position BIGINT PRIMARY KEY`,
   `event_storage_sequence BIGINT NOT NULL UNIQUE`, a positive-position CHECK, and a foreign key to
   `qf_jarvis.event(sequence)`. The `UNIQUE` index on `event_storage_sequence` _is_ the index for the
   FK/join direction. UPDATE and DELETE are refused by a `BEFORE UPDATE OR DELETE` trigger (fires for
   every role, including the owner), exactly as the event/audit/attempt logs.
3. **A one-time deterministic backfill** of events accepted before 0005: dense positions `1..N`
   ordered by the immutable raw `event.sequence`, the allocator seeded to `N`. No event row is
   updated. This is the single authoritative historical order for pre-0005 events (see limitation
   below).
4. **A row-level `AFTER INSERT` trigger** on `qf_jarvis.event`. Because an `AFTER INSERT` row trigger
   fires **only when a row was actually inserted**, an `ON CONFLICT DO NOTHING` duplicate allocates
   **no** position. The trigger function atomically claims the next position with
   `UPDATE ... RETURNING`, inserts one map row for `NEW.sequence`, and `RAISE`s (failing the event
   INSERT) if the allocator row is missing. It uses no dynamic SQL, fully-qualified names, a locked
   `search_path = pg_catalog, pg_temp`, and only fixed non-caller error text.

**Serialization and commit ordering.** The trigger's `UPDATE` takes the singleton allocator row's
lock, which is held until the **outer event transaction completes**. Concurrent inserts therefore
serialize on that one row, so positions are both **dense** and assigned in **commit order**, and a
rolled-back insert releases the lock and returns its position for reuse. This is the deliberate cost:
event ingestion is serialized at position-assignment time. It is accepted because Phase 3 stores
synthetic fixtures at low volume, the lock is held only for the tail of each insert, and correctness
of every projection depends on it. A batched or sharded allocator is a future evidence-driven
optimisation, not a Phase 3 need.

**Why `SECURITY DEFINER`.** The least-privilege ingestion role (`qf_jarvis_runtime`) must **not**
receive direct allocator/mapping write privilege. The trigger function runs as its owner (the
migration role that owns the tables), so the ingestion role's authorized `INSERT` on
`qf_jarvis.event` fires it without the role ever touching the allocator or map. It is hardened: it
lives in the private `qf_jarvis` schema, has a locked `search_path`, fully-qualifies every object,
uses no dynamic SQL, returns no caller text, and has `EXECUTE` revoked from PUBLIC and every runtime
role (a trigger function needs no `EXECUTE` grant by the firing role, so this blocks direct invocation
without breaking the trigger). It is not exposed through the Data API or the package API.

**Privileges.** PUBLIC / `anon` / `authenticated` / `service_role`: no access. `qf_jarvis_runtime`:
no direct allocator or map access, and no direct `EXECUTE`. `qf_jarvis_projection_runtime`:
column-level `SELECT` on the **map only** (never the allocator); no allocator write for any runtime
role; no schema `CREATE`, `DELETE`, `TRUNCATE`, ownership, or migration-history access.

**Vocabulary rename.** 0005 also renames the projection-owned `sequence` columns 0004 introduced so
they can never be confused with the raw storage identity: checkpoint `last_sequence → last_position`
and `blocked_sequence → blocked_position`; attempt `event_sequence → event_position`; read models
`first_event_sequence/last_event_sequence → first_event_position/last_event_position`; and the
related repository-owned constraints/index. `qf_jarvis.event.sequence` is deliberately **not** renamed.
The internal TypeScript vocabulary follows (`ProjectionEvent.sequence → position`, `lastPosition`,
`blockedPosition`, `processedEventPosition`, `failedEventPosition`, `eventPosition`), and a new
internal metadata reader resolves a position to a frozen, metadata-only `ProjectionEvent`
(`position`, `eventType`, `eventVersion`, `acceptedAt`) — never the raw identity, no payload.

The strict persistence rule is **preserved**: processed/failed/blocked position must equal
`last_position + 1`. It is now correct, because the position IS gap-free and commit-ordered.

## Supersession (narrow)

ADR-0021, ADR-0022, ADR-0034 and ADR-0035 remain **immutable historical decisions and are not
edited**. ADR-0036 supersedes **only** their incorrect assumption that the raw `event.sequence` is the
projection cursor, and Stage 3.4.2's internal `ProjectionEvent.sequence` field. Everything else in
those decisions stands.

## The pre-0005 backfill limitation (recorded honestly)

Events accepted **before** 0005 have their projection positions assigned by the one-time backfill in
raw-`event.sequence` order. Where the raw identity had gaps (from historical duplicates or aborted
inserts) those gaps are **collapsed** into a dense `1..N`; the backfill defines a single authoritative
historical order but cannot reconstruct any commit-time ordering information that the raw identity
never recorded. This is acceptable because Phase 3 has stored only synthetic fixtures and the managed
database carries only `0001` (nothing has been ingested against `0002+`). From 0005 forward, positions
are assigned live, in commit order, with no such caveat.

## Consequences

**Positive.** The projection cursor is gap-free and commit-ordered, enforced by the database for
**every** INSERT path (not just the TypeScript event-store), so the accepted `= last_position + 1`
runner protocol becomes correctly implementable. The raw event log is untouched and immutable. The
guarantee cannot be bypassed by a duplicate, an aborted insert, a concurrent commit, or a direct SQL
INSERT.

**Negative — accepted.** Event ingestion serializes on the allocator row at position-assignment time
(a throughput cost, acceptable at Phase 3 volumes). A new migration (`0005`) and an additive
event-INSERT trigger are introduced; Stage 3.5's eventual migration therefore shifts to `0006`+.

## Migration and managed status

- The next forward-only migration is **`0005_projection_event_positions.sql`**. Migrations `0001`–
  `0004` are **byte-for-byte unchanged**. Stage 3.5's migration shifts to `0006`+.
- Managed PostgreSQL **remains `0001`-only**. Migrations `0002`, `0003`, `0004` and now `0005` are
  **all unapplied**. Because the default migrator applies every pending migration, a managed run would
  apply `0002 → 0003 → 0004 → 0005`. **No managed migration is authorized.**
- **The projection runner remains unimplemented.** This slice adds only the ordering foundation
  (positions, map, allocator, trigger, reader, and the vocabulary rename). No advisory-lock code, no
  retry execution, no handlers, no rebuild, no worker, and no HTTP integration are added.
