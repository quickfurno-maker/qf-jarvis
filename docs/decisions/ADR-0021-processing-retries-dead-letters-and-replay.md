# ADR-0021 — Processing, Retries, Dead Letters, and Replay

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

Events are stored. Something has to process them into derived read models, survive failures, and let an operator recover.

The instinct here is to reach for a queue — Redis and BullMQ, or NATS, or a work-item table with workers claiming rows. That instinct is worth pausing on long enough to ask what a queue would actually buy us **here**, in **this** phase.

> **A queue is not required for Phase 3's checkpoint-driven projection model. PostgreSQL already provides durable ordering, locking, retries, checkpoints and atomic state transitions. Adding another broker would introduce a second durability boundary and operational complexity without improving the approved Phase 3 exit criteria. This is a scope and simplicity decision, not a claim that ordered queue architectures are universally invalid.**

Ordered queue architectures are legitimate, widely used, and can absolutely be made deterministic — with partition keys, ordered consumer groups, or a single consumer per stream. The question is not whether they _work_. The question is whether Phase 3 needs one, and it does not: the database we already require gives us every property the exit criteria ask for.

The second question is harder, and it is the one this ADR really turns on: **when a single event permanently breaks a projection, what happens to the events behind it?**

## Decision

**No queue. Checkpoint-driven projections over the PostgreSQL event log, one advisory lock each. Bounded, durable retries. A poison event halts its own projection and nothing else.**

### 1. No broker, and no work-item table — because Phase 3 does not need one

**Not adopted for Phase 3: Redis, BullMQ, NATS, Kafka, and a database-backed work queue.**

**A queue is not required for Phase 3's checkpoint-driven projection model.** PostgreSQL already provides durable ordering, locking, retries, checkpoints and atomic state transitions. Adding another broker would introduce a second durability boundary and operational complexity **without improving the approved Phase 3 exit criteria.** This is a **scope and simplicity decision**, not a claim that ordered queue architectures are universally invalid.

Each projection instead:

1. takes a **PostgreSQL advisory lock** on its own name — this is the lease, and it makes a projection single-writer without a queue;
2. reads `WHERE sequence > checkpoint ORDER BY sequence LIMIT N`;
3. applies each event;
4. **writes its state and advances its checkpoint in the same transaction.**

Step 4 is what makes this crash-safe by construction: **a read model can never be ahead of or behind its own checkpoint**, because they move together or not at all. There is no dual-write, no outbox, and no window in which a crash leaves the two disagreeing.

**Projections run concurrently with each other** — independent checkpoints, independent locks, independent failure. One projection blocking never stalls another.

A broker would introduce a **second durable store**, and with it a dual-write problem that the single-database design avoids for free. In a phase whose entire purpose is to make idempotency and replay provable, that is a meaningful cost for capability Phase 3 has no use for.

### 2. Retries are bounded, and the schedule is durable

|                  |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Retryable**    | Transient database error, deadlock, connection loss, a handler raising `RetryableError` |
| **Terminal**     | A handler raising `TerminalError`, a programming error, an unknown projection version   |
| Maximum attempts | **5** (configurable)                                                                    |
| Backoff          | Exponential with jitter — base 1s, capped at 5 minutes                                  |
| Durability       | `attempt_count` and `next_attempt_at` are **persisted on the projection row**           |

Persisting the schedule matters: a retry policy that lives only in memory is a retry policy that resets on every restart, which turns a bounded retry into an unbounded one the first time a process crash-loops.

### 3. A poison event **halts** its projection. It does not skip.

This is the decision worth arguing about, so here is the argument in full.

When a projection fails terminally, or exhausts its retries, on event _N_, there are two possible behaviours:

**Skip.** The projection records a dead letter, advances past _N_, and keeps going. It stays available. But its read model now has **a hole nobody can see** — and worse, the read model is no longer a pure function of the event log, so a rebuild would produce a _different_ result unless the skip is somehow reproduced.

**Halt.** The projection records a dead letter, marks itself `blocked` at checkpoint _N−1_, and stops. It is loudly, visibly broken. Every other projection continues untouched.

**We halt.** A skipped event produces a read model that is _silently wrong_; a halted projection is _visibly broken_. **Visibly broken beats invisibly wrong** — that is this repository's disposition everywhere else (unknown versions are rejected rather than guessed at; ambiguity is never rounded to success), and there is no reason to abandon it at the one layer everything else is built on.

There is a real cost, and it should be stated: **a single bad event stops that projection until a human acts.** In Phase 3, with no users and no agents, that cost is close to zero and the safety is worth a great deal. If a later phase finds it intolerable for a specific projection, that is a decision to revisit _with evidence_ — not a default to adopt now because it is convenient.

### 4. Quarantine: the escape hatch, and it is audited

An operator facing a blocked projection has exactly two moves:

1. **Fix and replay.** Correct the handler, replay the dead letter, and the projection unblocks and continues. This is the normal path.
2. **Quarantine.** Explicitly decide that this event will never be applied to this projection — **with attribution and a reason**, appended to an immutable `projection_quarantine` ledger.

**A quarantine is reproduced during rebuild.** The rebuild applies the same quarantine set, so the read model rebuilds to the same state. Determinism survives — not because we pretended the skip did not happen, but because **the skip is itself a recorded, replayable decision.**

This is the same move the architecture makes everywhere: an exception is fine, as long as it is a _record_ rather than an _absence_.

### 5. Dead-letter replay and full rebuild are different operations

|           | **Dead-letter replay**                 | **Full rebuild**                                          |
| --------- | -------------------------------------- | --------------------------------------------------------- |
| Scope     | Specific events, one projection        | One projection, entire log                                |
| Effect    | Re-run the handler; unblock on success | Destroy derived state, reset checkpoint to 0, re-traverse |
| Used when | A handler bug is fixed                 | A projection version changes, or state is suspect         |

Both are **governed operations**, not accidents. Every one writes a `replay_audit` row: who, when, what scope, and why.

**Replay is idempotent.** Handlers are idempotent, and a checkpoint only advances on success — so replaying an event that already applied has the effect of applying it once.

**Replay does not re-verify signatures or freshness** ([ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §4). The event was verified at acceptance.

**Replay creates no external effect.** In Phase 3 there are none to create — no agents, no recommendations, no execution, no communication. That is not an accident of scope; it is what makes replay safe to exercise aggressively before anything downstream depends on it.

### 6. Dead letters are visible

Dead letters are **rows in a table**, queryable and countable. Together with `event_conflict` and `ingestion_rejection`, the tables _are_ the durable metrics — which satisfies _"duplicate-event and dead-letter metrics are instrumented"_ without a metrics stack.

**Honest limitation:** Phase 3 has no UI and no alerting transport. _Visible_ here means _queryable and counted_, not _paged at 3am_. Real alerting belongs to Phase 13, which is the phase named for it. Saying so plainly is better than implying an operator will notice a table changing.

### 7. The test emitter is the only event source

Phase 3's only source is a **local, fixture-driven, conforming test emitter** — never QuickFurno Core.

It lives in `packages/test-emitter`, and its production safety is **structural rather than disciplinary**:

- **No application declares it as a dependency**, so under pnpm's isolated `node_modules` an application **cannot resolve it**. The package manager enforces this, not a reviewer ([ADR-0010](./ADR-0010-workspace-and-module-structure.md) §4).
- It **throws at module load** if `QF_JARVIS_ENV` or `NODE_ENV` is `production`.
- It contains **no network client at all** — there is no socket to point at Core, so pointing it at Core is not a configuration mistake anyone can make.
- CI asserts that no application depends on it.

It loads Phase 2's 41 valid event fixtures, signs them with test-only keys, and can deliberately produce: **identical duplicates, conflicting duplicates, invalid signatures, unknown key ids, expired signatures, unknown event types, unknown versions, and handler failures** — both retryable and terminal.

Adversarial input is not an afterthought here. It is the emitter's primary purpose.

## Consequences

**Positive.**

- **The smallest architecture that meets the exit criteria.** No broker, no second store, no dual-write, no queue table.
- **Crash safety is structural** — checkpoint and state move in one transaction.
- **A poison event cannot corrupt a read model**, and cannot stall the system beyond its own projection.
- **A skip is impossible by accident** and possible only as an audited decision.
- **Replay is a first-class operation**, exercised aggressively while it is still harmless.

**Negative — accepted.**

- **A blocked projection needs a human.** Deliberate. In Phase 3 it costs nothing; if a later phase disagrees, it can revisit with evidence.
- **No parallelism within a projection.** Deliberate. Ordered processing is what makes the rebuild criterion straightforward to satisfy, and Phase 3 has no throughput pressure to trade it against. If throughput ever becomes a real constraint, the first move is to shard by projection — and a partitioned or ordered-consumer queue is a legitimate option to reconsider **on evidence**, not a door this ADR closes.
- **"Visible" means queryable, not alerted.** Honest gap, owned by Phase 13.
- **Advisory locks are per-database.** Fine for one instance; a multi-instance deployment would need revisiting. Not a Phase 3 problem, and noted rather than discovered later.

## Alternatives rejected

**A note on the queue alternatives below.** Each is **not adopted for Phase 3**. None is dismissed as an invalid architecture. Ordered queue systems are legitimate and can be made deterministic — with partition keys, ordered consumer groups, or a single consumer per stream. The consistent reason for setting them aside is the same one: **PostgreSQL already provides durable ordering, locking, retries, checkpoints and atomic state transitions, so a broker adds a second durability boundary and operational complexity without improving the approved Phase 3 exit criteria.** This is a **scope and simplicity decision.**

**Redis + BullMQ.** Mature and pleasant. Not adopted: it adds a **second durable store**, reintroducing a dual-write problem that a single transaction avoids for free — and Phase 3 has no throughput need that would justify the trade.

**NATS or Kafka.** Not adopted: distributed infrastructure with no demonstrated need in this phase. A log we already have, in a database we already require, is not improved by putting a second log in front of it.

**A database-backed work-item queue** (`(projection × event)` rows, claimed with `SKIP LOCKED`). The closest call. Not adopted: it exists to enable intra-projection parallelism, which Phase 3 has no use for — and it would add tables, states, and failure modes for a capability we would not exercise. **If throughput ever demands it, this is the first alternative to revisit, on evidence.**

**Skip-and-continue on a poison event.** Rejected on §3. It trades a visible outage for an invisible corruption, and it silently breaks the rebuild guarantee.

**Unbounded retries.** Rejected. An unbounded retry against a permanently broken event is an infinite loop with a database bill.

**In-memory retry scheduling.** Rejected. It resets on restart, which converts a bounded retry into an unbounded one exactly when the system is least healthy.

**Automatic quarantine after N failures.** Rejected. Automatic quarantine is skip-and-continue with a longer fuse. **A decision to permanently ignore a fact about the business needs a person's name on it.**
