# ADR-0042 — MVP and Post-MVP Delivery Overlay and Controlled Launch Sequencing

**Status:** Accepted (2026-07-22, documentation and governance overlay — no runtime implementation)
**Deciders:** Owner
**Phase:** QFJ-P00 — Governance and Delivery Control (a delivery overlay across the existing QFJ-P00…P12 spine)

**Relates to:** [qf-jarvis-roadmap-v3.md](../architecture/qf-jarvis-roadmap-v3.md) · [ADR-0039](./ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md) (canonical roadmap, change-control, migration-allocation) · [ADR-0040](./ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md) (projection failure operations, migration 0006 gate) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) (provider-independent inference) · [agent-constitution.md](../governance/agent-constitution.md) · [authority-routing-data-access-matrix.md](../governance/authority-routing-data-access-matrix.md)

**New documents introduced:** [docs/architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md](../architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md) · [docs/governance/mvp-capability-activation-matrix.md](../governance/mvp-capability-activation-matrix.md) · [docs/operations/mvp-launch-readiness-runbook.md](../operations/mvp-launch-readiness-runbook.md)

> **This ADR defines a delivery overlay only. It implements nothing.** No runtime, adapter, migration, or SQL is created; no external system is accessed; no API key is used; no migration number is allocated. It does not renumber or replace any QFJ phase. Current QFJ-P03.07 work remains the active technical priority.

---

## Context

Canonical Roadmap v3.0 ([ADR-0039](./ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md)) defines the permanent architecture spine **QFJ-P00…P12**. It answers "what the system is" but not "what ships first." The owner needs a **product-delivery** view that divides the complete QF Jarvis product into a launchable MVP and a deferred expansion, **without** disturbing the canonical taxonomy, agent authority, or the event-backbone invariants, and **without** authorizing any implementation or migration by prose.

## Problems being resolved

- No explicit MVP-vs-Post-MVP boundary; risk of an unbounded first launch or of quietly dropping advanced capability.
- No single statement that advanced marketing/automation is deferred (not cancelled) and that Riya/Anisha/RAG are in the MVP.
- No capability-level activation model (a capability being built ≠ fully autonomous).
- Risk of the delivery view being read as new phases or as authorization to create migration 0006.

## Decision

1. **Exactly two product-delivery phases: `PHASE 1 — MVP LAUNCH` and `PHASE 2 — POST-MVP EXPANSION`.**
2. **These are product-delivery phases, not replacements for QFJ-P00…P12.** Every capability remains owned by its canonical QFJ phase (mapping in the overlay document).
3. **Every capability maps to its canonical QFJ owner** — model gateway → QFJ-P04.01; capability registry → QFJ-P04.02; governed RAG → QFJ-P04.03; evaluation/red-team → QFJ-P04.04; RAG provisioning → QFJ-P04.05; Jarvis orchestration → QFJ-P05; Riya → QFJ-P06; Anisha → QFJ-P07; consent/approval/human control → QFJ-P08; WhatsApp/execution lifecycle → QFJ-P09; Core integration → QFJ-P10; deployment/pilot/resilience → QFJ-P11; advanced agents/local intelligence → QFJ-P12.
4. **MVP launch has business priority.** The MVP scope (Jarvis coordination, Riya, Anisha full vendor lifecycle, text-only WhatsApp, Groq-active inference, RAG+pgvector, memory, controlled-learning foundation, LoRA/fine-tuning _foundation_, negotiation/payment/refund _workflows with authority controls_, minimal human control, focused analytics, active + warm-standby resilience) is locked in the overlay document.
5. **Advanced functions are deferred, not cancelled.** Marketing agents, local/hybrid inference _activation_, production custom models, advanced RAG, voice/image/document, advanced commercial automation, advanced analytics, active-active multi-region, and advanced Jarvis autonomy are Post-MVP.
6. **The overlay may authorize bounded implementation across existing QFJ phases only after required dependencies pass** their evaluation and authority gates — through the milestones M0–M5 (which are milestones _inside_ Phase 1, **not** new QFJ phases).
7. **Event-backbone invariants remain unchanged** (immutable event log; storage-sequence vs position; atomic handler+checkpoint; never skip; name+version advisory lock; fail-closed reconciliation — ADR-0021/0022/0034/0036/0037/0038/0040).
8. **QuickFurno Core remains the final business authority.**
9. **Jarvis, Riya, and Anisha receive no unrestricted financial, commercial, administrative, or destructive authority** — payments, refunds, verification, package activation, entitlements, and policy exceptions stay behind Core/human authorization ([authority-routing-data-access-matrix.md](../governance/authority-routing-data-access-matrix.md)).
10. **No migration is authorized by this documentation task.** Migration 0006 remains absent and is owned solely by QFJ-P03.07C under separate authorization; RAG/conversation persistence uses the next valid number only after 0006 under its own authorized design. **Migration 0007 is not created here.**

## Capability activation model

Every MVP capability is documented with a state from `DISABLED · SHADOW · HUMAN_APPROVAL · LIMITED_AUTONOMY · FULLY_ACTIVE · SUSPENDED`, plus activation owner, required approval, kill switch, rollback, evaluation gate, and authority boundary. **A capability being implemented does not imply it is fully autonomous.** Full matrix: [mvp-capability-activation-matrix.md](../governance/mvp-capability-activation-matrix.md).

## P03 and migration sequencing

QFJ-P03.07A is merged and locked; **QFJ-P03.07B is the next implementation slice**; **QFJ-P03.07C owns migration 0006** (which must not be reused for RAG, agents, tasks, memory, WhatsApp, model gateway, Core integration, or analytics); QFJ-P03.07D–G remain required and are not cancelled. MVP work may begin after its dependency gates, but **public launch must pass an event-backbone dependency audit**, and any customer-facing critical path that relies on projections/event-driven execution requires the relevant P03 failure-operation implementation to be complete before production activation. **The synchronous WhatsApp acknowledgement path must not depend on projection completion.**

## Rejected alternatives

- **New major QFJ phases for MVP/Post-MVP.** Rejected — this is a delivery overlay; renumbering the canonical spine violates ADR-0039's change-control rule.
- **Milestones as phases.** Rejected — M0–M5 are intra-Phase-1 milestones, not canonical phases.
- **Authorizing migration 0006 (or 0007) here.** Rejected — no migration is authorized by prose; 0006 stays with QFJ-P03.07C.
- **Marketing/automation in MVP.** Rejected — deferred to Post-MVP.
- **Granting agents financial/commercial autonomy to "move faster."** Rejected — Core/human authority is preserved.
- **Production LoRA as a launch requirement.** Rejected — the LoRA/fine-tuning _foundation_ is MVP; production activation is Post-MVP.

## Consequences

**Positive.** A clear, launchable MVP boundary; deferred-not-cancelled expansion; a capability-level activation model that keeps "built" distinct from "autonomous"; explicit dependency and migration sequencing; and preserved canonical taxonomy, agent authority, and backbone invariants.

**Migration/delivery.** No migration, SQL, source, or deployment. Migration 0006 remains absent and separately gated. QFJ-P03.07 remains the active technical priority; QFJ-P03.07B is not started by this task.

## Change-control rule

The overlay maps to, and never renumbers, the canonical spine. Changing the two-phase split, a capability's MVP/Post-MVP placement in a way that alters an authority boundary, migration ownership, or agent authority requires a superseding ADR. Advancing a capability's activation state (per the matrix, through its evaluation and approval gates) is an operational action, not an architecture change, and does not require a new ADR.
