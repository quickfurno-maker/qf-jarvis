# ADR-0003 — Event-Driven Integration

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

QF Jarvis needs to know what happens inside QuickFurno Core: leads created and verified, vendors onboarded and lapsed, packages purchased, campaigns spending. It needs this continuously, and it needs it in a form it can reason about, audit against, and replay.

There are three ways to get it, and the choice shapes everything downstream — coupling, auditability, replay, and whether [ADR-0001](./ADR-0001-source-of-truth-boundary.md)'s boundary survives contact with a deadline.

Two constraints frame the decision. First, Jarvis must never become a second source of truth, so whatever crosses the boundary must be understood as a *copy of a fact Core owns*, not as the fact itself. Second, every recommendation must be traceable to the evidence that produced it — which means the evidence has to be something durable, identifiable, and replayable, not a row that has since been updated in place.

## Decision

**Systems communicate through versioned canonical events and explicit result flows.**

1. **QuickFurno Core emits canonical events** — versioned, immutable, signed facts about what happened in the business. `lead.verified`, `vendor.package.expired`, and so on.
2. **Events are facts, never commands.** An event says what happened. It never says what to do about it. The moment an event carries an instruction, Core has started authorizing through the event stream and the boundary has leaked.
3. **Events are versioned.** An unknown version is rejected, never guessed at. Breaking changes require a version bump and a migration plan ([change-management.md](../governance/change-management.md)).
4. **Events carry stable identifiers, correlation, and causation.** Correlation groups everything in one business thread; causation records what directly produced what ([glossary.md](../charter/glossary.md)).
5. **Ingestion is idempotent.** Redelivery is normal, not exceptional. The same event twice has the effect of once.
6. **Events are replayable.** Jarvis's derived read models are rebuildable from the event history, and rebuilding them must produce identical results.
7. **Result flows are explicit.** Approval decisions, execution intents, and execution results each have their own versioned contract, and each returns to Jarvis as an event so recommendation lifecycles close ([recommendation-lifecycle.md](../architecture/recommendation-lifecycle.md)).
8. **Events cross a trust boundary.** They are signed by Core and verified by Jarvis; replay protection applies ([trust-boundaries.md](../architecture/trust-boundaries.md), B1).

Contracts are defined in Phase 2. The durable backbone that carries them is Phase 3.

## Alternatives considered

**1. Jarvis reads QuickFurno Core's database directly.**
Rejected, firmly. It couples Jarvis to Core's schema, so any Core migration breaks Jarvis silently. It gives Jarvis no notion of *when* something happened, only what the row says now — which destroys evidence: you cannot cite "the lead's budget at submission time" from a row that has been updated since. It makes replay impossible. And it is one `UPDATE` statement away from being a write path, which is exactly the erosion [ADR-0001](./ADR-0001-source-of-truth-boundary.md) exists to prevent.

**2. Jarvis polls Core's REST API.**
Rejected as the primary mechanism. Polling gives you the current state, not the history — so again, no durable evidence and no replay. It scales badly, it is either stale or expensive, and it makes "what did we know when we recommended this?" unanswerable. A request/response API remains appropriate for *confirmation* at authorization time (Core re-validating a submitted recommendation against its own truth), and that is where it stays.

**3. Core calls Jarvis synchronously and waits for a recommendation.**
Rejected. It couples the business's critical path to the availability and latency of the intelligence layer. If Jarvis is down or slow, lead creation should not be. Jarvis must be able to fail without QuickFurno failing — which is only true if the integration is asynchronous.

**4. Full event sourcing, with Core and Jarvis as peers over a shared log.**
Rejected as over-engineering and as a boundary dissolved by design. It also assumes we can change Core's persistence model, which we cannot and should not. Canonical events are an *integration* contract, not a storage strategy for Core.

**5. Shared database tables as an integration point.**
Rejected. This is alternative 1 wearing a hat.

## Consequences

**Positive.**

- **Loose coupling.** Core can refactor its internals freely as long as it keeps emitting the same versioned events. Jarvis can be rewritten without Core noticing.
- **Jarvis can fail without QuickFurno failing.** The business keeps running; the intelligence layer catches up on replay.
- **Evidence is durable and citable.** A recommendation cites the events that produced it — immutable facts with identifiers, not mutable rows.
- **Replay is a first-class capability**, which makes read models disposable, backfills routine, and recovery from a bad agent version a non-event.
- **Audit works.** Correlation and causation carry through the whole chain, from source event to execution result ([auditability-principles.md](../governance/auditability-principles.md)).
- **The boundary is reinforced.** An event stream is structurally read-only from Jarvis's side. There is nothing to write to.

**Negative — accepted.**

- **Eventual consistency.** Jarvis's view lags Core's truth. Every design must tolerate this rather than try to eliminate it — and Core re-validates at authorization time, which is where it matters.
- **QuickFurno Core must eventually do work.** It has to emit events it may not emit today — **whether it can do so at present is unverified**. This is a real dependency and a real cost, and it is deliberately concentrated in **Phase 11**, where Core's emitters, authorization interface, and compatibility adapters are built. Phases 2 through 10 are designed against contracts and fixtures precisely so that this dependency blocks *one* phase rather than *all* of them.
- **Contract maintenance.** Versioning, compatibility rules, and contract tests are ongoing overhead.
- **Debugging is harder** in an asynchronous system than in a synchronous one. Correlation identifiers and observability are the price of admission, not an enhancement.
- **Duplicate delivery is guaranteed to happen**, so idempotency is not optional anywhere.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Contract drift** — Core changes an event's meaning without a version bump | Versioned contracts, contract tests on both sides, unknown versions rejected rather than guessed at |
| **Core cannot emit what Jarvis needs today** — present capability is **unverified** | Nothing before Phase 11 depends on it. Contracts, backbone, agents, and approval are all built against Phase 2 contracts and fixtures. Phase 11 builds Core's emitters and **compatibility adapters** — the adapter absorbs the difference, the contract does not bend. **The boundary does not change either way** |
| **Events start carrying instructions** — "lead.needs_followup" instead of "lead.went_quiet" | Events are facts, never commands. Enforced at contract review. An event that tells Jarvis what to do is Core authorizing through the back door |
| **Idempotency gets it wrong** and a redelivered event double-processes | Phase 3 tests this by *deliberately* redelivering events; it is an exit criterion, not a hope |
| **Personal data sprayed across the event stream** | Events carry the minimum personal data Jarvis needs. Core does not push what Jarvis has no reason to hold ([privacy-principles.md](../governance/privacy-principles.md)) |
| **Replay of a hostile message** treated as a legitimate one | Replay protection at every boundary; a legitimate operational replay is a distinct, authorized operation |

## Follow-up

- Phase 2 defines the contracts — canonical event, recommendation, approval request, approval decision, execution intent, execution result — with a version registry, fixtures, compatibility rules, and tests. **It completes independently of Core's current capabilities.**
- Phase 3 builds the durable backbone against those contracts and fixtures: signature verification, idempotent processing, deduplication, bounded retries, dead-letter handling, and replay. Its exit criteria include destroying every read model and rebuilding it from events with identical results. **It, too, completes independently.**
- **Phase 11 establishes the integration**: Core's event emitters, its authorization interface, compatibility adapters, callbacks, and any migration Core requires — plus reconciliation with Core winning, and deletion propagation.
