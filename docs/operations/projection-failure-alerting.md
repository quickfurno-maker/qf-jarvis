# Projection Failure Alerting — Specification (QFJ-P03.07G)

**Status:** Ratified 2026-07-24 — QFJ-P03.07G.
**Owner:** Engineering.
**Relates to:** [ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md) · [projection-failure-operations.md](../architecture/projection-failure-operations.md) · [projection-failure-operations-runbook.md](./projection-failure-operations-runbook.md) · [projection-failure-queries.md](./projection-failure-queries.md)

> **This is a specification, not an integration.** QFJ-P03.07G ships **no** pager, webhook, email, or
> Slack delivery, and **no** metrics exporter. It defines the conditions, severities, windows,
> suppression rules, and operator actions so that a later, separately authorized slice can wire them to
> whatever delivery mechanism the platform adopts. Until then, the supported read paths are the
> read-only inspection CLI (`pnpm inspect:failures`) and the queries in
> [projection-failure-queries.md](./projection-failure-queries.md).

---

## 1. What this protects against

Before QFJ-P03.07G the repository had no logging, metrics, or telemetry of any kind. A production
projection could exhaust its five retries, block on a poison event, and stop processing every
subsequent event indefinitely — and nothing anywhere would say so. The worker kept cycling, kept
returning `blocked-existing`, and kept exiting 0.

Two conditions matter more than the rest, because they persist **nothing**:

- a **divergence** (the checkpoint↔failure biconditional broken) rolls its transaction back, and
- an **unknown COMMIT outcome** may or may not have landed.

For both, the log line and the counter are the only record that they ever happened. That is why they
are the only two `critical` events in the contract, and why neither is ever suppressed below `critical`.

---

## 2. Ratified recovery objectives

These were open in the runbook (“targets to ratify in QFJ-P03.07G”) and are now fixed.

| Objective                             | Target                                                            |
| ------------------------------------- | ----------------------------------------------------------------- |
| Blocked-projection detection          | Immediate — **under 2 minutes**                                   |
| Initial acknowledgement               | **Within 15 minutes**                                             |
| Detailed triage                       | **Within 30 minutes**                                             |
| Replay-or-quarantine decision         | **Within 60 minutes**                                             |
| Divergence escalation                 | Immediate — **within 5 minutes**                                  |
| Commit-outcome-unknown response       | Immediate — **within 5 minutes**                                  |
| Oldest active failure alert threshold | **60 minutes**                                                    |
| Worker no-progress alert              | **15 minutes**                                                    |
| Backlog-growth alert                  | Sustained **30 minutes**                                          |
| No silent data loss                   | Every failed position is resolved or governed — **never skipped** |

---

## 3. Counter semantics — read this before writing a rule

Metrics split into two durability classes, and **an alert written against the wrong class is broken**:

- **Process-local counters** (`*_total`, histograms) start at zero and **reset when the worker
  restarts**. Alert on `rate()` or a delta window — **never** an absolute value. An absolute-value
  rule would silently break at every deploy.
- **Derived gauges** (`projection_blocked_checkpoints`, `projection_active_failures`,
  `projection_oldest_active_failure_age_seconds`, `projection_checkpoint_lag_positions`) are read
  from PostgreSQL, so they survive a restart and are correct on the first refresh. Alert on absolute
  values.

**Every condition here is level-triggered by nature** — a block persists until an operator acts, and a
divergence recurs on every cycle. So **every rule must be edge-triggered or deduplicated** on the key
given below. Level-triggered alerting on a blocked projection would page continuously for the whole
incident.

---

## 4. Alert rules

### A1 — Any blocked projection · **CRITICAL**

|                |                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Condition**  | `projection_blocked_checkpoints > 0`                                                                                                                                                                                                     |
| **Window**     | Immediate — must fire **under 2 minutes** from the block                                                                                                                                                                                 |
| **Dedupe key** | `(projection_name, projection_version)`; one alert until cleared                                                                                                                                                                         |
| **Signals**    | Gauge above; log `projection.blocked`, `projection.retry.exhausted`, `projection.failure.created`                                                                                                                                        |
| **Action**     | Open an incident. Follow the runbook: detect → inspect → assess → acknowledge (15 min) → triage (30 min) → decide (60 min). A production projection is **not processing events**, and its backlog grows for as long as it stays blocked. |

The transition events fire on `blocked-now` only. `blocked-existing` — the steady state re-observed on
every cycle — emits nothing and increments nothing, which is what keeps this alert a single event
rather than a stream.

### A2 — Oldest active failure beyond SLA · **HIGH**

|                |                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Condition**  | `projection_oldest_active_failure_age_seconds > 3600` (**60 minutes**)                                                            |
| **Window**     | Sustained **15 minutes**                                                                                                          |
| **Dedupe key** | `(projection_name, projection_version)`, once per SLA period                                                                      |
| **Action**     | Escalate triage. The failure is aging without an operator decision; the 60-minute replay-or-quarantine objective has been missed. |

### A3 — Replay failure · **HIGH**

|                |                                                                                                                                                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Condition**  | `increase(projection_replay_attempts_total{attempt_state="failed"}) > 0`                                                                                                                                                                                                                                                          |
| **Window**     | **5 minutes**                                                                                                                                                                                                                                                                                                                     |
| **Dedupe key** | `(projection_name, projection_version)`                                                                                                                                                                                                                                                                                           |
| **Action**     | Runbook “repeated replay failure”. A **first** failure may be environmental; a **second** means the handler is genuinely wrong for this event, and the answer is a code fix plus a projection version bump and rebuild — not another replay. The checkpoint stays blocked either way, and the one-shot authorization is consumed. |

### A4 — Repeated infrastructure errors · **HIGH**

|                |                                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Condition**  | `rate(projection_infrastructure_failures_total[10m]) > 0.05/s` — see the threshold note below                                                                                                                                                                   |
| **Window**     | Sustained **10 minutes**                                                                                                                                                                                                                                        |
| **Dedupe key** | `(projection_name, projection_version, runner_error_code)`                                                                                                                                                                                                      |
| **Action**     | Treat as an **outage**, not a projection defect. **Do not quarantine and do not replay**: an infrastructure failure records _nothing_ — no attempt, no failure aggregate — so there is nothing to act on. Fix the infrastructure; the runner resumes by itself. |

**Threshold derivation.** The worker's bounded poll interval means a persistently failing projection
produces roughly one infrastructure failure per cycle. At the default cadence that is on the order of
one every few seconds, so a sustained rate above **0.05 failures/second (≈3/minute)** over 10 minutes is
well clear of an isolated transient (which recovers within one or two cycles) and well below a real
outage's steady rate. Tune per environment once the actual poll interval is fixed in deployment
configuration; the shape of the rule — _a sustained rate, never a single occurrence_ — is the part that
must not change.

### A5 — Commit outcome unknown · **CRITICAL**

|                |                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Condition**  | `increase(projection_commit_outcome_unknown_total) > 0`                                                                                                                                                                                                                                                 |
| **Window**     | Immediate; respond **within 5 minutes**                                                                                                                                                                                                                                                                 |
| **Dedupe key** | **None — never suppress, never downgrade**                                                                                                                                                                                                                                                              |
| **Action**     | The write may or may not have landed. **Re-invoke to observe the durable state; never blind-retry the write.** The next invocation establishes the truth and emits the correct terminal event. For a replay, use `reconcileProjectionReplayOutcome` — it reports the durable outcome and never repairs. |

### A6 — Divergence · **CRITICAL**

|                |                                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Condition**  | `increase(projection_divergence_total) > 0`                                                                                                                                                                                                                                                      |
| **Window**     | Immediate; escalate **within 5 minutes**                                                                                                                                                                                                                                                         |
| **Dedupe key** | `(projection_name, projection_version, divergence_kind)` per incident                                                                                                                                                                                                                            |
| **Action**     | **STOP. Escalate to engineering.** Do not repair, do not replay, do not quarantine, do not touch the database. This is ADR-0040's fail-closed reconciliation mismatch. The transaction rolled back and persisted nothing, so the log line and this counter are the only evidence — capture both. |

The bounded `divergence_kind` says which invariant broke:
`blocked-checkpoint-without-active-failure`, `blocked-checkpoint-with-multiple-active-failures`,
`active-failure-position-mismatch`, `attempt-count-mismatch`, `missing-event-at-position`.

The logger emits the **first** observation per key at full severity and rate-limits repeats for five
minutes, because a polling worker re-observes a divergence every cycle and would otherwise flood.

### A7 — Worker not making progress · **HIGH**

|                |                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Condition**  | `projection_worker_up == 1` **AND** `rate(projection_attempts_total{outcome="succeeded"}) == 0` **AND** `projection_checkpoint_lag_positions > 0` |
| **Window**     | Sustained **15 minutes**                                                                                                                          |
| **Dedupe key** | `(projection_name, projection_version)`                                                                                                           |
| **Action**     | Investigate a stall: lock contention, a wedged handler, or an exhausted pool.                                                                     |

**All three clauses are required.** Zero successes alone is completely normal — a caught-up projection
succeeds nothing, forever. Only zero successes _with a positive backlog_ means work exists and is not
being done.

### A8 — Backlog / checkpoint lag growth · **MEDIUM**

|                |                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Condition**  | `projection_checkpoint_lag_positions` strictly increasing over the window **AND** above an absolute floor                 |
| **Window**     | Sustained **30 minutes**                                                                                                  |
| **Dedupe key** | `(projection_name, projection_version)`                                                                                   |
| **Action**     | Capacity or blockage investigation. If A1 is also firing the block is the cause and this is a symptom — resolve A1 first. |

### A9 — Migration mismatch or schema unavailable · **CRITICAL**

|                |                                                                                                                                                                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Condition**  | The startup schema probe finds any required relation absent                                                                                                                                                                                                                                                             |
| **Window**     | Immediate, at startup                                                                                                                                                                                                                                                                                                   |
| **Dedupe key** | Per process start                                                                                                                                                                                                                                                                                                       |
| **Action**     | **The worker refuses to start** and exits non-zero (this is the one health condition that blocks startup). Apply the outstanding migrations. Running without migration 0006's relations would mean processing events with a silently broken failure path — the retry-exhaustion seam could not record a failure at all. |

> **This condition currently holds in the managed environment.** Managed PostgreSQL is at migration
> **0001**; migrations **0002–0006 are unapplied and not deployed**. The managed migration lane is
> **paused** and the `qf_jarvis_migrator` password is unresolved. Everything in this document is
> implemented and exercised in local/CI and is **not** active in managed.

### A10 — Operational command misuse · **MEDIUM**

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Condition**  | Authorization denials from the E/F authorizer contracts, or a mutating attempt through the read-only CLI |
| **Window**     | **5 minutes**                                                                                            |
| **Dedupe key** | `(actor_type, capability)`                                                                               |
| **Action**     | Review the append-only action ledger, which is the authority. This alert is only the prompt to look.     |

---

## 5. Signal inventory

### Metrics

| Metric                                         | Kind      | Durability  | Labels                                  |
| ---------------------------------------------- | --------- | ----------- | --------------------------------------- |
| `projection_attempts_total`                    | counter   | process     | name, version, outcome                  |
| `projection_deterministic_failures_total`      | counter   | process     | name, version, safe_error_code          |
| `projection_infrastructure_failures_total`     | counter   | process     | name, version, runner_error_code, phase |
| `projection_retry_exhaustion_total`            | counter   | process     | name, version                           |
| `projection_failures_created_total`            | counter   | process     | name, version, category                 |
| `projection_divergence_total`                  | counter   | process     | name, version, divergence_kind          |
| `projection_commit_outcome_unknown_total`      | counter   | process     | name, version                           |
| `projection_replay_attempts_total`             | counter   | process     | name, version, attempt_state            |
| `projection_replay_authorizations_total`       | counter   | process     | name, version, authorization_state      |
| `projection_replay_lease_conflicts_total`      | counter   | process     | name, version                           |
| `projection_worker_cycles_total`               | counter   | process     | outcome                                 |
| `projection_blocked_checkpoints`               | gauge     | **derived** | name, version                           |
| `projection_active_failures`                   | gauge     | **derived** | name, version, status                   |
| `projection_oldest_active_failure_age_seconds` | gauge     | **derived** | name, version                           |
| `projection_checkpoint_lag_positions`          | gauge     | **derived** | name, version                           |
| `projection_worker_up`                         | gauge     | process     | —                                       |
| `projection_processing_duration_seconds`       | histogram | process     | name, version, outcome                  |
| `projection_retry_backoff_seconds`             | histogram | process     | name, version                           |

**The label vocabulary is closed and enforced by the type system.** The only permitted keys are
`projection_name`, `projection_version`, `outcome`, `category`, `safe_error_code`, `status`,
`attempt_state`, `authorization_state`, `runner_error_code`, `divergence_kind`, `phase`.

### Log events

`projection.retry.scheduled` · `projection.retry.exhausted` · `projection.blocked` ·
`projection.failure.created` · `projection.failure.acknowledged` · `projection.failure.quarantined` ·
`projection.replay.authorized` · `projection.replay.lease.acquired` ·
`projection.replay.lease.takenOver` · `projection.replay.started` · `projection.replay.succeeded` ·
`projection.replay.failed` · `projection.divergence.detected` · `projection.infrastructure.failed` ·
`projection.commit.outcomeUnknown` · `projection.worker.cycle` · `projection.worker.started` ·
`projection.worker.stopped`

Severity is a property of the **event**, not of the call site, so the same event can never be logged at
two severities by two callers.

---

## 6. Redaction rules — binding on every rule and dashboard built from this

**Never** in a log field, a metric label, or CLI output:

event payload · subject · raw metadata · raw exception message · stack · cause · SQL · SQLSTATE ·
connection string · host · username · password · token · certificate path or contents · **operator
free-text reason** · sender-supplied correlation/trace ids · customer data.

**Never as a metric label** (safe as log fields — a log line is not indexed by its fields, a label
creates a permanent time series per distinct value):

`position` · `blocked_position` · `event_storage_sequence` · `failure_id` · `authorization_id` ·
`attempt_id` · `event_id` · `actor_id`.

**Event type** is sender-influenced and is therefore omitted entirely rather than bounded — and it is
never a label under any circumstances.

The operator's free-text reason is persisted in the action ledger **for audit** and is the one
unbounded operator-supplied string in the lifecycle. It must never become log output or CLI output.

---

## 7. Explicit non-goals of QFJ-P03.07G

- No metrics **exporter** (Prometheus endpoint, OTLP, StatsD) and no network egress.
- No **alert delivery** — pager, webhook, email, Slack.
- No dashboard UI, frontend, or hosted visualization.
- No distributed tracing.
- No log shipping, aggregation, or retention infrastructure.
- No **mutating** operator CLI.
- No change to runner, checkpoint, ordering, lock, retry, taxonomy, or D/E/F behaviour.
