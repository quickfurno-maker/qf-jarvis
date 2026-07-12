# ADR-0022 — Projections, Ordering, and Rebuild Determinism

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

Phase 3's hardest exit criterion is one sentence:

> **Read models can be destroyed and rebuilt from the event history with identical results.**

That sentence is doing more work than it appears to. It requires that a projection be a **pure function of the event log** — which constrains what a projection may read, what order it may read it in, and what it may do about events that arrive out of business order.

And it collides with a fact about the Phase 2 contracts that has to be faced directly rather than worked around.

### The canonical envelope carries no sequence

The envelope is exactly:

```
eventId · eventType · eventVersion · occurredAt · emittedAt · source · subject
correlationId · causationEventId · payload
```

There is **no aggregate sequence and no stream version.**

So Phase 3 **cannot** enforce per-aggregate ordering, and **cannot** detect a sequence gap — because there is no sequence to detect a gap _in_. Ordering could only be fabricated from `occurredAt`, which means trusting a clock on the other side of a trust boundary, and `emittedAt` only records when Core _said_ a thing happened.

The roadmap asks for _"ordering guarantees where they matter."_ This ADR's job is to say honestly **where they matter, what we can actually provide, and what we are not going to pretend.**

## Decision

**Projections are pure functions of the log, replayed in ingestion order. Phase 3 guarantees deterministic replay and late-event safety — and explicitly does not guarantee per-aggregate ordering.**

### 1. What Phase 3 guarantees

| Guarantee                               | Mechanism                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Deterministic ingestion sequence**    | `sequence BIGINT GENERATED ALWAYS AS IDENTITY` — a total order over **arrival**           |
| **Deterministic replay**                | Live and rebuild both traverse **`sequence` order**. Same input, same order, same reducer |
| **Correlation and causation preserved** | Carried through the store and into every projection                                       |
| **Late-event-safe reducers**            | Reducers compare `(occurredAt, eventId)` and advance only on strictly newer               |

### 2. What Phase 3 does **not** claim

- **No global business ordering.** `sequence` orders _arrival_, not business time, and must never be read as if it did.
- **No per-lead or per-aggregate sequence ordering.**
- **No sequence-gap detection.**

Per-aggregate ordering requires a **future versioned envelope carrying an aggregate sequence.** That is a contract change, and a contract change requires QuickFurno Core to actually emit the field — which makes it a **Phase 11 Core-integration decision.**

**It must not be invented in Phase 3.** Fabricating a sequence would mean inventing a fact about a system we have not integrated with, which is the exact failure [engineering-principles.md](../governance/engineering-principles.md) §1 forbids and which Phase 2 spent its entire event-catalog argument avoiding.

### 3. Determinism and correctness are different properties, and they are obtained separately

This distinction is the heart of the design, and conflating the two is how systems like this go wrong.

**Determinism is free.** If live processing and rebuild both traverse `sequence` order and the reducer is pure, the result is identical. Nothing clever is required.

**Correctness is not free.** A reducer that simply takes "the last event I saw" produces a _deterministic_ answer that may be _semantically wrong_ — because an event that arrived later may describe something that happened **earlier**.

So the framework imposes a rule:

> **A reducer that tracks the latest state of a subject must compare `(occurredAt, eventId)` and advance only on a strictly newer value.**

`eventId` is the tiebreaker, so two events with identical `occurredAt` resolve the same way every time — deterministically, and without reference to arrival order.

The result is a reducer that is **both** deterministic under replay **and** tolerant of late arrival. Neither property is sacrificed to the other.

| Scenario                                                      | Behaviour                                       |
| ------------------------------------------------------------- | ----------------------------------------------- |
| **Late event** — older `occurredAt` arrives after a newer one | **Normal.** It does not clobber the newer state |
| **Missing / stale / future sequence gap**                     | **Not detectable, and not claimed** (§2)        |
| **Replayed event**                                            | Applied in `sequence` order — identical to live |

### 4. Reducers must be pure, and this is enforced

A projection handler may not read the clock, generate randomness, read the environment, perform I/O, or depend on iteration order that is not explicitly sorted. Any one of those breaks the rebuild guarantee — quietly, and usually months later.

Enforced by an **ESLint rule on the projections directory**, mirroring the rule that keeps `packages/contracts` pure. The byte-equal rebuild test would eventually catch it anyway; the lint rule catches it in the pull request instead of in an incident.

### 5. Checkpoint and state move together

A projection's read-model write and its checkpoint advance occur **in the same transaction** ([ADR-0021](./ADR-0021-processing-retries-dead-letters-and-replay.md)).

This is what converts **at-least-once delivery** into **exactly-once effect** on the read model. The read model can never be ahead of or behind its own checkpoint, because there is no moment at which one has moved and the other has not.

### 6. Version bump ⇒ destroy and rebuild

Every projection has a **name**, a **version**, and a **checkpoint**.

When the code's version differs from the stored version, the framework **destroys the derived state, resets the checkpoint to zero, and rebuilds** — recording it in an audit row.

There is no migration path for a read model, and there does not need to be one: **a derived, rebuildable store is not migrated. It is thrown away and recomputed.** Attempting to migrate it would be treating it as if it held something irreplaceable, which is precisely what it must never hold.

### 7. Rebuild determinism, made executable

The exit criterion becomes a test:

1. Build the projection live → serialise every `rm_*` row in a deterministic order → canonical JSON → **SHA-256 → digest A**.
2. **Destroy** the derived state.
3. **Rebuild** from the log.
4. Digest again → **digest B**.
5. **Assert `A === B`.**

If a reducer ever reads a clock, or iterates a `Set`, or depends on arrival order, this test goes red.

### 8. Erasure survives rebuild — and it does so for free

This is worth stating carefully, because the obvious implementation is wrong and the correct one requires no machinery at all.

**The naive fear:** we erase a client from the read models; later we rebuild from the log; the log still contains the pre-erasure events; **the erased data comes back.**

**Why it does not happen:** _the erasure is itself an event in the log._ A rebuild replays `qf.privacy.erasure-recorded` along with everything else, in the same order, and arrives at the same erased final state. Live and rebuilt agree.

So **Phase 3 needs no special erasure machinery beyond "projections handle erasure events."** The property falls out of the design.

And it falls out **only because Phase 2 chose _reference, never reproduce_** — the log holds opaque Core references and governed payloads, not copies of people. Had the events embedded personal data, none of this would work, and erasure would have required mutating an immutable log. This is a case where an earlier decision quietly paid for a later one.

The same applies to memory-invalidation events, which projections must also handle.

**What this ADR does not decide:** the legal classification and retention policy of a _production_ event log. Phase 3 uses synthetic fixtures only, and [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7 records the separate owner-approved privacy and retention decision that must precede any live event in Phase 11. **Nothing here claims that immutable storage overrides an applicable erasure requirement.**

### 9. One reference projection, and no more

Phase 3 creates exactly one, and it is deliberately boring:

**`rm_subject_activity`** — per subject: event count, first seen, last seen, erasure state.

Domain-neutral, agent-free, and it exercises everything that matters: rebuild determinism, late-event tolerance, erasure handling, and version-bump rebuild.

**No agent-specific, client-intelligence, vendor-intelligence, lead-intelligence, or marketing-intelligence projection may be added in Phase 3.** Those belong to Phases 4 through 8, and building one now would be building a domain read model in the phase least equipped to know what it should contain — which is Phase 0's placeholder prohibition wearing different clothes.

## Consequences

**Positive.**

- **The rebuild guarantee is a test, not an aspiration.**
- **Determinism and correctness are obtained separately**, so neither is traded for the other.
- **Erasure survives rebuild with no special machinery**, as a consequence of Phase 2's design.
- **Read models are genuinely disposable**, which keeps them honest — a store you are afraid to delete has stopped being derived.
- **The ordering limitation is written down**, so Phase 4 and Phase 5 cannot quietly assume a guarantee that does not exist.

**Negative — accepted.**

- **No per-aggregate ordering.** A projection that genuinely needs it cannot be built correctly until the envelope carries a sequence — Phase 11. **This is a real limitation, and naming it is the point.**
- **Reducers are constrained.** No clocks, no randomness, no I/O. The cost of a rebuildable read model.
- **A version bump means a full rebuild**, which is O(log length). Cheap now; a candidate for snapshotting much later, if it ever hurts.
- **Late-event handling is the reducer author's responsibility.** The framework provides the rule and the tests; it cannot enforce semantics.

## Alternatives rejected

**Fabricate a per-aggregate sequence from `occurredAt`.** Rejected. It means trusting Core's clock across a trust boundary, and it silently converts "we do not know the order" into "we assert an order." A wrong order asserted confidently is worse than an absent one admitted.

**Add an aggregate sequence to the envelope now.** Rejected for Phase 3. It is a Phase 2 contract change (v2) that requires Core to emit the field — which we cannot verify and have not integrated with. It is exactly the "invent a payload for a system nobody has looked at" failure the Phase 2 event catalog was built to avoid. **It belongs in Phase 11, with Core in the room.**

**Order projections by `occurredAt` instead of `sequence`.** Rejected. It would make rebuild non-deterministic the moment two events share a timestamp, and it would make live and replay disagree whenever an event arrived late.

**Let reducers read the clock** ("just for `updated_at`"). Rejected — this is the single most common way a rebuild guarantee dies. Timestamps in a read model must come from the _event_, not from _now_.

**Migrate read models instead of rebuilding them.** Rejected. Migrating a derived store treats it as if it were authoritative. It is not, and the moment we start migrating it, it starts becoming so.

**Snapshotting to speed up rebuild.** Rejected as premature. The log is empty. Optimising a rebuild that takes milliseconds, at the cost of a second source of truth that can drift from the log, is the wrong trade at exactly the wrong time.

**Build a lead- or client-intelligence read model now** "since we are here." Rejected. Phase 3 has no agents and no idea yet what an agent needs. A projection built on a guess is a placeholder, and placeholders are what Phase 0 forbade by name.
