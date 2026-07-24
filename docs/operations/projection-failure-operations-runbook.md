# Projection Failure Operations — Operator Runbook

**Status:** Operational (QFJ-P03.07G, 2026-07-24). Adopted under [ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md).
**Read with:** [projection-failure-operations.md](../architecture/projection-failure-operations.md) · [projection-failure-alerting.md](./projection-failure-alerting.md) · [projection-failure-queries.md](./projection-failure-queries.md)

> **Scope of what exists.** QFJ-P03.07A–G are merged. Retry exhaustion, the durable failure aggregate,
> inspection, acknowledge, quarantine, authorized replay, lease takeover, reconciliation, and
> observability are all **implemented**. The **read** half of the operator surface is available as a
> CLI (`pnpm inspect:failures`); the **mutating** half — acknowledge, quarantine, authorize, execute —
> is available only through the **internal application boundary**, which requires an authenticated,
> attributed caller. There is deliberately no mutating shell command (§ _Why there is no mutating
> CLI_).
>
> **Managed deployment is paused and this is not live in production.** Managed PostgreSQL is at
> migration **0001**; migrations **0002–0006 are unapplied and not deployed**; the `qf_jarvis_migrator`
> password is unresolved; no migration retry is authorized. Everything below is exercised in local and
> CI. Repository completeness is **not** production readiness.

---

## Roles

| Role                   | May do                                                                      | May not do                           |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| **READ_ONLY_OPERATOR** | Inspect status, metadata, sanitized diagnostics. The CLI runs as this role. | Any state change.                    |
| **FAILURE_OPERATOR**   | Acknowledge, quarantine, request replay.                                    | Approve their own replay.            |
| **REPLAY_APPROVER**    | Approve one bounded replay (reason required).                               | Be the same person as the requester. |
| **SYSTEM_RUNNER**      | Execute a valid authorized replay.                                          | Self-authorize.                      |
| **ADMINISTRATOR**      | Retire/supersede a projection version through separate governance.          | Edit events or checkpoints directly. |

Capabilities are closed: `projection-failure:inspect` · `:acknowledge` · `:quarantine` ·
`:authorize-replay` · `:execute-replay` · `:take-over-replay`.

---

## Recovery objectives (ratified)

| Objective                             | Target                                                            |
| ------------------------------------- | ----------------------------------------------------------------- |
| Blocked-projection detection          | Immediate — under **2 minutes**                                   |
| Initial acknowledgement               | Within **15 minutes**                                             |
| Detailed triage                       | Within **30 minutes**                                             |
| Replay-or-quarantine decision         | Within **60 minutes**                                             |
| Divergence escalation                 | Immediate — within **5 minutes**                                  |
| Commit-outcome-unknown response       | Immediate — within **5 minutes**                                  |
| Oldest-active-failure alert threshold | **60 minutes**                                                    |
| Worker no-progress alert              | **15 minutes**                                                    |
| Backlog-growth alert                  | Sustained **30 minutes**                                          |
| No silent data loss                   | Every failed position is resolved or governed — **never skipped** |

---

## 1. Symptoms

| You see                                                                                | Meaning                                                                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Alert **A1**, `projection_blocked_checkpoints > 0`                                     | A projection is halted on a poison event and is processing nothing further. |
| Log `projection.blocked` / `projection.retry.exhausted` / `projection.failure.created` | The transition just happened (fires once, not per cycle).                   |
| Alert **A6**, `projection.divergence.detected`                                         | **Stop.** Fail-closed invariant break — § _Divergence handling_.            |
| Alert **A5**, `projection.commit.outcomeUnknown`                                       | Ambiguous write — § _Commit-outcome-unknown handling_.                      |
| Alert **A4**, rising `projection_infrastructure_failures_total`                        | An **outage**, not a projection defect — § _Infrastructure distinction_.    |
| Alert **A7/A8**, lag rising with no successes                                          | Stall or backlog.                                                           |
| `pnpm inspect:failures list` exits **10**                                              | Blocked or active failures exist.                                           |
| `pnpm inspect:failures list` exits **20**                                              | Divergence detected.                                                        |

## 2. Diagnosis

```
pnpm inspect:failures list                          # what is blocked, health summary
pnpm inspect:failures inspect --failure-id <uuid>   # one failure, sanitized detail
pnpm inspect:failures history --failure-id <uuid>   # the append-only action ledger
pnpm inspect:failures divergence                    # the fail-closed divergence sweep
```

Exit codes: `0` clean · `10` findings · `20` divergence · `30` configuration/schema mismatch ·
`40` operational failure. Add `--json` for machine-readable output; `--limit <n>` bounds the page.

For shapes the CLI does not produce, use the read-only SQL in
[projection-failure-queries.md](./projection-failure-queries.md). **Never mutate.**

**Classify before acting:**

- **Deterministic handler failure** (`projection-handler-failed`) at exhaustion → the normal path below.
- **Divergence** (`projection-attempt-checkpoint-divergent`) → escalate, do not act.
- **Infrastructure pattern** (many transient aborts, _no_ durable failure) → outage, not failure-ops.

## 3. Safe inspection

Inspection is read-only and never exposes an event payload, subject, metadata value, raw message,
stack, SQL, SQLSTATE, or secret. What you get: name, version, position, category, closed safe code,
status, generation, attempt counts, checkpoint correlation, divergence codes, action count, and whether
an active authorization or live attempt exists.

The operator **free-text reason** is persisted in the ledger for audit and is deliberately **not**
printed by the CLI. Read it only inside a formal audit.

## 4. Acknowledgement — _within 15 minutes_

Records that a human has reviewed the failure. `open → acknowledged`.

Invoked through the internal boundary as a FAILURE_OPERATOR with a reason and the current
`generation`. Authorized, generation-guarded, idempotent, atomic (transition + exactly one
`acknowledged` action in one transaction).

It does **not** permit replay, resolve anything, or move the checkpoint.

## 5. Quarantine — _decide within 60 minutes_

Isolates the position for controlled handling. `open`/`acknowledged → quarantined`.

Additionally **gated on the fail-closed divergence detector**: if any divergence is present the
quarantine is refused. Preserves the blocked checkpoint, the blocked position, `last_position`, every
attempt, and the full action history.

**Quarantine is the prerequisite for replay.** A replay never happens merely because a failure is
quarantined.

## 6. Replay authorization — four-eyes

`quarantined → replay-authorized`, performed by a **REPLAY_APPROVER who is not the requester**.

Generation-guarded, divergence-gated, at most one active authorization per failure, with a bounded
future expiry (≤ 24h). The checkpoint stays blocked and no handler runs. One atomic transaction:
authorization row + status transition + one `replay-authorized` action.

## 7. Replay execution — one shot

Executed by the SYSTEM_RUNNER, never by hand. It claims exactly one lease-protected `started` attempt
(lease ≤ 1h) under the name+version advisory lock, moves the failure to `replaying`, and applies the
**registered** production handler to the **exact** blocked event. No payload substitution, no handler
substitution, no scheduler, no bulk replay.

## 8. Resolving a successful replay

On success, one transaction atomically: applies the read model · **resumes the checkpoint by exactly
one position** · succeeds the attempt · resolves the failure · consumes the authorization · appends
evidence.

Verify: status `resolved`, a successful attempt reference, `last_position` advanced by exactly one, the
authorization consumed, lag falling, and `projection_blocked_checkpoints` cleared for that projection.

**Checkpoint resumption is the only transition out of `blocked`.** There is no skip.

## 9. Failed replay handling

A deterministic replay failure records a `failed` attempt, consumes the one-shot authorization, and
returns the failure to `quarantined`. **The checkpoint stays blocked**, no read model is committed, and
there is no automatic retry. A further replay requires a **new** authorization.

**Do not loop.** A second failure on the same position means the handler is genuinely wrong for this
event. Collect evidence and escalate: the fix is a code change plus a **new projection version and
rebuild** (QFJ-P03.08), not another replay against the same version.

## 10. Divergence handling — **STOP**

A divergence means the checkpoint↔failure biconditional is broken. The bounded kind is one of:

`blocked-checkpoint-without-active-failure` · `blocked-checkpoint-with-multiple-active-failures` ·
`active-failure-position-mismatch` · `attempt-count-mismatch` · `missing-event-at-position`

**Do not** acknowledge, quarantine, authorize, replay, or run any SQL mutation. Page engineering
immediately (**within 5 minutes**); treat as potential data-integrity corruption; preserve state.

The divergent transaction **rolled back and persisted nothing**, so the emitted log line and
`projection_divergence_total` are the only record — capture both, plus the query-10 output. The logger
emits the first observation at `critical` and rate-limits repeats, so the absence of repeated lines does
**not** mean the condition cleared.

## 11. Commit-outcome-unknown handling

The write may or may not have landed. **Re-invoke to observe the durable state. Never blind-retry the
write.** The next invocation establishes the truth and emits the correct terminal event. For a replay,
use `reconcileProjectionReplayOutcome`, which reports the durable failure/attempt/authorization/
checkpoint state and **never repairs**.

Never suppressed and never downgraded below `critical`.

## 12. Infrastructure distinction

Transient infrastructure failures (deadlock/serialization `40P01`/`40001`, connectivity `08*`,
`57P0*`, `53*`) create **no** durable failure and need **no** failure-ops action. They resolve when the
database recovers.

**Do not manufacture a failure record or a replay for an outage.** There is nothing to act on: no
attempt was recorded and no aggregate was created.

## 13. Rollback and containment

- Every failure and replay path is **transactional**. A rollback leaves no partial resolution.
- The exhaustion transaction commits **five effects together or none**: final attempt + blocked
  checkpoint + blocked position + exactly one active failure + creation action.
- The ledgers are **append-only** — `UPDATE`/`DELETE` are refused by trigger. There is no runtime
  delete.
- A poison event blocks **one** name+version. It must not affect any other projection, the event log,
  the position map, or unrelated workers.
- A blocked projection does **not** fail process liveness, process readiness, or deployment health. It
  reports **degraded** projection health. Restart-looping the worker on a block would take down every
  other healthy projection in the process.
- The worker **refuses to start** if the projection-failure schema is incomplete — the one health
  condition that blocks startup, because the exhaustion seam could not record a failure at all.

## 14. Escalation

Page engineering immediately for: any divergence, any commit-outcome-unknown, a second replay failure
on the same position, or any suspicion of data-integrity corruption. Retiring or superseding a
projection version is an ADMINISTRATOR action through separate governance — never failure-ops, never a
claim that the event was processed, and never a checkpoint advance.

## 15. Audit evidence

**The append-only action ledger (`projection_failure_action`) is authoritative.** Logs are
**at-least-once** evidence: a crash between COMMIT and emission loses a line, and a retry after an
ambiguous commit may duplicate one. Never reconstruct a lifecycle from logs alone.

Capture for any escalation: failure id · name/version/position · category and closed safe code ·
attempt history · the action ledger · alert and metric timestamps · CLI output. **Never copy raw
payloads, subjects, operator free text, or secrets.**

## Why there is no mutating CLI

Three reasons, none of them effort:

1. The E/F operations require an authorizer context with closed capabilities and an **attributed actor
   identity**. A shell has no authenticated principal; adding one would mean inventing an
   authentication model inside an observability slice.
2. Replay is designed around **four-eyes approval**. A local shell command trivially defeats it.
3. ADR-0040 places operator authority behind an **application/command boundary**. A CLI is not that
   boundary.

Mutating operator tooling is legitimate future work with its own authorization design.

## Prohibited operator actions

- Editing event payload, identity, or position.
- Direct SQL mutation of checkpoints, failures, authorizations, attempts, or audit rows.
- **Repairing a divergence by hand.**
- Advancing or resetting a checkpoint manually, or after quarantine.
- **Skipping a failed event to "continue."**
- Resetting the retry counter, or forcing a sixth automatic attempt.
- **Blind-retrying after an ambiguous COMMIT** instead of reconciling.
- Marking a failure resolved without a proven-successful replay.
- Reusing an authorization across projections, versions, positions, or generations.
- Replaying against changed handler code for the same production version (use a new version + rebuild).
- Clearing a replay lease by hand instead of using the expired-lease takeover.
- Running the query document's SQL against managed PostgreSQL while that lane is paused.

## Known operational limitations (QFJ-P03.07G)

- **No metrics exporter.** Metrics are process-local and in-memory; the CLI and its exit codes are the
  supported external read path.
- **No alert delivery.** [projection-failure-alerting.md](./projection-failure-alerting.md) is a
  specification; wiring it to a pager/webhook is separate work.
- **No mutating CLI.** Acknowledge, quarantine, authorize and execute need a programmatic authorized
  caller.
- **`retired` has no automated producer.** Retirement is escalation-only, through governance.
- **Divergence and commit-outcome-unknown persist nothing.** Logs and counters are their only trace.
- **None of this is active in the managed environment.** The managed migration lane and the
  password-rotation lane both remain paused.
