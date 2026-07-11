# ADR-0002: Integrate QuickFurno and Jarvis via versioned contracts and events

- **Status:** Accepted
- **Date:** 2026-07-11
- **Phase:** 0A — Engineering Foundation

## Context

QuickFurno Core owns business truth and operational state; QF Jarvis produces
recommendations and execution intents (see
[system-boundary.md](../architecture/system-boundary.md)). These two systems
must exchange information continuously and evolve independently over years.

There are two broad ways to connect them:

1. **Shared-table / shared-schema coupling** — Jarvis reads and/or writes
   QuickFurno's database (or a shared ORM model) directly.
2. **Contract-first integration** — Jarvis and QuickFurno exchange explicit,
   versioned messages (facts, events, recommendations, execution intents), each
   with a defined schema, and neither reaches into the other's storage.

Shared-table coupling is fast to start but corrosive: it turns a private storage
schema into a de-facto public API, makes the permanent architectural boundary
unenforceable, and couples deploy cycles.

## Decision

QuickFurno and Jarvis integrate **only through explicit, versioned contracts and
events** — never through shared tables, shared ORM entities, or direct database
access across the boundary.

- Contracts are defined as schemas and live in a shared package
  (`@qf/contracts`), with runtime validation (Zod) as the source of truth and
  TypeScript types inferred from it, so the runtime check and the compile-time
  type cannot drift.
- Messages are **versioned**. A consumer validates every inbound message against
  the contract version it understands and rejects what it cannot validate.
- The exchange is **event-driven and directional**, matching the boundary:
  QuickFurno emits versioned facts/events → Jarvis reasons → Jarvis emits
  recommendations/execution intents → QuickFurno authorizes → results return to
  QuickFurno → QuickFurno emits the resulting state-change events.

Phase 0A ships only foundation-level contracts (service status, health,
service metadata). The Canonical Event Envelope and the business
event/recommendation contracts are Phase 1, and they extend this same package.

## Reasons

- **The boundary stays enforceable.** No code path can quietly mutate the other
  system's state; the only way across is a validated message.
- **Independent evolution.** Either side can change its internal storage freely
  as long as it keeps honoring the contract version.
- **Validation at the edge.** Untrusted input is checked against a schema before
  it is ever trusted, which is also where authenticity/signature checks attach.
- **Single source of truth for shape.** Schema-first with inferred types removes
  the classic drift between "what we validate" and "what we type."
- **Testability.** Contracts can be tested in isolation (valid passes, invalid
  fails) without either live system.

## Consequences

Positive:

- Clear, auditable, versioned interface between the two systems.
- Storage schemas remain private implementation details on both sides.
- A natural place to enforce authentication and signed event intake (see the
  system boundary's mandatory-before-integration requirements).

Negative / trade-offs:

- More upfront work than reading a shared table: schemas must be defined,
  versioned, and evolved deliberately.
- Contract versioning and compatibility policy must be maintained as the systems
  grow (this is the intended cost, not an accident).

## Non-negotiables that follow from this decision

- No shared database credentials or cross-boundary table access, ever.
- Every inbound message is schema-validated before use.
- Contract changes are versioned and backward-compatible within a major version.
- Before production integration, messages are authenticated and event intake is
  signed (see system-boundary.md).
