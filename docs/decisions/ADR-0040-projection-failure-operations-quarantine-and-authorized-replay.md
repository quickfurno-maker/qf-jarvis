# ADR-0040 — Projection Failure Operations, Quarantine and Authorized Replay

**Status:** Accepted (2026-07-21, design/planning only — no runtime implementation) — QFJ-P03.07A
**Deciders:** Owner
**Phase:** QFJ-P03.07 — Projection Failure Operations (canonical Roadmap v3.0; historical alias Stage 3.5)

**Relates to:** [ADR-0021](./ADR-0021-processing-retries-dead-letters-and-replay.md) (retries, dead letters, replay — the originating intent) · [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md) (ordering, rebuild determinism) · [ADR-0034](./ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md) (checkpoint/attempt foundation, migration 0004) · [ADR-0036](./ADR-0036-stage-3-4-3-gap-free-projection-ordering.md) (commit-ordered positions, migration 0005) · [ADR-0037](./ADR-0037-stage-3-4-4-projection-runner.md) (the one-event runner) · [ADR-0038](./ADR-0038-stage-3-4-5a-projection-worker.md) (the worker) · [ADR-0039](./ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md) (canonical roadmap, migration-allocation rule)

**Design documents introduced:** [docs/architecture/projection-failure-operations.md](../architecture/projection-failure-operations.md) · [docs/operations/projection-failure-operations-runbook.md](../operations/projection-failure-operations-runbook.md)

> **This ADR designs QFJ-P03.07 and decides the schema question. It implements nothing.** No migration, no SQL, no source, no test, no operator tooling. Migration 0006 remains **absent**.

---

## Context

The projection backbone is complete through QFJ-P03.06 (Production Projection Activation, merged via PR #24; canonical baseline `main` = `a7501d8361d982c5f3f2c618111092e26b41aa36`). The merged runtime, verified by reading the code:

- **The runner** (`runProjectionOnce`, ADR-0037) processes at most one event for one projection per invocation under a non-blocking, transaction-scoped advisory lock keyed on **projection name + version**. It reads exactly `checkpoint.last_position + 1` through the gap-free commit-ordered position map (never raw `event.sequence`), applies the handler under a SAVEPOINT, and — atomically with the handler write — advances the checkpoint on success or records bounded failure bookkeeping. It returns one of **seven** frozen outcomes (`busy`, `caught-up`, `succeeded`, `retry-scheduled`, `blocked-now`, `blocked-existing`, `retry-pending`) or throws one of **five** closed runner-error codes.
- **Retry/exhaustion.** `MAX_PROJECTION_ATTEMPTS = 5`. Deterministic handler failures 1–4 schedule an equal-jitter backoff (`projection_checkpoint.next_attempt_at`, status `active`, `failed_attempt_count` 1–4); the **fifth** failure marks the checkpoint `status = 'blocked'` at `blocked_position = last_position + 1`, `failed_attempt_count = 5`. Each attempt is an immutable, payload-free row in `projection_attempt` (append-only; an UPDATE/DELETE trigger refuses mutation).
- **Classification** (`classifyHandlerError`) is a closed, hostile-safe tri-state on the caught value's own SQLSTATE: an **absent** code (ordinary error) or a **recognised handler-side** SQLSTATE (`23505/23514/23503/23502/22*/42501/42P01/42703/42883`) is **deterministic** (records a bounded attempt); every other well-formed code (including `40P01/40001/08*/57P0*/53*`) and every **invalid/unreadable** code is **conservative infrastructure** (aborts, records nothing, throws `projection-infrastructure-failed`). Repository-invariant divergence throws `projection-attempt-checkpoint-divergent`. An unknown COMMIT outcome throws `projection-commit-outcome-unknown`. Cancellation/shutdown is owned by the worker (ADR-0038) and drains the active cycle — it manufactures no result and no durable failure.

## Problem statement

A `blocked` checkpoint is a **terminal dead-end**: `blockedExistingResult` returns forever and there is **no path back to `active`**. There is no operator lifecycle, no attribution, no reason, no idempotency, no replay authorization, no operator-action ledger, and no replay-attempt evidence. ADR-0021 anticipated exactly this (a `blocked` halt at `N−1`, an immutable `projection_quarantine` ledger with attribution and reason, a `replay_audit` row for every governed replay, idempotent replay, quarantine reproduced during rebuild) — and migration 0004 deliberately **excluded** those tables, deferring them to "Stage 3.5" (now QFJ-P03.07). QFJ-P03.07 must add the **operations layer** that turns a blocked projection into an inspectable, governable, safely-recoverable failure — **without weakening any existing invariant**.

## Decision (design)

### Failure taxonomy (preserve and formalize the runner's real behaviour)

1. **Transient infrastructure** (`40P01`, `40001`, class `08`, `57P0*`, class `53`, connectivity loss): rollback, no checkpoint advance, no durable deterministic failure, throw to supervision, bounded telemetry. _(The runner already treats these as conservative infrastructure via the allowlist.)_
2. **Repository invariant** (missing position, inconsistent join, checkpoint corruption, impossible ordering, invalid return shape): rollback, no advance, immediate stop + high-severity alert, fail closed. _(`projection-attempt-checkpoint-divergent`.)_
3. **Deterministic handler failure** (handler rejects a valid immutable event, reproducibly for the same handler version + event): SAVEPOINT rollback, checkpoint unchanged, bounded retry; **on exhaustion create exactly one durable active failure and block the projection version at that position.**
4. **Cancellation / controlled shutdown**: rollback incomplete work, no false exhaustion, no false durable failure, clean shutdown.
5. **Unknown / unclassified**: fail closed, never silently deterministic, preserve sanitized diagnostics, escalate.

### Durable failure lifecycle

`OPEN → ACKNOWLEDGED → QUARANTINED → REPLAY_AUTHORIZED → REPLAYING → (RESOLVED | back to a controlled state)`; plus terminal `SUPERSEDED/RETIRED` only under separately-governed projection-version retirement. **There is no `SKIP`/`IGNORE` state.** A durable failure is created only by retry exhaustion (§ taxonomy 3). The full state machine, transition table, actor rules, idempotency, and concurrency rules are in [projection-failure-operations.md](../architecture/projection-failure-operations.md).

### Strict checkpoint and ordering invariants (unchanged)

The checkpoint advances **only** after a successful handler + atomic checkpoint advance. Acknowledge, quarantine, and replay-authorize **never** advance the checkpoint. A failed event is **never** skipped; later positions **never** process while a projection is blocked. Quarantine means "isolate and block for controlled investigation," never "skip and continue." A replay processes the **same** immutable event identity at the **same** position under the **same** name+version advisory lock, using the **same** production handler contract — no payload substitution, no handler substitution.

### Operator authority

Five conceptual roles — `READ_ONLY_OPERATOR`, `FAILURE_OPERATOR`, `REPLAY_APPROVER`, `SYSTEM_RUNNER`, `ADMINISTRATOR` — with separation of duties (request ≠ approve), least privilege, mandatory actor + reason + idempotency key on every mutating action, approval expiry, correlation IDs, redaction, rate limiting, and replay-storm prevention. No ad-hoc SQL mutation is a normal operator workflow. An operator **cannot** mark a failure resolved without proof of successful processing.

### Auditability, observability, security

Every mutating operator action is authenticated, authorized, attributable, idempotent, reason-bearing, and auditable, appended to an **immutable** action ledger. Replay authorizations and replay-attempt evidence are durable and bounded. Diagnostics are sanitized (closed safe codes and bounded digests only — never raw payload, message, stack, SQL, or secret). Metrics/logs/alerts are defined in the design document.

### Schema verdict — **SCHEMA_REQUIRED**

The current schema **cannot** represent QFJ-P03.07 without damaging existing semantics:

- `projection_checkpoint` is a tightly CHECK-constrained mutable state row (`active`/`blocked` only) with no columns for operator lifecycle, actor, reason, idempotency, generation, or authorization; its `blocked_shape`/`active_*` constraints would have to be torn up to host operator states. Overloading it destroys the very invariants that make it trustworthy.
- `projection_attempt` is immutable, append-only, payload-free, and scoped to **automatic** attempts (attempt_number 1–5); the runtime role holds INSERT/SELECT only. It cannot carry actor-attributed operator actions, replay authorizations, or replay evidence.
- ADR-0021 already specified **new** tables (`projection_quarantine`, `replay_audit`) for this work, and migration 0004 explicitly excluded them.

Therefore new persistence is required. See [04-schema-assessment-and-migration-0006-verdict.md](../reports/qfj-p03-07-planning/04-schema-assessment-and-migration-0006-verdict.md).

### Migration 0006 verdict

**Migration 0006 is the next available number and is REQUIRED for QFJ-P03.07 — but is NOT created by this design task and is created only in QFJ-P03.07C under separate authorization** (per the ADR-0039 migration-allocation rule: design approved, schema proven necessary, scope reviewed, prior inventory confirmed, managed rollout documented, creation separately authorized). Conceptual objects (a projection-failure aggregate, an append-only action/audit ledger, a replay-authorization record, and replay-attempt evidence), constraints, indexes, least-privilege grants, and what 0006 **must not** contain (no RAG, agents, task runtime, model gateway, WhatsApp, n8n, Core integration, `rm_subject_activity`) are specified in the design document and report 04. **Migration 0006 remains absent in this task; no SQL was created.**

## Rejected alternatives

- **Silently skip the failed event** — breaks rebuild determinism (a hole that is not a pure function of the log) and the "never skip" invariant.
- **Advance the checkpoint after quarantine** — quarantine is isolation, not application; advancing would apply nothing yet claim progress.
- **Edit the event payload** — the event log is immutable; operators never touch payload, identity, or position.
- **Reset the retry counter manually** — hides exhaustion and re-enters uncontrolled retry; recovery is authorized replay, not counter surgery.
- **Direct operator checkpoint mutation** — bypasses attribution, invariants, and the advisory lock.
- **Unrestricted SQL replay** — arbitrary payload/handler substitution; no authorization, no idempotency, no evidence.
- **Reuse another projection's authorization** — authorization is bound to exact name+version+position+event identity+failure generation.
- **Infinite automatic retry** — retries stay bounded at 5; exhaustion blocks and requires a human.
- **Treat all failures as deterministic** — infrastructure/invariant failures must not become durable deterministic failures.
- **Store uncontrolled raw stack traces or event payloads** — only closed safe codes and bounded sanitized digests.

## Consequences

**Positive.** A blocked projection becomes inspectable and safely recoverable through a governed, audited, idempotent workflow; rebuild determinism (QFJ-P03.08) is preserved because quarantine is a recorded, replayable decision.

**Negative — accepted.** QFJ-P03.07 requires migration 0006 and a new operations surface; it is decomposed into bounded, separately-authorized slices (QFJ-P03.07B–G) so no single change is unreviewable.

**Migration/delivery.** No migration, SQL, source, test, or deployment in this task. Managed PostgreSQL remains 0001-only. QFJ-P03.08 is not begun.

## Implementation slices

QFJ-P03.07B (contracts/taxonomy) → QFJ-P03.07C (persistence foundation + migration 0006, separately authorized) → QFJ-P03.07D (retry-exhaustion integration) → QFJ-P03.07E (operator inspection + quarantine) → QFJ-P03.07F (authorized replay) → QFJ-P03.07G (observability, runbook, exit audit). Detail: [05-implementation-slices-test-plan-and-readiness-verdict.md](../reports/qfj-p03-07-planning/05-implementation-slices-test-plan-and-readiness-verdict.md).

## Change-control rule

QFJ-P03.07 extends the projection phase; it changes **no** existing invariant, migration, or agent authority. Migration 0006 may be created only when QFJ-P03.07C is separately authorized under the ADR-0039 rule. Changing the failure taxonomy, the checkpoint invariants, the replay-immutability rule, or the schema verdict requires a superseding ADR. Operational status may advance (a slice completing, 0006 applied) without a new ADR.
