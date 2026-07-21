# Report 02 — Failure Taxonomy, Invariants and Lifecycle

**Date:** 2026-07-21. **Purpose:** The verified failure taxonomy, the strict-ordering/checkpoint invariants, and the durable lifecycle for QFJ-P03.07. Authoritative source: [projection-failure-operations.md](../../architecture/projection-failure-operations.md), [ADR-0040](../../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md).

## Classification decision table (verified against the runner)

| Signal                                                           | Category                    | Deterministic? | Consumes attempt? | Durable failure on exhaustion? | Runner code                               |
| ---------------------------------------------------------------- | --------------------------- | -------------- | ----------------- | ------------------------------ | ----------------------------------------- |
| Absent SQLSTATE (ordinary error/primitive)                       | Deterministic handler       | Yes            | Yes               | Yes (5th)                      | `projection-handler-failed`               |
| `23505/23514/23503/23502/22*/42501/42P01/42703/42883`            | Deterministic handler       | Yes            | Yes               | Yes (5th)                      | `projection-handler-failed`               |
| `40P01`, `40001`, class `08`, `57P0*`, class `53`                | Transient infrastructure    | No             | No                | No                             | `projection-infrastructure-failed`        |
| Any other valid SQLSTATE                                         | Conservative infrastructure | No             | No                | No                             | `projection-infrastructure-failed`        |
| Invalid/unreadable code (accessor, proxy, non-string, malformed) | Conservative infrastructure | No             | No                | No                             | `projection-infrastructure-failed`        |
| Reconciliation divergence / missing checkpoint / malformed row   | Repository invariant        | Invariant      | No                | No (stop + alert)              | `projection-attempt-checkpoint-divergent` |
| Unknown COMMIT outcome                                           | Infrastructure (ambiguous)  | No             | No                | No                             | `projection-commit-outcome-unknown`       |
| Cancellation / shutdown                                          | Controlled                  | No             | No                | No                             | (worker drains; no code)                  |

**Correction/confirmation vs the prompt's expected taxonomy:** the runtime does **not** use an explicit transient-SQLSTATE allowlist; it uses a **deterministic-handler allowlist** and treats everything else (including the listed transient codes) as **conservative infrastructure**. The end behaviour for transient/infra matches the intended taxonomy (→ no durable failure).

**UNKNOWN_UNCLASSIFIED correction (owned by QFJ-P03.07B).** The five target categories are `DETERMINISTIC_HANDLER_FAILURE`, `TRANSIENT_INFRASTRUCTURE_FAILURE`, `REPOSITORY_INVARIANT_FAILURE`, `CANCELLATION_OR_SHUTDOWN`, and `UNKNOWN_UNCLASSIFIED_FAILURE`. Unknown / missing-code / unreadable / hostile thrown values **must not** auto-become deterministic. Invalid/unreadable/hostile codes are **already** routed to conservative infrastructure (correct). **But the current runner classifies an absent SQLSTATE (ordinary `Error`, no `code`) as DETERMINISTIC_HANDLER_FAILURE** — so a genuinely unknown value with no code is today consumed as a bounded attempt and can drive exhaustion. This is **current runtime behaviour requiring correction in QFJ-P03.07B**: split "absent code" into a provable deterministic rejection vs `UNKNOWN_UNCLASSIFIED_FAILURE` (rollback, checkpoint unchanged, no deterministic exhaustion, fail closed, sanitized repository-owned code, operator escalation). See [projection-failure-operations.md](../../architecture/projection-failure-operations.md) § Canonical categories.

## Retryable vs non-retryable

- **Retryable (bounded, automatic):** deterministic handler failures, attempts 1–4. Not operator-visible as durable failures.
- **Non-retryable-durable (operator-visible):** the exhausted (5th) deterministic failure → one durable active failure + blocked checkpoint.
- **Non-retryable-transient (no durable record):** infrastructure, invariant, unknown-commit, cancellation — resolved by supervision/recovery, never a durable failure.

## Lifecycle

`OPEN → ACKNOWLEDGED → QUARANTINED → REPLAY_AUTHORIZED → REPLAYING → (RESOLVED | controlled re-entry)`; terminal `SUPERSEDED/RETIRED` only via governed version retirement. **No `SKIP`/`IGNORE`.** State diagram and transition table: [projection-failure-operations.md](../../architecture/projection-failure-operations.md).

### Allowed transitions

| From                     | To                       | Requester        | Approver                            |
| ------------------------ | ------------------------ | ---------------- | ----------------------------------- |
| runner                   | OPEN                     | SYSTEM_RUNNER    | —                                   |
| OPEN                     | ACKNOWLEDGED             | FAILURE_OPERATOR | self                                |
| OPEN/ACKNOWLEDGED        | QUARANTINED              | FAILURE_OPERATOR | self                                |
| QUARANTINED/ACKNOWLEDGED | REPLAY_AUTHORIZED        | FAILURE_OPERATOR | REPLAY_APPROVER (≠ requester)       |
| REPLAY_AUTHORIZED        | REPLAYING                | SYSTEM_RUNNER    | valid authorization                 |
| REPLAYING                | RESOLVED                 | SYSTEM_RUNNER    | successful handler + atomic advance |
| REPLAYING                | QUARANTINED/ACKNOWLEDGED | SYSTEM_RUNNER    | replay failed                       |
| non-terminal             | SUPERSEDED/RETIRED       | ADMINISTRATOR    | separate governance                 |

### Invalid transitions (fail closed)

OPEN→RESOLVED; any→RESOLVED without a successful replay; processing a later position while blocked; reusing a consumed authorization; applying an authorization to a different name/version/position/event/generation; manual checkpoint advance; RESOLVED→anything; retry-counter reset; skip-and-continue.

## Strict ordering

The runner reads exactly `checkpoint.last_position + 1` via the gap-free commit-ordered position map, joined to the immutable event by storage sequence. While blocked, no later position may process. Ordering is strict and unchanged.

## Checkpoint safety

Checkpoint advances **only** on a successful handler + atomic advance (normal run or successful replay). Acknowledge/quarantine/authorize never advance it. Resolution requires proof of successful processing; an operator cannot manually resolve.

**Biconditional invariant:** a `blocked` checkpoint ↔ **exactly one** matching unresolved active failure (same name, version, `blocked_position`, event identity). The exhaustion write is one transaction (append final attempt → block → set `blocked_position` → create one `OPEN` failure). Fail-closed reconciliation covers all seven divergences — blocked-without-failure, failure-without-blocked, position mismatch, event-identity mismatch, name/version mismatch, duplicate active failures, inconsistent generation/status — each stops and alerts, never auto-repairs. Full table: [projection-failure-operations.md](../../architecture/projection-failure-operations.md) § Checkpoint ↔ failure-aggregate reconciliation.

## Isolation

A poison event blocks exactly one (name, version). It must not corrupt another projection, another version, the event log, the position map, or unrelated workers. The advisory lock is derived only from name+version.

## Fail-closed rules

Ambiguous/unsafe → escalate/refuse. Unknown classification → never silently deterministic. Infrastructure/invariant → never a durable deterministic failure. Cancellation → no false failure. Stale/expired/mismatched authorization → refuse. No verified successful processing → not resolved.

## Edge cases

- **Duplicate worker at exhaustion:** advisory lock + one-active-failure-per-(name,version,position) constraint ⇒ a single durable failure.
- **Restart mid-retry:** durable checkpoint + attempt log re-derive state; reconciliation asserts consistency before any write.
- **Restart mid-replay:** authorization single-consume + advisory lock ⇒ safe recovery; no partial resolution (atomic apply+advance+resolve+consume).
- **Event missing at pending position with non-zero failures:** divergence (invariant), not caught-up.
- **Infrastructure masquerading through the handler:** SAVEPOINT rollback, no attempt consumed, abort.
- **`blocked_position` inconsistent with `last_position`/attempts:** divergence, stop + alert.
