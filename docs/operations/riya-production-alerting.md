# Riya production alerting — signal specification

**Slice:** RWC-P9 · **Decision:** [ADR-0105](../decisions/ADR-0105-rwc-p9-riya-production-hardening-and-operational-readiness.md) · **Companion:** [runbook](./riya-production-hardening-runbook.md)

This specifies **what to count and when to page**. It integrates no monitoring product: the codebase
emits closed, content-free events through injected hooks, and a deployment chooses the sink.

Every threshold below is **operator policy for pilot observation**, not a constant in the code. None
of these numbers appears in production source, and none should.

---

## 1. What the events can and cannot tell you

Every RWC-P9 event field is a closed enum or a count. There is **no** tenant, conversation, message,
subject, channel reference, digest, request id, prompt, model, provider, SQL, host, raw error or
stack — and no message text or reply.

So these signals answer _how much_ and _of what kind_. They cannot answer _which conversation_, and
that is deliberate: a telemetry stream is the least governed pipeline in a deployment, and RWC-P8
went to real trouble not to store a message or a fingerprint of one. Emitting the identifiers it
declined to store would put them there instead.

When an incident genuinely needs a specific conversation, that comes from the durable ledger under a
governed access path — not from a dashboard.

---

## 2. Counters

### Service — `RiyaConversationOperationalEvent`

| Counter                        | Source event                    | Dimensions                        |
| ------------------------------ | ------------------------------- | --------------------------------- |
| `riya.turn.admitted`           | `text-turn-admitted`            | `channel`                         |
| `riya.turn.overloaded`         | `text-turn-overloaded`          | `channel`                         |
| `riya.turn.begin_outcome`      | `text-turn-coordinator-outcome` | `channel`, `beginOutcome`         |
| `riya.turn.processing_started` | `text-turn-processing-started`  | `channel`, `phase`                |
| `riya.turn.completed`          | `text-turn-completed`           | `channel`, `phase`, `disposition` |
| `riya.turn.failed`             | `text-turn-failed`              | `channel`, `errorCode`            |

**Active-turn gauge.** Derive it in the collector as `admitted − (completed + failed)`, or read
`activeTurns` / `maxConcurrentTurns` off the admitted and overloaded events. Both are present on
exactly those two, which is enough for a utilisation ratio.

> `activeTurns` on an overload event equals the cap at the instant of refusal. A saturation series
> built from it is the earliest honest signal that a replica is out of room.

### Coordinator — `PostgresRiyaTurnCoordinatorEvent`

| Counter                         | Source event               | Dimensions      |
| ------------------------------- | -------------------------- | --------------- |
| `riya.claim.lock_acquired`      | `lock-acquired`            | `channel`       |
| `riya.claim.lock_busy`          | `lock-busy`                | `channel`       |
| `riya.claim.replayed`           | `claim-replayed`           | `channel`       |
| `riya.claim.conflict`           | `claim-conflict`           | `channel`       |
| `riya.claim.indeterminate`      | `claim-indeterminate`      | `channel`       |
| `riya.claim.processing_started` | `claim-processing-started` | `channel`       |
| `riya.claim.completed`          | `claim-completed`          | `channel`       |
| `riya.session.discarded`        | `session-discarded`        | `discardReason` |
| `riya.coordinator.failed`       | `coordinator-failed`       | `errorCode`     |

`claim-processing-started` and `claim-completed` are emitted **only after the exact-one-row proof**.
A zero-row write emits `coordinator-failed` instead, never a success. So
`processing_started − completed − indeterminate` is a real in-flight estimate, not an artefact.

### Model gateway — existing events, unchanged

The gateway already emits its own reliability signals and remains their sole authority. Alert on
what it already provides: request timeout, circuit-state change, queue refusal, concurrency refusal,
provider failure, fallback used, kill switch engaged, budget refusal.

RWC-P9 adds none of these and duplicates none of them. If model calls are failing, that is the
gateway's dashboard, not this one.

---

## 3. Severity

### SEV-1 — page immediately

**Any logical turn becomes `INDETERMINATE` during a pilot**, unless already inside an active
incident. That is: `riya.claim.indeterminate > 0`, or `riya.turn.failed{errorCode="turn-indeterminate"} > 0`.

This is the strongest rule here, and the reason it is SEV-1 at a count of one rather than at a rate:
an indeterminate claim means a turn reached the runtime and its outcome is unknown. A model may have
run, Core may have decided, an enquiry about a real person's home may exist. It is the only state
that carries duplicate-business risk, and it is never resolved automatically. One is worth waking
someone for.

Also SEV-1:

- **Evidence of duplicate business effect** — two Core intakes for one conversation, or two authorized
  replies for one logical message.
- **Claim-lifecycle invariant failure** — `riya.coordinator.failed{errorCode="repository-invariant"} > 0`.
  The durable evidence and the coordinator disagree about what is representable.

### SEV-2 — investigate now, no page unless sustained

- **Sustained coordinator unavailability** —
  `riya.turn.failed{errorCode="turn-coordinator-unavailable"}` non-zero for a sustained window.
  Riya cannot prove a message has not already run, so turns are being refused; that is correct, and
  the database needs attention.
- **Repeated `session-discarded`** — especially `UNLOCK_FALSE` or `UNLOCK_ERROR`. Each one is a
  physical connection destroyed because an advisory unlock could not be proved clean. Occasional is
  survivable; repeated means either connection instability or something holding locks it should not.
- **Sustained model-gateway circuit or timeout failures with user impact** — the gateway's own
  signals, cross-referenced with `riya.turn.failed`.

### Capacity warning — not a page

- **Sustained non-zero `riya.turn.overloaded`.** Load exceeds this replica's cap. See the runbook §4:
  add replicas, or raise the cap **together with** the coordinator pool. Never bypass admission.
- **Rising `riya.claim.lock_busy` rate**, especially concentrated in time. A hot-conversation pattern:
  many messages arriving for one conversation faster than turns complete. Usually a client
  integration retrying without waiting.

### Informational

- `riya.claim.replayed` — expected traffic. A caller retried after a timeout and the system correctly
  declined to run it twice. A _rising_ rate is worth a look: it usually means a caller's timeout is
  shorter than a real turn takes.
- `riya.claim.conflict` — a caller reusing a message id or source reference with something immutable
  changed. Always a client-integration defect; find it, do not tune it.

---

## 4. Suggested starting thresholds — operator policy, pilot only

Explicitly **not** in code, explicitly provisional, and expected to change once real traffic exists.

| Signal                                          | Starting threshold           | Severity         |
| ----------------------------------------------- | ---------------------------- | ---------------- |
| `riya.claim.indeterminate`                      | `>= 1` in 24h                | SEV-1            |
| `riya.coordinator.failed{repository-invariant}` | `>= 1` in 24h                | SEV-1            |
| `turn-coordinator-unavailable`                  | `> 0` sustained 5 min        | SEV-2            |
| `riya.session.discarded`                        | `> 3` in 15 min              | SEV-2            |
| `riya.turn.overloaded`                          | `> 0` sustained 10 min       | capacity warning |
| `riya.claim.lock_busy`                          | rate doubling week over week | capacity warning |

---

## 5. What this specification does not add

No `console.log`, logger library, OpenTelemetry SDK, Prometheus client, exporter, metrics server,
tracing backend, file log or database log table. No HTTP endpoint, no health endpoint, no scrape
target.

The codebase emits events through injected synchronous hooks whose results are ignored. A hook that
throws changes nothing about a turn. Choosing a sink is a deployment decision, and it belongs to
canonical QFJ-P11 rather than here.
