# ADR-0004 — Modular Monolith First

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

QF Jarvis will eventually contain several distinguishable parts: event ingestion, a coordination layer, four specialist agents, an evaluation loop, and a founder control plane. Drawn on a whiteboard, they look like services. The five agents have names, which makes them look even more like services.

The temptation is to build them as services from day one — "we'll need to scale them independently anyway." The reality is that QF Jarvis has no users yet, no events flowing, no proven contracts with QuickFurno Core, and no evidence that any agent is worth running at all. Distributing a system you do not yet understand buys you the operational cost of distribution and none of its benefits, and it does so at exactly the moment when your architecture is most likely to be wrong.

There is also a specific trap here. Agents are *reasoning* components, not *scaling* components. Their cost is model inference and their bottleneck is quality, not throughput. Giving each one a network boundary because it has a human name is design by anthropomorphism.

## Decision

**QF Jarvis starts as a modular monolith in a single repository. Services are extracted later, if and when evidence demands it.**

1. **One deployable unit**, with strict internal module boundaries: ingestion, coordination, each agent, evaluation, control plane.
2. **Modules communicate through explicit internal interfaces**, not by reaching into each other's internals. The boundaries are real and enforced in code review — they are simply not network boundaries.
3. **Agents are modules, not services.** Kabir, Riya, Anisha, and Jitin are bounded reasoning components behind clean interfaces ([ADR-0006](./ADR-0006-agent-responsibility-boundaries.md)).
4. **The module boundaries are drawn where a service boundary would go**, so that extraction is a deployment change rather than a rewrite.
5. **Extraction requires evidence**: a real scaling limit, a real independent-deployment need, or a real ownership split — and an ADR recording it. "It feels cleaner" is not evidence.

This decision is about QF Jarvis's *internal* structure only. It says nothing about the boundary between Jarvis, QuickFurno Core, n8n, and providers — those are separate systems across trust boundaries, and that separation is permanent ([ADR-0001](./ADR-0001-source-of-truth-boundary.md), [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md)).

## Alternatives considered

**1. Microservices from the start** — one service per agent, plus ingestion, coordination, and control plane.
Rejected. It imposes distributed tracing, network failure handling, independent deployment pipelines, service discovery, and versioned internal APIs — all before a single recommendation has been evaluated as useful. Every one of those is a real cost paid in the phase where we can least afford it. And the boundaries would be guesses: we do not yet know where this system's real seams are, and the fastest way to find out is to build it in a form that lets us move them.

**2. Serverless functions per agent.**
Rejected for now. It fragments the coordination logic that Phase 4 exists to build, complicates local development, and makes the shared derived read models awkward. Worth revisiting for specific bursty workloads later, with evidence.

**3. A single unstructured application** — no internal module boundaries.
Rejected. This is the failure mode people actually mean when they say "monolith," and it is not what we are choosing. Without internal boundaries, an agent's domain logic leaks into the coordinator, the coordinator absorbs the agents, and by Phase 8 nothing can be extracted, tested, or replaced independently. The discipline is the point; only the network hop is deferred.

**4. Separate repositories per module, single deployment.**
Rejected as premature ceremony. A monorepo gives atomic cross-module changes and one CI pipeline, which is what a system with unproven internal boundaries needs.

## Consequences

**Positive.**

- **Speed where it matters.** Phases 1 through 8 spend their effort on contracts, event handling, and agent quality — not on service scaffolding.
- **Refactoring is cheap.** Module boundaries can be moved with a rename and a compiler error, not a migration and a deprecation window.
- **Local development is simple.** One thing to run. A new contributor is productive on day one.
- **Atomic changes across modules**, which matters enormously while the contracts are still moving.
- **Debugging is tractable.** A stack trace beats a distributed trace, every time, in a system nobody fully understands yet.
- **Extraction stays available**, because the boundaries were drawn where the seams are.

**Negative — accepted.**

- **Everything scales together.** If Jitin's analysis is heavy, the whole process carries it.
- **A crash takes down the whole intelligence layer.** Acceptable precisely because [ADR-0003](./ADR-0003-event-driven-integration.md) makes Jarvis failable — QuickFurno keeps running, and Jarvis catches up on replay. This is a real benefit of the boundary showing up in an unrelated decision.
- **Discipline is required, not enforced by the network.** Nothing stops a developer from importing across a module boundary except review. This is the main cost, and it is a cultural one.
- **One deployment pipeline**, so a risky change to one module gates the others. Feature flags mitigate this ([change-management.md](../governance/change-management.md)).

## Risks

| Risk | Mitigation |
| --- | --- |
| **The monolith becomes a mud ball** — module boundaries erode by import | Boundaries are reviewed at every phase gate. Cross-module imports that bypass an interface are a review blocker, not a style comment |
| **The coordinator absorbs the agents' domain logic** | [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md). Phase 4 builds coordination with **zero agents registered**, which makes domain leakage structurally difficult |
| **Extraction is deferred past the point where it is needed** | Extraction triggers are evidence-based: a measured scaling limit, a real deployment conflict, or an ownership split. Revisit at each phase gate |
| **"Modular monolith" is used to justify no modularity at all** | The internal interfaces are as real as service APIs would have been. Only the network hop is deferred |
| **A heavy agent starves the ingestion path** | Phase 13 addresses isolation and bounds. If it becomes a genuine problem, that is *evidence* — and evidence is exactly what would justify extraction |

## Follow-up

- Phase 1 establishes the repository and module layout, drawing boundaries where service boundaries would go.
- Phase 4 builds the coordination layer with no agents registered, proving the boundary between coordination and domain reasoning.
- Each phase gate reviews whether module boundaries have eroded and whether any extraction trigger has fired.
- Any future extraction to services requires a new ADR recording the *evidence* that justified it.
