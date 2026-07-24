# Projection Failure Operations — QF Jarvis (QFJ-P03.07 design)

**Status:** Design and planning (QFJ-P03.07A). Adopted 2026-07-21 under [ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md). **This document is the design; runtime is delivered slice by slice.** Canonical phase: **QFJ-P03.07 — Projection Failure Operations** ([qf-jarvis-roadmap-v3.md](./qf-jarvis-roadmap-v3.md); historical alias Stage 3.5).

> **Implementation status.** QFJ-P03.07B (taxonomy/contracts), QFJ-P03.07C (persistence + migration 0006), QFJ-P03.07D (atomic retry-exhaustion integration), and QFJ-P03.07E (failure inspection and quarantine operations) are merged and locked. **QFJ-P03.07F (authorized projection replay execution) is implemented** as an internal replay service: authorize (quarantined → replay-authorized), execute (lease-protected one-shot claim → apply the registered handler to the exact blocked event → atomic success resumes the checkpoint one position, resolves the failure, consumes the authorization), deterministic replay-failure recording (checkpoint stays blocked, failure returns to quarantined), expired-lease takeover, and reconciliation. Every step is authorized, generation-guarded, idempotent, and audited; there is **no automatic scheduler, poller, or bulk replay**. **QFJ-P03.07G (observability, runbook, exit audit) is implemented**: the internal closed-vocabulary structured logger and in-process metrics registry (no third-party dependency, no exporter), the derived health readers and the startup schema gate, post-commit telemetry across the runner, worker, inspection/quarantine and replay paths, a **read-only** inspection CLI on a narrowly scoped internal subpath, the alerting specification, the operational query surface, and the rewritten runbook with ratified recovery objectives. Telemetry never participates in a correctness transaction and a blocked projection never fails liveness, readiness, or deployment health. Migration 0006 is unchanged and applied local/CI only (not managed, not deployed); migration 0007 does not exist.

## Scope

Design the operations layer that turns a **blocked** projection (retry-exhausted at a poison event) into an inspectable, governable, safely-recoverable durable failure: failure taxonomy, durable lifecycle, quarantine, authorized replay, operator authority, auditability, observability, and the schema decision.

## Exclusions

No runtime implementation; no migration 0006; no SQL; no operator tooling/API; no source or test changes; no database access; no QFJ-P03.08 rebuild/erasure; no model/RAG/agent/n8n/WhatsApp/Core work.

## Repository baseline

- `main` = `a7501d8361d982c5f3f2c618111092e26b41aa36` (PR #25 merged; Roadmap v3 + ADR-0039 locked).
- Migrations 0001–0005 immutable; managed PostgreSQL = 0001 only; **migration 0006 absent**.
- `@qf-jarvis/event-backbone` package-root runtime surface = exactly 39 symbols.

## Current implementation inventory (verified by reading source)

| Concern | Reality |
| --- | --- |
| Runner | `runProjectionOnce` (ADR-0037): one event per call, advisory `xact` lock on **name+version**, reads `checkpoint.last_position + 1` via the position map, handler under SAVEPOINT, atomic success advance or bounded failure bookkeeping. |
| Outcomes | 7 frozen: `busy`, `caught-up`, `succeeded`, `retry-scheduled`, `blocked-now`, `blocked-existing`, `retry-pending`. |
| Runner errors | 5 closed: `projection-runner-unavailable`, `projection-unknown-definition`, `projection-attempt-checkpoint-divergent`, `projection-infrastructure-failed`, `projection-commit-outcome-unknown`. |
| Retry / exhaustion | `MAX_PROJECTION_ATTEMPTS = 5`; failures 1–4 → equal-jitter backoff (`next_attempt_at`, active); 5th → `status='blocked'` at `blocked_position`. |
| Persistence | `projection_checkpoint` (mutable state: `last_sequence`/position, `status` (`active` / `blocked`), `blocked_sequence`, `failed_attempt_count 0..5`, `last_safe_error_code`, `next_attempt_at`); `projection_attempt` (immutable, append-only, payload-free; attempt 1..5). |
| Classification | closed hostile-safe SQLSTATE tri-state; recognised handler codes → deterministic; all else + unreadable → conservative infrastructure. |
| Worker | `runProjectionWorker` (ADR-0038): deterministic traversal, isolation, no busy-spin, injected time/sleep, graceful `AbortSignal` drain. |
| Safe errors | `projection-handler-failed`, `projection-checkpoint-invalid`, `projection-state-write-failed`, `projection-attempt-write-failed`. |
| Grants | `qf_jarvis_projection_runtime`: SELECT/INSERT/UPDATE checkpoint & read models (no DELETE/TRUNCATE); INSERT/SELECT attempt (no UPDATE/DELETE); column-level SELECT on event metadata only. |

**Operational gap:** a `blocked` checkpoint is terminal — no path back to `active`, no operator lifecycle, no attribution, no reason, no idempotency, no replay authorization, no operator-action ledger, no replay evidence.

## Failure taxonomy

| # | Category | Representative signals | Behaviour |
| --- | --- | --- | --- |
| 1 | Transient infrastructure | `40P01`, `40001`, class `08`, `57P0*`, class `53`, connectivity loss, tx interruption | rollback; no advance; no durable deterministic failure; throw to supervision; bounded telemetry |
| 2 | Repository invariant | missing position, inconsistent join, checkpoint corruption, impossible ordering, invalid return shape | rollback; no advance; immediate stop + high-severity alert; fail closed |
| 3 | Deterministic handler failure | handler rejects a valid immutable event, reproducibly for the same handler version+event | SAVEPOINT rollback; checkpoint unchanged; bounded retry; **on exhaustion → one durable active failure + block** |
| 4 | Cancellation / shutdown | `AbortSignal`, SIGINT/SIGTERM | rollback incomplete work; no false exhaustion; no false durable failure; clean shutdown |
| 5 | Unknown / unclassified | anything not provably one of the above | fail closed; never silently deterministic; sanitized diagnostics; escalate |

### Canonical categories and the UNKNOWN_UNCLASSIFIED correction

The target taxonomy distinguishes five **named** categories: **DETERMINISTIC_HANDLER_FAILURE**, **TRANSIENT_INFRASTRUCTURE_FAILURE**, **REPOSITORY_INVARIANT_FAILURE**, **CANCELLATION_OR_SHUTDOWN**, and **UNKNOWN_UNCLASSIFIED_FAILURE**. Unknown, missing-code, unreadable, or hostile thrown values **must not automatically become deterministic handler failures.**

**UNKNOWN_UNCLASSIFIED_FAILURE — required behaviour:** rollback; checkpoint unchanged; **no ordinary deterministic retry exhaustion**; fail closed; a sanitized repository-owned diagnostic code; operator escalation. It is never counted as a bounded handler attempt and never blocks a projection via exhaustion.

**Current-behaviour correction (owned by QFJ-P03.07B).** The *current merged runner* (`classifyHandlerError`) classifies an **absent SQLSTATE** — an ordinary `Error` with no own `code` — as **DETERMINISTIC_HANDLER_FAILURE**, so a genuinely unknown/unclassified thrown value carrying no code is today consumed as a bounded handler attempt and can drive exhaustion. **This is current runtime behaviour requiring correction in QFJ-P03.07B (Failure Contracts and Error Taxonomy):** the contracts slice must split "absent code" into (a) a provably deterministic handler rejection and (b) `UNKNOWN_UNCLASSIFIED_FAILURE`, routing the latter to the fail-closed unknown path rather than the deterministic-retry path. (Invalid/unreadable/hostile codes are **already** routed to conservative infrastructure — not deterministic — so that part needs no correction.)

### Decision table (retryable vs durable)

| Condition | Deterministic? | Consumes attempt? | Durable failure on exhaustion? |
| --- | --- | --- | --- |
| Absent SQLSTATE (ordinary error) | Yes | Yes | Yes (after 5) |
| Recognised handler SQLSTATE (`23xxx`, `22*`, `42*`) | Yes | Yes | Yes (after 5) |
| `40P01`/`40001`/`08*`/`57P0*`/`53*` / other valid code | No (infrastructure) | No | No |
| Invalid/unreadable code (accessor, proxy, non-string) | No (conservative infra) | No | No |
| Reconciliation divergence | Invariant | No | No (stop + alert) |
| Cancellation/shutdown | No | No | No |

## Lifecycle state machine

```
                 retry exhaustion (5th deterministic failure)
                                │
                                ▼
                             ┌──────┐  acknowledge   ┌──────────────┐
                             │ OPEN │──────────────▶ │ ACKNOWLEDGED │
                             └──────┘                └──────────────┘
                                │  quarantine               │ quarantine
                                └───────────┬───────────────┘
                                            ▼
                                     ┌─────────────┐
                                     │ QUARANTINED │
                                     └─────────────┘
                                            │ authorize replay (approver, reason, idempotency, expiry)
                                            ▼
                                  ┌────────────────────┐
                                  │ REPLAY_AUTHORIZED  │
                                  └────────────────────┘
                                            │ runner consumes authorization under name+version lock
                                            ▼
                                     ┌────────────┐
                       replay fails  │ REPLAYING  │  replay succeeds (atomic apply + advance)
                    ┌────────────────┤            ├────────────────┐
                    ▼                └────────────┘                ▼
        back to QUARANTINED / ACKNOWLEDGED                    ┌──────────┐
        (controlled; new bounded evidence)                   │ RESOLVED │ (terminal)
                                                             └──────────┘

  SUPERSEDED / RETIRED  ← only via separately-governed projection-version retirement (never claims processing)
```

There is **no** `SKIP`/`IGNORE` state and no transition that advances the checkpoint except a **successful** replay.

### Transition table

| From | To | Who requests | Who authorizes | Effect on checkpoint |
| --- | --- | --- | --- | --- |
| (runner) | OPEN | SYSTEM_RUNNER (automatic) | n/a | unchanged (already blocked) |
| OPEN | ACKNOWLEDGED | FAILURE_OPERATOR | self (attributed) | none |
| OPEN / ACKNOWLEDGED | QUARANTINED | FAILURE_OPERATOR | self (attributed) | none |
| QUARANTINED / ACKNOWLEDGED | REPLAY_AUTHORIZED | FAILURE_OPERATOR (request) | REPLAY_APPROVER (approve; ≠ requester) | none |
| REPLAY_AUTHORIZED | REPLAYING | SYSTEM_RUNNER | valid authorization | none until success |
| REPLAYING | RESOLVED | SYSTEM_RUNNER | successful handler + atomic advance | **advance exactly once** |
| REPLAYING | QUARANTINED/ACKNOWLEDGED | SYSTEM_RUNNER | replay failed | none |
| any non-terminal | SUPERSEDED/RETIRED | ADMINISTRATOR | separately governed | none (never claims processing) |

**Invalid transitions (rejected, fail closed):** OPEN→RESOLVED; any→RESOLVED without a successful replay attempt; QUARANTINED→(later position processed); REPLAY_AUTHORIZED reused after consumption; authorization applied to a different name/version/position/event/generation; manual checkpoint advance; RESOLVED→anything; retry-counter reset.

**Terminal states:** RESOLVED, SUPERSEDED/RETIRED. **Non-terminal:** OPEN, ACKNOWLEDGED, QUARANTINED, REPLAY_AUTHORIZED, REPLAYING.

## Checkpoint invariants (unchanged, restated)

1. `event.sequence` is storage identity only; the position map is the cursor.
2. Runner reads exactly `checkpoint.last_position + 1`, joined to the immutable event via the storage sequence.
3. Handler + checkpoint advance are atomic; the checkpoint never advances on failure.
4. A failed event is never silently skipped; quarantine never means "skip and continue."
5. A poison event may block one name+version but must not corrupt another projection/version, the event log, the position map, or unrelated workers.
6. Advisory lock derives only from name+version.
7. Resolution occurs only after a successful handler + atomic advance; an operator cannot mark resolved without proof.
8. Operator actions never modify event payload/identity/position, prior audit evidence, or projection history.

## Retry-exhaustion algorithm (design)

On the 5th consecutive deterministic failure for the pending position, in the same transaction that records the final failed attempt, the runner (extended in QFJ-P03.07D) **also** creates exactly one durable failure aggregate row in state `OPEN` — keyed to name+version+position+event identity, carrying a `generation` of 0, bounded sanitized diagnostics, and attempt counts — atomically with `recordCheckpointBlocked`. The single exhaustion transaction therefore performs, all-or-nothing: **append final failed attempt → set checkpoint `blocked` → set `blocked_position` → create exactly one matching unresolved failure.** A partial-unique constraint guarantees **one active (non-terminal) failure per (name, version, position)**; a duplicate worker that lost the advisory-lock race cannot create a second. Restart re-derives from the durable checkpoint + attempt log; no counter reset. The active failure is closed transactionally on a successful replay (→ RESOLVED) or through a provably consistent state transition.

### Checkpoint ↔ failure-aggregate reconciliation (fail closed)

**Required invariant:** a `blocked` checkpoint ↔ **exactly one** matching unresolved (non-terminal) active failure, for the same (name, version, `blocked_position`, event identity). The runner/reconciler **fails closed** — stops, does **not** advance, does **not** retry, and raises a high-severity `reconciliation mismatch` alert — on any divergence:

| Divergence | Verdict |
| --- | --- |
| blocked checkpoint with **no** active failure | fail closed |
| active failure with **no** blocked checkpoint | fail closed |
| checkpoint `blocked_position` ≠ failure position | fail closed |
| failure event identity ≠ event at that position | fail closed |
| failure name/version ≠ checkpoint name/version | fail closed |
| **more than one** active failure for a (name, version, position) | fail closed (the partial-unique constraint also prevents creation) |
| inconsistent `generation` or lifecycle status | fail closed |

No divergence is auto-repaired by advancing, skipping, or resolving; each is surfaced for operator/engineering review. This extends the existing `projection-attempt-checkpoint-divergent` reconciliation (ADR-0037) to the failure aggregate.

## Quarantine semantics

Quarantine = isolate the failed position for controlled investigation: disable uncontrolled automatic retry, keep the name+version blocked, preserve all evidence, require explicit replay authorization. Quarantine **must not** delete/edit the event, edit the position, advance the checkpoint, permit later positions to process, disable audit evidence, affect unrelated projections, or become an unrestricted dead-letter skip.

**Distinct from:** *ingestion rejection* (pre-store, boundary audit) · *event conflict* (same id, different content, at store) · *transient infrastructure retry* (no durable failure) · *projection retry* (bounded automatic, pre-exhaustion) · *dead-letter messaging* (no broker; single-store design) · *projection retirement* (version formally retired) · *rebuild* (QFJ-P03.08; reproduces the quarantine set for determinism).

## Operator workflow (design)

READ_ONLY_OPERATOR inspects sanitized status/metadata. FAILURE_OPERATOR acknowledges, quarantines, and **requests** replay (with reason + idempotency key). REPLAY_APPROVER (≠ requester) **approves** a bounded replay (reason, expiry). SYSTEM_RUNNER executes only a valid authorization. ADMINISTRATOR retires a version only via a separately-governed process. No ad-hoc SQL mutation is a normal workflow.

## Replay workflow (design)

1. Replay is projection-specific and bound to name + version + position + event storage identity + active failure ID + failure generation + authorization ID.
2. Replay acquires the normal name+version advisory `xact` lock (so a normal runner pass and a replay cannot collide).
3. Replay **re-checks** current checkpoint, active-failure status, exact next position, event identity, projection version, authorization validity and expiry — any mismatch/stale/expired fails closed.
4. Replay runs the **same** production handler contract; no payload substitution, no handler substitution.
5. **Success** atomically: apply the projection change, advance the checkpoint once, record successful attempt evidence, resolve the failure, consume/close the authorization, and append the immutable action/audit evidence (see [Atomic replay completion](#atomic-replay-completion-transaction-owner)).
6. **Failure** keeps the checkpoint unchanged, records one bounded new attempt, returns the failure to a controlled state, and never loops uncontrolled.
7. Duplicate replay requests are idempotent (idempotency key); concurrent replays cannot both execute (advisory lock + single-consume authorization); expired/stale/mismatched authorizations fail closed.

### Replay crash and unknown-commit recovery

A durable `REPLAYING` state must **never** exist without an **execution owner**, a **bounded lease**, a **lease expiration**, **takeover rules**, and **reconciliation rules**. The preferred, safest model:

- The authorized failure remains **`REPLAY_AUTHORIZED`** as the durable resting state; entering execution appends an **append-only replay-attempt record in state `STARTED`** carrying the **runner identity**, a **bounded lease**, and the lease expiry — it does **not** flip the failure into a bare, ownerless `REPLAYING` row.
- **Crash matrix.** A crash **before execution** leaves the authorization intact and unconsumed; a `STARTED` attempt (if written) simply lapses at lease expiry. A crash **during handler execution** or **during transaction commit** aborts the transaction — the advisory `xact` lock auto-releases and there is no partial apply. A crash **after a successful commit but before acknowledgement** is safe because the successful attempt, checkpoint advance, failure resolution, and authorization consumption committed atomically (see [Atomic replay completion](#atomic-replay-completion-transaction-owner)); re-observation reconciles to `RESOLVED`, never a second replay.
- **Expired lease → reconcile before any new replay.** Reconciliation checks the checkpoint position, the failure state, the authorization consumed/unconsumed flag, the latest replay-attempt outcome, and — when provable — the read-model transaction outcome. Only after reconciliation may a fresh authorized replay proceed. Takeover by another runner requires the prior lease to be **expired and reconciled** first.
- **Unknown commit outcome never triggers a blind duplicate replay.** On an ambiguous commit the runner **first reconciles** checkpoint + failure state + authorization state + replay-attempt record + (when provable) the read-model outcome, and re-drives **only** if reconciliation proves the replay did **not** commit.

### Changed-handler rule (safest deterministic choice)

**A production projection version is immutable after activation.** Replaying a poison event is only ever valid against the *same* handler behaviour that produced the checkpoint. A behavioural fix is a **new projection version** that rebuilds from position 0 (QFJ-P03.08), **not** an in-place replay against changed code for the same version. Replay is for transient-cause poison (e.g. a since-corrected data/environment condition) reprocessed by the identical handler contract.

### Atomic replay completion (transaction owner)

A successful replay records — **atomically, in one transaction owned by the replay runner (QFJ-P03.07F) under the name+version advisory `xact` lock** — all of: the **read-model mutation**; the **checkpoint advance** (exactly once); the **replay-attempt `SUCCEEDED` evidence**; the **failure resolution** (→ `RESOLVED`); the **authorization consumption**; and the **append-only action/audit evidence**. Because every one of these objects lives in the `qf_jarvis` schema reachable on a single connection, one transaction is sufficient and is the **required** design. **If a future constraint ever prevents a single transaction, a durable transactional outbox with fail-closed reconciliation is required — best-effort follow-up updates are prohibited.**

A replay **failure** leaves the checkpoint unchanged, records bounded attempt evidence, creates **no** automatic replay loop, does **not** allow unlimited authorization reuse (single-consume; a re-attempt requires a fresh, policy-gated authorization — new approval when policy requires it), and returns the failure to **exactly one** controlled lifecycle state.

## Concurrency, idempotency, authorization

- Advisory `xact` lock on name+version serializes normal runner and replay.
- One active failure per (name, version, position); one active authorization per exact failure generation.
- Idempotency keys unique within scope; duplicate operator/replay requests are suppressed, not re-executed.
- Authorizations carry actor, reason, created time, optional expiry, consumed time/attempt reference, and revocation.

## Audit evidence

An **append-only, immutable** operator action ledger records action ID, failure ID, action type, actor ID, reason, idempotency key, correlation ID, expected generation, resulting generation, timestamp, and bounded metadata. Replay authorizations and replay-attempt evidence are durable. Action rows cannot be mutated by the runtime role.

## Error normalization and sensitive-data handling

Only closed safe codes and bounded sanitized digests are stored — never raw payload, message, stack, cause, SQLSTATE text, SQL, credentials, subject/correlation ids, or sender-controlled text. Diagnostics are redacted at the boundary, exactly as the existing attempt log.

## Metrics and alerts

**Metrics:** handler failures; retry attempts; retry exhaustion; active failures; quarantined failures; oldest active failure age; blocked-projection duration; replay requested/authorized/attempted/succeeded/failed; stale authorization; duplicate replay suppressed; invariant failures; infrastructure failures; projection lag behind latest position.
**Logs:** structured, correlation-aware; name/version, failure ID, position, event type, sanitized code, actor for operator actions; never raw secrets or payloads.
**Alerts:** invariant failure; first retry exhaustion; active failure beyond SLA; repeated replay failure; blocked production projection; abnormal failure-rate increase; reconciliation mismatch.

## Schema decision — **SCHEMA_REQUIRED**

The `blocked` checkpoint and immutable attempt log cannot represent the durable lifecycle, actor-attributed action ledger, replay authorization (expiry/consumption/idempotency), or replay evidence without overloading and damaging their invariants. ADR-0021 already specified new tables for this work; migration 0004 excluded them. Full assessment and conceptual objects/constraints/grants: [report 04](../reports/qfj-p03-07-planning/04-schema-assessment-and-migration-0006-verdict.md).

## Migration 0006 decision

**Required, next available number, created only in QFJ-P03.07C under separate authorization** (ADR-0039 rule). **Absent in this task; no SQL created.** Conceptual model (share where safe, minimal without losing auditability):

- **Projection failure aggregate** — branded failure ID; name; version; position; event storage sequence; event ID (when available); event type; classification; normalized code; bounded sanitized digest; first/last failed timestamps; automatic + replay attempt counts; lifecycle status; generation; acknowledged/quarantined/resolved timestamps + actors; successful attempt reference; created/updated. **Constraint:** one active (non-terminal) failure per (name, version, position).
- **Failure action/audit ledger** — append-only: action ID; failure ID; action type; actor ID; reason; idempotency key; correlation ID; expected generation; resulting generation; timestamp; bounded metadata. **Immutable (UPDATE/DELETE trigger).**
- **Replay authorization** — authorization ID; failure ID; exact failure generation; authorized actor; reason; created; optional expiry; consumed time + consumed attempt reference; revocation; idempotency key. **Constraint:** one active authorization per exact failure generation.
- **Replay attempt evidence** — attempt ID; failure ID; authorization ID; started/finished; outcome; normalized code; resulting checkpoint position; runner identity/correlation; bounded diagnostics. *(May share the projection-attempt lineage or be a sibling table; kept distinct so automatic vs replay evidence never blur.)*

**Constraints/indexes (concepts):** non-negative counters; valid versions/positions; lifecycle CHECK; event-identity consistency; immutable action rows; unique idempotency keys in scope; operator-queue and runner-lookup indexes; FKs where repository policy permits. **Least privilege:** the projection runtime role gains only what replay needs; no DELETE/TRUNCATE; operator-action and authorization writes go through a bounded application boundary, not ad-hoc SQL. **0006 must not contain:** RAG, agents, task runtime, model gateway, WhatsApp, n8n, Core integration, `rm_subject_activity`.

## Implementation slices

See [ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md) and [report 05](../reports/qfj-p03-07-planning/05-implementation-slices-test-plan-and-readiness-verdict.md): QFJ-P03.07B contracts → C persistence (migration 0006, separately authorized) → D retry-exhaustion integration → E inspection/quarantine → F authorized replay → G observability/runbook/exit audit.

## Test matrix

The 38-case matrix (first failure → exhaustion → restart → concurrency → checkpoint safety → isolation → operator idempotency → replay authorization/execution → redaction → rollback safety → least privilege → API containment → rebuild compatibility) is enumerated in [report 05](../reports/qfj-p03-07-planning/05-implementation-slices-test-plan-and-readiness-verdict.md).

## Exit criteria (QFJ-P03.07)

Retry exhaustion creates exactly one durable active failure; the checkpoint stays blocked and never skips; operators can inspect, acknowledge, and quarantine idempotently; authorized replay reprocesses the exact event under the advisory lock and either resolves atomically or re-enters a controlled state; every operator action is attributed and audited; diagnostics are bounded; least-privilege grants hold; the root API surface stays contained; and rebuild determinism for QFJ-P03.08 remains achievable (quarantine reproducible).

## Relation to QFJ-P03.08

QFJ-P03.08 (Rebuild Determinism and Erasure) consumes the quarantine set defined here so a rebuilt read model reaches the same state — quarantine is a recorded, replayable decision, not a hidden skip. This design is a prerequisite for, but does not begin, QFJ-P03.08.
