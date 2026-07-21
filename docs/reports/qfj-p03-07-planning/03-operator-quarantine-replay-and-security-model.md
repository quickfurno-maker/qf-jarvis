# Report 03 — Operator, Quarantine, Replay and Security Model

**Date:** 2026-07-21. **Purpose:** The operator authority model, quarantine and replay controls, concurrency/idempotency, audit, redaction, abuse prevention, and incident workflow. Authoritative sources: [projection-failure-operations.md](../../architecture/projection-failure-operations.md), [runbook](../../operations/projection-failure-operations-runbook.md), [ADR-0040](../../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md).

## Operator roles

| Role               | May                                           | May not                                    |
| ------------------ | --------------------------------------------- | ------------------------------------------ |
| READ_ONLY_OPERATOR | inspect status/metadata/sanitized diagnostics | authorize/execute replay; alter state      |
| FAILURE_OPERATOR   | acknowledge; quarantine; request replay       | self-approve replay (four-eyes)            |
| REPLAY_APPROVER    | approve a bounded replay (reason required)    | bypass invariants; be the requester        |
| SYSTEM_RUNNER      | execute only a valid authorized replay        | create its own authorization               |
| ADMINISTRATOR      | retire a version via governed process         | edit immutable events/checkpoints directly |

## Separation of duties

Replay **request** (FAILURE_OPERATOR) is separated from replay **approval** (REPLAY_APPROVER), which is separated from **execution** (SYSTEM_RUNNER). No single actor drives a replay end-to-end. Least privilege: each role holds only its own capability; no role gains ad-hoc SQL mutation.

## Quarantine

Isolate the failed position for controlled investigation: disable uncontrolled automatic retry, keep name+version blocked, preserve evidence, require explicit replay authorization. **Must not** delete/edit the event, edit the position, advance the checkpoint, permit later positions, disable audit, affect unrelated projections, or become an unrestricted dead-letter skip. Idempotent.

## Replay request → approval → execution

- **Request** binds to name + version + position + event storage identity + active failure ID + failure generation, carrying actor, reason, idempotency key.
- **Approval** (distinct approver) issues a single-use, generation-bound, optionally-expiring authorization with reason.
- **Execution** acquires the name+version advisory `xact` lock, re-checks checkpoint/status/position/event identity/version/authorization validity+expiry, runs the **same** production handler (no payload/handler substitution), and on success atomically applies + advances once + records evidence + resolves + consumes the authorization; on failure keeps the checkpoint unchanged, records one bounded attempt, and returns to a controlled state.

## Concurrency

- Advisory lock on name+version serializes a normal runner pass and a replay (they cannot collide).
- One active failure per (name, version, position); one active authorization per exact failure generation.
- Concurrent replay requests cannot both execute (single-consume authorization + lock).

## Idempotency

Every mutating action carries an idempotency key unique within scope; duplicates are suppressed, not re-executed. Authorizations are single-consume. Replay success/failure transitions are idempotent under retry.

## Audit

An **append-only, immutable** action ledger records action ID, failure ID, action type, actor ID, reason, idempotency key, correlation ID, expected generation, resulting generation, timestamp, bounded metadata. Replay authorizations and replay-attempt evidence are durable. The runtime role cannot mutate ledger rows (mirrors the immutable `projection_attempt` trigger pattern).

## Redaction

Only closed safe codes and bounded sanitized digests are stored/logged — never raw payload, message, stack, cause, SQLSTATE text, SQL, credentials, subject/correlation ids, or sender-controlled text. Redaction happens at the boundary.

## Abuse prevention

- Four-eyes on replay approval; approver ≠ requester.
- Approval expiry; stale/expired/mismatched authorization fails closed.
- Rate limiting and replay-storm prevention (bounded replays per failure/time window).
- No ad-hoc SQL mutation; all mutating actions go through a bounded application/command boundary.
- Authorization bound to exact identity/generation — cannot be reused across failures/projections/versions/positions.

## Prohibited actions

Editing event payload/identity/position; manual or post-quarantine checkpoint advance; retry-counter reset; direct SQL mutation of checkpoints/failures/authorizations/audit; resolving without a successful replay; reusing another projection's authorization; replaying against changed handler code for the same version; skip-and-continue.

## Incident workflow

Detect (blocked alert) → inspect (sanitized) → assess severity → acknowledge → quarantine → request replay → independent approval → execute authorized replay → validate resolution → on repeated failure escalate to new version + rebuild → close with attributed ledger and post-incident note. Invariant failures bypass the routine path and page engineering; infrastructure outages create no durable failure and need no failure-ops action.
