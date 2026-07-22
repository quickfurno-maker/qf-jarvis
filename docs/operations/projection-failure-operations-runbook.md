# Projection Failure Operations — Operator Runbook (design)

**Status:** Future operational runbook **design** (QFJ-P03.07A). Adopted 2026-07-21 under [ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md). Read with [projection-failure-operations.md](../architecture/projection-failure-operations.md).

> **This is a design, not live instructions.** QFJ-P03.07 operator commands, APIs, and replay execution are **not implemented**. Every command below is **CONCEPTUAL** and marked `[UNIMPLEMENTED]`; it does not exist yet and must not be invoked. No ad-hoc SQL mutation is ever a sanctioned operator workflow.
>
> **Persistence status (QFJ-P03.07C).** The durable **persistence foundation** exists — migration `0006_projection_failure_operations.sql` (failure aggregate, append-only action ledger, replay authorizations, replay-attempt/lease evidence) and its repository contracts. It is applied **local/CI only** (not managed, not deployed).
>
> **Runtime status (QFJ-P03.07D — live in code).** The production runner **automatically establishes a durable failure aggregate** on the fifth deterministic failure: in the SAME transaction that blocks the checkpoint, it creates exactly one `open` failure aggregate at the blocked position (category `DETERMINISTIC_HANDLER_FAILURE`, safe code `projection-handler-failed`, automatic attempt count 5) and appends one append-only `created` action attributed to the `system` actor `projection-runner`. On a restart it re-verifies that a blocked checkpoint has exactly one matching active failure and otherwise fails closed.
>
> **Operations status (QFJ-P03.07E — now live in code, internal API only).** An internal operations boundary now provides **authorized failure inspection and the two non-replay lifecycle mutations**: bounded keyset-paginated `list`, `inspect` (bounded detail with checkpoint/attempt correlation and divergence codes — **never** a payload, message, stack, SQL, or secret), action-history `inspect`, divergence `inspect`, **acknowledge** (`open → acknowledged`), and **quarantine** (`open`/`acknowledged → quarantined`). Every mutation is **authorized** (closed `projection-failure:inspect`/`:acknowledge`/`:quarantine` capabilities, quarantine strictly stronger than inspect), **generation-guarded** (a stale expected generation is rejected), **idempotent** (a deterministic action idempotency key means an exact repeat returns the prior result and writes nothing), **atomic** (status transition + exactly one append-only action in one transaction), and — for quarantine — **gated on the fail-closed divergence detector** (any divergence refuses the mutation). **Acknowledge** records operator review; **quarantine** isolates the position for controlled handling. **Both preserve the blocked checkpoint, the blocked position, `last_position`, every attempt, and the action history — neither advances/resets the checkpoint, skips the event, resolves the failure, or creates/executes a replay.** There is still **no CLI/dashboard**, so these functions are invoked only through the internal application boundary. **What an operator must NOT do:** never edit any row in `projection_failure*`/`projection_checkpoint` by hand, never run ad-hoc SQL against the failure/event tables, and never advance a blocked checkpoint. **Authorized replay execution (QFJ-P03.07F) and lease workers remain unimplemented** — replay is unavailable; for anything beyond acknowledge/quarantine the only sanctioned action is to **escalate** to engineering with the sanitized inspection evidence. The `[UNIMPLEMENTED]` markers below remain for replay-request/authorize/execute; the inspect/acknowledge/quarantine sections are now backed by the internal operations API.

## Roles (conceptual)

- **READ_ONLY_OPERATOR** — inspect status/metadata/sanitized diagnostics. No state change.
- **FAILURE_OPERATOR** — acknowledge, quarantine, request replay. Cannot self-approve replay.
- **REPLAY_APPROVER** — approve one bounded replay (reason required). ≠ requester.
- **SYSTEM_RUNNER** — executes only a valid authorized replay. Cannot self-authorize.
- **ADMINISTRATOR** — retire a projection version only via a separately-governed process; never edits events/checkpoints directly.

## 1. Detect a blocked projection

Signals: `blocked-projection duration` metric > 0; "blocked production projection" alert; projection lag rising; `runProjectionOnce` returning `blocked-existing` for a name+version.
Conceptual: `[UNIMPLEMENTED] failops list --status blocked` → shows name, version, position, first/last failed time, sanitized code.

## 2. Inspect sanitized failure details

`[UNIMPLEMENTED] failops show <failure-id>` → name, version, position, event type, classification, normalized safe code, bounded digest, automatic attempt count, lifecycle status, generation, prior operator actions. **Never** exposes raw payload, message, stack, SQL, or secrets.

## 3. Assess severity

- **Invariant failure** (`projection-attempt-checkpoint-divergent`) → highest severity; do **not** attempt replay; escalate to engineering (§11).
- **Deterministic handler failure** (`projection-handler-failed`) at exhaustion → normal failure-ops path.
- **Infrastructure pattern** (many transient aborts, no durable failure) → treat as outage (§12), not a failure-ops case.

## 4. Acknowledge

`[UNIMPLEMENTED] failops acknowledge <failure-id> --actor <id> --reason "<why>" --idempotency-key <key>`. Acknowledgement records review; it does **not** permit replay, resolve, or skip. Idempotent.

## 5. Quarantine

`[UNIMPLEMENTED] failops quarantine <failure-id> --actor <id> --reason "<why>" --idempotency-key <key>`. Isolates the position for controlled investigation, disables uncontrolled automatic retry, keeps the version blocked, preserves evidence. Does **not** delete/edit the event, edit the position, advance the checkpoint, or let later positions process. Idempotent.

## 6. Request replay

`[UNIMPLEMENTED] failops replay-request <failure-id> --generation <g> --actor <id> --reason "<why>" --idempotency-key <key>`. Binds to exact name+version+position+event identity+failure generation. A request is **not** an authorization.

## 7. Independent approval (four-eyes)

`[UNIMPLEMENTED] failops replay-approve <request-id> --approver <id> --reason "<why>" [--expires-at <ts>]`. The approver **must differ** from the requester. Produces a single-use, generation-bound, optionally-expiring authorization.

## 8. Execute authorized replay

Executed by SYSTEM_RUNNER, not by hand: `[UNIMPLEMENTED] failops replay-run <authorization-id>`. It acquires the name+version advisory lock, re-checks checkpoint/status/position/event identity/version/authorization validity+expiry, runs the **same** production handler, and on success atomically applies + advances the checkpoint once + records evidence + resolves + consumes the authorization. On failure it keeps the checkpoint unchanged, records one bounded attempt, and returns the failure to a controlled state.

## 9. Validate resolution

`[UNIMPLEMENTED] failops show <failure-id>` → status `RESOLVED`, a successful attempt reference, checkpoint advanced by exactly one position, authorization consumed. Confirm the projection resumes and lag falls.

## 10. Repeated replay failure

If replay fails repeatedly, do **not** loop. Re-quarantine, collect evidence (§13), and escalate: the cause is likely a genuine handler/data defect requiring a **new projection version + rebuild** (QFJ-P03.08), not further replay against the same version.

## 11. Invariant-failure escalation

A reconciliation/invariant failure is a stop-the-world engineering incident. Do not acknowledge, quarantine, or replay it as a routine failure. Page engineering; preserve state; treat as potential data-integrity corruption.

## 12. Infrastructure-outage distinction

Transient infrastructure failures (`40P01/40001/08*/57P0*/53*`, connectivity) create **no** durable failure and need **no** failure-ops action — they resolve when the database recovers. Do not manufacture a failure record or a replay for an outage.

## 13. Evidence collection

For any escalation, capture: failure ID, name/version/position, event type, normalized code, bounded digest, attempt history, operator action ledger entries, correlation IDs, and metric/alert timestamps. Never copy raw payloads or secrets.

## 14. Projection retirement escalation

Retiring/superseding a version is an ADMINISTRATOR action through a separate governance process (not failure-ops). It never claims the event was processed and never advances a checkpoint.

## 15. Incident closure

Close only when: the failure is RESOLVED (successful replay) **or** formally superseded/retired via governance; metrics/alerts are clear; the action ledger is complete and attributed; and a short post-incident note records cause and decision.

## Prohibited operator actions

- Editing event payload, identity, or position.
- Advancing a checkpoint manually or after quarantine.
- Resetting the retry counter.
- Direct SQL mutation of checkpoints, failures, authorizations, or audit rows.
- Marking a failure resolved without a successful replay.
- Reusing one projection's authorization for another projection/version/position/generation.
- Replaying against changed handler code for the same production version (use a new version + rebuild).
- Skipping a failed event to "continue."

## Recovery objectives (targets to ratify in QFJ-P03.07G)

- **Detection:** blocked projection alerted within minutes.
- **Triage:** severity assessed and acknowledged within the failure SLA.
- **Recovery:** resolved by authorized replay or escalated to version+rebuild within the incident SLA.
- **No silent data loss:** every failed position is either resolved or governed — never skipped.

## Future command / API placeholders

All `[UNIMPLEMENTED]` commands above are conceptual and will be defined in **QFJ-P03.07E** (inspection/quarantine) and **QFJ-P03.07F** (authorized replay) behind an application/command boundary. Until then there is **no** operator tooling; this runbook is design guidance only.
