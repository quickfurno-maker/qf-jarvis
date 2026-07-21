# Report 04 — Schema Assessment and Migration 0006 Verdict

**Date:** 2026-07-21. **Purpose:** Decide conclusively whether QFJ-P03.07 can be implemented on the current schema. Authoritative sources: migrations 0004/0005 (inspected), [ADR-0021](../../decisions/ADR-0021-processing-retries-dead-letters-and-replay.md), [ADR-0040](../../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md).

## Current-schema capability

| Existing structure      | What it represents                                                                                                                                          | Can it host failure operations?                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projection_checkpoint` | mutable state per (name, version): position, `active`/`blocked`, `blocked_sequence`, `failed_attempt_count 0..5`, `last_safe_error_code`, `next_attempt_at` | **No.** Tight CHECK constraints (`blocked_shape`, `active_*`) admit only `active`/`blocked`; there are no columns for operator lifecycle, actor, reason, idempotency, generation, or authorization. |
| `projection_attempt`    | immutable, append-only, payload-free automatic attempts (1..5)                                                                                              | **No.** UPDATE/DELETE refused by trigger; runtime role has INSERT/SELECT only; no actor/authorization linkage; scoped to automatic attempts.                                                        |
| read models             | disposable metadata                                                                                                                                         | irrelevant to failure ops                                                                                                                                                                           |

## Missing capabilities

The current schema cannot represent, without ambiguity:

1. a **durable active exhausted failure** as a first-class aggregate with an operator lifecycle;
2. **lifecycle status** beyond `active`/`blocked` (ACKNOWLEDGED/QUARANTINED/REPLAY_AUTHORIZED/REPLAYING/RESOLVED/SUPERSEDED);
3. **actor-attributed** operator actions;
4. **replay authorization** (approver, reason, expiry, single-consume, idempotency, generation binding);
5. **replay attempt evidence** distinct from automatic attempts;
6. **idempotency keys**;
7. **concurrency protection** for one-active-failure / one-active-authorization;
8. an **append-only audit history** of operator actions;
9. **resolution evidence** referencing the successful attempt.

## Alternatives examined

- **Add operator columns to `projection_checkpoint`.** Rejected: destroys the clean `active`/`blocked` invariant surface, forces removal/relaxation of load-bearing CHECK constraints, and conflates mutable runner state with operator lifecycle and audit.
- **Overload `projection_attempt` for operator actions.** Rejected: it is immutable append-only and payload-free with INSERT/SELECT-only grants; it cannot carry actor/authorization/lifecycle without breaking its audit semantics and least-privilege model.
- **Encode failures in a metadata read model.** Rejected: read models are disposable and non-authoritative; failure operations are authoritative operational state.
- **No persistence (in-memory operator state).** Rejected: fails durability, restart-safety, attribution, and auditability.

## Final verdict — **SCHEMA_REQUIRED**

**Exact reason:** the durable failure lifecycle, the actor-attributed immutable action ledger, the replay-authorization record (expiry/consumption/idempotency/generation binding), and the replay-attempt evidence are new, authoritative, mutable-then-terminal concepts that the tightly-constrained `projection_checkpoint` and the immutable payload-free `projection_attempt` cannot represent without breaking their own invariants. ADR-0021 already specified new tables (`projection_quarantine`, `replay_audit`) for exactly this work, and migration 0004 deliberately excluded them.

## Migration 0006 ownership

- **Migration 0006 is the next available number** (0001–0005 exist; 0006 absent) and is **required** for QFJ-P03.07.
- It is **created only in slice QFJ-P03.07C, under separate authorization**, per the [ADR-0039](../../decisions/ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md) migration-allocation rule (design approved · schema proven necessary · scope reviewed · prior inventory confirmed · managed rollout documented · creation separately authorized).
- **This task creates neither the migration nor any SQL. Migration 0006 remains absent.**

## Conceptual objects (design only — no SQL)

1. **Projection failure aggregate** — branded failure ID; name; version; position; event storage sequence; event ID (when available); event type; classification; normalized code; bounded sanitized digest; first/last failed timestamps; automatic + replay attempt counts; lifecycle status; generation; acknowledged/quarantined/resolved timestamps + actors; successful attempt reference; created/updated.
2. **Failure action/audit ledger** (append-only, immutable) — action ID; failure ID; action type; actor ID; reason; idempotency key; correlation ID; expected generation; resulting generation; timestamp; bounded metadata.
3. **Replay authorization** — authorization ID; failure ID; exact failure generation; authorized actor; reason; created; optional expiry; consumed time + consumed attempt reference; revocation; idempotency key.
4. **Replay attempt evidence** — attempt ID; failure ID; authorization ID; started/finished; outcome; normalized code; resulting checkpoint position; runner identity/correlation; bounded diagnostics.

_Sharing:_ replay evidence may extend the projection-attempt lineage or be a sibling table, but automatic and replay evidence must never blur. Prefer minimal schema without losing auditability.

## Conceptual constraints and indexes

- One **active** (non-terminal) failure per (name, version, position).
- One **active** authorization per exact failure generation.
- Unique idempotency keys within scope; non-negative counters; valid versions/positions; lifecycle CHECK; event-identity consistency; immutable action rows (UPDATE/DELETE trigger); FKs where repository policy permits; indexes for operator queues and runner lookup.

## Privileges (least privilege)

The `qf_jarvis_projection_runtime` role gains only what replay execution needs (SELECT/INSERT/UPDATE on the failure aggregate for lifecycle advance; INSERT on evidence; SELECT on authorizations to validate/consume) — **no DELETE/TRUNCATE**, no ability to mutate the action ledger. Operator-action and authorization writes go through a bounded application/command boundary in later slices, not ad-hoc SQL, and may use a distinct operator role.

## Retention behaviour

Failure aggregates, the action ledger, authorizations, and replay evidence are durable operational/audit records; retention follows the same append-only, no-runtime-delete discipline as `projection_attempt`. Terminal (RESOLVED/SUPERSEDED) failures are retained, not deleted.

## Transaction ownership

Retry-exhaustion failure creation is written in the **same** transaction as `recordCheckpointBlocked` (QFJ-P03.07D). Replay resolution (apply + advance + evidence + resolve + consume authorization) is a **single** transaction under the name+version advisory lock (QFJ-P03.07F). No cross-transaction partial state.

## What migration 0006 must NOT contain

RAG; agents; task runtime; model gateway; WhatsApp; n8n; QuickFurno Core integration; `rm_subject_activity` (absent a later explicit ownership decision). It is scoped strictly to projection failure operations.

## Rollout risks

The default migrator applies all pending migrations; a managed run would apply `0002`→`0006`. Any managed application must be scoped, reviewed, and separately authorized for the full pending set. Managed PostgreSQL remains 0001-only until then.

## Confirmation

**No migration and no SQL were created or applied by this task. Migration 0006 remains absent. No database was accessed.**
