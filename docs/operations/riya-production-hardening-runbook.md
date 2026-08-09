# Riya production hardening — operator runbook

**Slice:** RWC-P9 · **Decision:** [ADR-0105](../decisions/ADR-0105-rwc-p9-riya-production-hardening-and-operational-readiness.md)

This is for whoever is on call during a Riya pilot. It assumes no knowledge of the codebase.

Nothing described here is deployed. The private ingress is **OFF / NOT DEPLOYED**, there is no live
WhatsApp adapter, no QuickFurno handshake, no provider or n8n activation, and no migration is applied
to any managed database.

---

## 1. The four things that protect a Riya turn

They sit in this order, and each protects a different resource. Understanding which one fired is
usually the whole of an incident triage.

| Layer                    | Scope                                        | What it protects                                            | Fires as                                                                    |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Ingress replay guard** | one signed request, one process              | replay of an identical HTTP request in its freshness window | `replay-detected`                                                           |
| **Service admission**    | one process, all conversations               | database sessions and process memory                        | `turn-overloaded`                                                           |
| **Turn coordinator**     | one canonical conversation, **all replicas** | duplicate business effect, concurrent turns                 | `turn-in-flight` / `turn-replayed` / `turn-conflict` / `turn-indeterminate` |
| **Model gateway**        | model calls                                  | the provider — timeout, circuit, concurrency, queue, budget | gateway events                                                              |

### Admission cap

`maxConcurrentTextTurns` is how many text turns **one replica** will serve at once. It is required
configuration; there is no default.

There is **no queue**. Over the cap, a turn is refused immediately and nothing downstream runs — no
coordinator call, no database session, no availability read, no model, no Core, and **no durable
claim**. The same message can be presented again.

### Coordinator serialization

One canonical `(tenantId, conversationId)` runs **one** text turn at a time, across every replica,
enforced by a PostgreSQL session advisory lock. A second turn for the same conversation is told the
conversation is busy — it is not queued and not retried for you.

### Logical replay vs transport replay

These are different and both matter.

- **Transport replay** — the _same signed request_, same `requestId`. Caught by the ingress guard.
- **Logical replay** — the _same message_, re-signed under a **fresh** `requestId`. The transport
  guard correctly lets it through; the coordinator stops it.

A caller retrying after a timeout produces the second kind. That is the case RWC-P8 exists for.

### Claim states

| State           | Meaning                                               | Operator action                           |
| --------------- | ----------------------------------------------------- | ----------------------------------------- |
| `PROCESSING`    | a turn is in flight, or its owner vanished            | none directly; the next claim resolves it |
| `COMPLETED`     | the turn finished and is spent                        | never re-run it                           |
| `INDETERMINATE` | a turn reached the runtime and its outcome is unknown | **never auto-replay** — see §3            |

**An `INDETERMINATE` claim is never re-run automatically, by anything.** A turn that got that far may
already have called a model, taken a Core decision or created a real enquiry.

### Safe-to-retry vs spent

The dividing line is `startProcessing`, the moment the durable claim is written.

- **Before it** — an unavailable store, an unprovable availability answer, a coordinator that could
  not answer. No claim exists, nothing external ran, and the same logical message is **retryable**.
- **After it** — the message is potentially **spent**. Whatever the caller was told, the ledger will
  not let it run again.

---

## 2. Incident matrix

### `turn-overloaded`

**Means:** this replica is at its configured capacity. It is _not_ a statement about the message.

**Do:** reduce incoming rate, add replicas, or raise the cap _only together with_ the coordinator
pool (see §4). Check whether load is genuinely sustained or one burst.

**Do not:** bypass or disable admission. It is the only thing standing between a burst and pool
exhaustion, and the failure mode without it is a database that cannot be reached at all — for every
conversation, not just the excess ones.

### `turn-in-flight`

**Means:** another text turn for the same conversation is active somewhere in the fleet.

**Do:** let the caller present the message again after the current turn finishes.

**Careful:** re-present the **same logical identity** (same `messageId` _and_ `channelTurnRef`). A
new message id for the same words is a new turn, and if the first one also completes the client gets
two answers.

### `turn-replayed`

**Means:** this exact logical message already completed.

**Do:** nothing. This is the system working.

**Do not:** re-run it, and do not fabricate a "cached reply" — the ledger stores no model output by
design, and inventing one would make a replay indistinguishable from a fresh answer to the person
receiving it.

### `turn-conflict`

**Means:** a `messageId` or a source reference is being reused with something immutable changed — a
later timestamp, a different data class, a different subject, a different channel, or the same source
reference under a new message id.

**Do:** treat as a **caller defect**. New or corrected words need a new `messageId` **and** a new
`channelTurnRef`. Find the client integration that is reusing one.

### `turn-indeterminate` — treat as a duplicate-risk safety event

**Means:** a turn reached the runtime and its outcome is unknown. A model may have run, Core may have
decided, an enquiry may exist.

**Do:** raise an incident (see [alerting](./riya-production-alerting.md) — this is SEV-1 during a
pilot). Investigate durable evidence: the claim row, the continuity revision, and whether Core holds
a submission for the conversation. Reconciliation is a **human** decision.

**Do not:** auto-replay. Do not reissue the same words under a fresh `messageId` merely to get the
client an answer — if the first turn did complete at Core, that produces a second real enquiry about
someone's home.

### `turn-coordinator-unavailable`

**Means:** the durable coordinator could not answer. Riya cannot prove a message has not already run.

**Do:** stop accepting AI turns. Check PostgreSQL health, connection count, and the coordinator pool.

**Do not — ever:** switch to a permissive or in-memory coordinator to "keep the service up". That
removes duplicate protection entirely, at exactly the moment the system is unhealthy and callers are
retrying hardest.

### Runtime or model failure after the turn started

**Means:** the claim is, or becomes, non-re-runnable.

**Do:** treat the conversation as needing human follow-up if the client is waiting.

**Do not:** manually reissue under a fresh message id just to produce an answer. See
`turn-indeterminate`.

---

## 3. What each layer does NOT do

- **Admission is not idempotency.** It bounds a process's appetite. Duplicate suppression is the
  coordinator's, durably and across replicas.
- **Admission is not per-conversation.** It is deliberately conversation-blind; making it aware would
  put a weaker process-local copy of the coordinator's authority in front of the real one.
- **The service does not time out a model call.** Request timeout, cancellation at the provider
  boundary, retry policy, circuit breaker, model concurrency, model queue, budget refusal, kill
  switch and sequential fallback are all owned by `@qf-jarvis/model-gateway`. There is deliberately
  no application `Promise.race` deadline: it would stop _waiting_ while the underlying call kept
  running, producing a side effect nothing tracks.
- **Nothing retries automatically.** Anywhere.
- **There is no reply cache.** A replay returns a refusal, never text.

---

## 4. Capacity sizing

A service-admitted text turn may hold **one dedicated coordinator `PoolClient` for its entire turn** —
that is how the conversation's session advisory lock stays on one session.

Therefore:

> **`maxConcurrentTextTurns` must be at most the pool capacity intentionally reserved for active Riya
> text-turn leases**, with additional headroom if that pool also serves unrelated database work.

There is no universal ratio, and the code does not read `pool.options.max` — a cap silently derived
from a shared pool would change meaning the day somebody resized the pool for another reason.

Prefer a **dedicated coordinator pool** at final deployment if operationally practical. Then the
relationship is one number against one number, and it is visible in configuration rather than
inferred.

Raising the cap without raising the pool converts a clean `turn-overloaded` into connection
starvation, which is strictly worse: it degrades every conversation instead of shedding the excess.

---

## 5. Boundaries during a pilot

- Private ingress: **OFF / NOT DEPLOYED**. No route is bound to a port.
- Live WhatsApp: **none**. `WHATSAPP` is a channel the contract accepts; there is no adapter, client,
  token or send.
- QuickFurno handshake: **deferred**. Core remains an abstract external authority.
- Managed database: **never** written by these slices. Migrations `0001`–`0012` are repository and
  LOCAL/CI only.
- Provider / n8n: **not activated**.
