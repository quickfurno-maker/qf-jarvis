# Report 02 — Architecture and Security

**Date:** 2026-07-24.

## 1. Telemetry is never a correctness dependency

The governing principle, and the one that decided every other question: **a throwing logger, a full
metrics registry, or a blocked sink must never change a durable outcome.**

Three mechanisms enforce it, and they are layered deliberately:

**Emission happens only after the transaction resolves.** Every runner emission is at a single boundary
in `runProjectionOnce`, reached only after `executeRun` has returned — which happens only after a
confirmed `COMMIT` or a confirmed clean `ROLLBACK`. An emission _inside_ the transaction that threw
would propagate into the runner's own error handling and could abort a transaction that was otherwise
about to commit correctly. That is telemetry causing data loss, and it must be structurally impossible
rather than merely avoided by convention.

Keeping all emission at one boundary is why `executeRun` **records** facts into a `RunTelemetry` value
but never emits: a new fail-closed branch added later cannot accidentally introduce an in-transaction
log line, because there is no logger in scope there.

**Every call site is guarded.** Each emitter is wrapped in a bindingless `catch`. The caught value is
never read, stringified, or retained.

**The primitives themselves cannot throw.** `createProjectionLogger` swallows sink and clock failures;
the metrics registry drops a rejected sample and counts it via `rejectedSamples()` rather than throwing.
Call sites are already guarded, but a registry that _can_ throw is one refactor away from aborting a
transaction.

### The one ordering complication

The failure aggregate's id is generated **inside** the exhaustion transaction and is needed by three
post-commit events. It is therefore **carried out** of the transaction rather than re-queried:
`establishRetryExhaustionFailure` now also returns its `generation`, and the runner captures both.

Re-reading after the commit would race a concurrent operator action and could report a generation the
creating transaction never saw. A test asserts all three events carry the same id.

### Outbox semantics rejected

An outbox would require a new table (contradicting the no-migration decision), put telemetry writes
_inside_ the correctness transaction (contradicting the rule above), let a telemetry failure roll back a
projection block, and add a drain worker with its own failure modes.

It is also unnecessary. The append-only action ledger in migration 0006 **already** provides durable,
exactly-once, attributable evidence for every lifecycle transition that matters. Logs and metrics are a
real-time convenience layer over an authoritative durable record that already exists. That is the
correct architecture, and it needs no outbox.

## 2. Closed vocabularies, not field bags

A logger accepting `Record<string, unknown>` would hand back exactly the leak the rest of the subsystem
works to prevent — the runner uses bindingless catches precisely so a thrown value is never retained,
and one `logger.info('failed', { error })` would undo that across the whole subsystem.

So there is no field bag. Every event is a variant of a discriminated union with an exact field shape,
and **severity is not a caller argument at all** — it is looked up from a frozen per-event map, so the
same event can never be logged at two severities by two call sites.

`critical` is reserved for exactly two events, and the reservation is tested: **divergence** and
**commit-outcome-unknown**. Both persist _nothing_ — the transaction rolls back, or its outcome is
unknowable — so the log line and the counter are their only trace. That is what makes them the only
conditions where "a human must look now" is unconditionally true.

### Fields are projected, not spread

The record written to the sink is built by an explicit per-event projection. The type system already
constrains the shape, but a structurally-typed object can carry extra properties at runtime, and a
spread would faithfully serialise whatever a future caller attached — a raw error, a payload fragment,
an operator's free text. A test passes a hostile object carrying `payload`, `stack`, `sql`, and
`message` past the type system and asserts none of it reaches the sink.

## 3. Cardinality closure is a type, not a review item

The fastest way to destroy a metrics system is a label whose value space is unbounded. A `position`, a
`failure_id`, an `actor_id` are all **safe log fields** (a log line is not indexed by its fields) and
all **catastrophic labels** (every distinct value creates a permanent time series). Expecting reviewers
to hold that distinction reliably does not scale.

So each metric declares its exact label shape in `ProjectionMetricLabels`, and the mutation methods are
generic over the metric name. An unknown label key, a missing required one, or a value outside a closed
vocabulary is a **compile error**, and TypeScript's excess-property check rejects `failure_id` at the
call site. Runtime validation backs this up for values crossing a boundary the compiler cannot see, and
`MAX_SERIES_PER_METRIC` (512) is a defensive cap so that even a defect upstream cannot grow the registry
without bound inside a long-running worker.

## 4. Durability split — and why alerting depends on it

- **Process-local** (counters, histograms): reset on restart. Alert on `rate()`/deltas, never absolute
  values — an absolute-value rule would silently break at every deploy.
- **Derived** (`projection_blocked_checkpoints`, `projection_active_failures`,
  `projection_oldest_active_failure_age_seconds`, `projection_checkpoint_lag_positions`): read from
  PostgreSQL, so a restarted worker reports the true blocked set on its first refresh.

Derived gauges use `replaceGauge`, not `setGauge`. A projection that is no longer blocked must have its
series **removed**, not left frozen at its last value — a stale `1` would keep the critical
blocked-projection alert firing after the incident closed. Both the unit and integration suites assert
the clearing behaviour.

## 5. Transition, not steady state

`blocked-existing` emits **no** event and increments **no** counter. It is the steady state re-observed
on every worker cycle for as long as a projection stays blocked; counting it would grow the exhaustion
counter without bound on an unattended projection and turn a single incident into a stream of alerts.

Only `blocked-now` — the transition — emits `projection.retry.exhausted`, `projection.blocked`, and
`projection.failure.created`. Two tests cover this, one of them looping five invocations to assert the
counters stay flat.

Divergence needs the same treatment for a different reason: it recurs every cycle _and_ persists
nothing, so the first observation must never be dropped. The logger emits the first at `critical` per
`(name, version, kind)` and rate-limits repeats for five minutes.

## 6. Health decision

**A blocked projection does not affect process liveness, process readiness, or deployment health.** It
degrades a separate projection-health status, and nothing more.

The reasoning is not stylistic. A block is a correct, deliberate, durable state, not a fault. Failing
liveness would make an orchestrator restart the worker; every restart would re-observe the same block
and restart again — converting a contained single-projection halt into a crash loop that also stops
every _other_ healthy projection in the process. That directly violates the ADR-0040 containment
invariant that a poison event must not affect unrelated projections. Readiness adds a second reason: the
worker serves no traffic. Deployment health adds a third: a pre-existing block must never fail an
unrelated release.

`evaluateProjectionHealth` therefore returns `processLive`/`processReady`/`deploymentHealthy` as
invariants, never derived from the blocked count, and tests assert that.

**The one exception that does block startup** is an incomplete projection-failure schema. Without
migration 0006's relations the retry-exhaustion seam cannot record a failure at all, so running would
mean processing events with a silently broken failure path. The worker refuses to start, writes a fixed
line naming no relation and no connection detail, and exits non-zero. A probe that _throws_ is treated
identically to one reporting an incomplete schema.

## 7. Security and redaction

**Never emitted anywhere** — log field, metric label, or CLI output: event payload · subject · raw
metadata · raw exception message · stack · cause · SQL · SQLSTATE · connection string · host · username
· password · token · certificate path or contents · **operator free-text reason** · sender-supplied
correlation/trace ids · customer data.

**Never as a metric label** (safe as log fields): `position` · `blocked_position` ·
`event_storage_sequence` · `failure_id` · `authorization_id` · `attempt_id` · `event_id` · `actor_id`.

**Event type is omitted entirely.** The design document's logging line lists it unqualified; it is
sender-influenced and unbounded, so this slice deliberately does not emit it. That is a refinement of a
prose line, not a reversal of a decision, and it is recorded here as an explicit choice.

**The existing fail-closed discipline is preserved.** The runner and worker use bindingless catches so a
thrown value cannot be read. The most natural way to write a "better" log line is to capture the error —
which would silently undo that property across the entire subsystem. Diagnostics therefore come only
from the closed classification the taxonomy already produces: a `runner_error_code`, a bounded
`phase` saying _where_ in the transaction protocol a fault surfaced, and a closed `divergence_kind`
read from a typed field rather than parsed from a message.

The divergence kind required one additive change: `ProjectionDivergenceError` **extends**
`ProjectionCheckpointInvalidError`, so every existing `instanceof` check — including the runner's two
error-mapping branches — matches exactly as before. Classification, fail-closed behaviour, and the
resulting runner error code are unchanged.

The redaction test asserts on **full serialised output** rather than selected fields. Checking
`record.payload === undefined` would pass even if a payload had been concatenated into another field;
searching the emitted bytes cannot be fooled that way.

## 8. Operator surface

E and F delivered a complete operator surface as internal TypeScript API. An operator holding a
production incident had no way to invoke any of it without writing a program. G closes the **read** half.

**There is deliberately no mutating subcommand**, for three reasons, none of them effort:

1. The E/F operations require an authorizer context with closed capabilities and an **attributed actor
   identity**. A shell has no authenticated principal; adding one would mean inventing an authentication
   model inside an observability slice.
2. Replay is designed around **four-eyes approval**. A local shell command trivially defeats it.
3. ADR-0040 places operator authority behind an **application/command boundary**. A CLI is not that
   boundary.

The command table is the enforcement point, and a test asserts no mutating verb parses.

The injected authorizer grants exactly one capability — `projection-failure:inspect` — acting as the
`read-only-operator` actor type ADR-0040 already defines. Nothing is invented.

Bounded exit codes (`0`/`10`/`20`/`30`/`40`) are the machine-readable half: with no exporter in this
slice, `list` used as a probe is the supported way for external tooling to learn something is blocked.
The schema probe runs **before** the command, so a database whose migrations are behind reports exit 30
rather than an empty result set that reads as "nothing is wrong".

## 9. API containment

The package-root runtime surface remains **exactly 39 symbols**, unchanged. Not one of them is a
projection symbol; the entire projections subsystem was already internal and stays that way.

The inspection CLI is reachable only through `./internal/projection-inspection-cli`, mirroring the
existing worker-CLI precedent. Two pre-existing export-map tests were updated to the new three-entry set
while keeping their intent intact: no wildcard, and nothing reaching persistence or the migration
runner. A new test additionally asserts the CLI module re-exports none of the E/F mutating operations.

## 10. Database impact

**No schema change. No modification to migrations 0001–0006. No migration 0007.**

Every metric and operator view is answerable from existing tables. The two indexes QFJ-P03.07C created
as "operator-queue and runner-lookup helpers" —
`projection_failure_by_projection (name, version, status)` and
`projection_failure_by_status_created (status, created_at)` — are exactly the indexes these queries
need. The active-failure predicate is character-for-character the predicate of the partial unique index
`projection_failure_active_unique`, kept as one constant so the two cannot drift.
