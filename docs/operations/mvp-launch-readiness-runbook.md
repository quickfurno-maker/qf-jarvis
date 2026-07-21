# QF Jarvis — MVP Launch-Readiness Runbook (design)

**Status:** Future operational runbook **design** (MVP delivery overlay). Adopted 2026-07-22 under [ADR-0042](../decisions/ADR-0042-mvp-and-post-mvp-delivery-overlay-and-controlled-launch-sequencing.md). Read with [qf-jarvis-mvp-post-mvp-delivery-overlay.md](../architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md) and [mvp-capability-activation-matrix.md](../governance/mvp-capability-activation-matrix.md).

> **This is a readiness design, not live launch instructions.** Nothing here is implemented; all commands/consoles referenced are **conceptual** and marked `[UNIMPLEMENTED]`. No external system is accessed; no date is promised.

## Milestone readiness (Phase 1 milestones, not phases)

- **M0 — Governance and dependency readiness:** delivery overlay merged; QFJ-P03.07B complete; QFJ-P03.07C complete; migration 0006 created through separate authorization; Core authority contracts frozen; MVP capability matrix frozen.
- **M1 — Model and conversation foundation:** provider-neutral contracts; fake provider; Groq adapter; prompt assets; strict output; conversation state; durable queue; human-only fallback.
- **M2 — Riya and Anisha internal alpha:** agent workflows; templates; field extraction; handoff; synthetic/internal conversations only.
- **M3 — RAG, memory and Core integration:** pgvector; knowledge lifecycle; memory; Core read/write contracts; audit and consent.
- **M4 — Commercial pilot:** package recommendation; negotiation policy; approvals; payment cases; refund cases; renewal/upsell/retention.
- **M5 — Controlled production launch:** analytics; operational runbooks; warm standby; recovery test; security/evaluation gates; limited live users; human monitoring.

Each milestone completes only when its scope is built **and** its relevant launch gates (below) pass. Milestones are not canonical QFJ phases.

## Launch gates checklist (all must pass before limited-production activation)

| Gate                                          | Target   | How verified (design)                  |
| --------------------------------------------- | -------- | -------------------------------------- |
| Strict response-schema validation             | 100%     | reject any non-conforming model output |
| Unauthorized financial/commercial actions     | 0        | authority-boundary tests + audit       |
| Duplicate accepted outbound reply             | 0        | outbound idempotency proof             |
| Inbound message deduplication                 | 100%     | webhook dedup tests                    |
| Opt-out enforcement                           | 100%     | consent/opt-out tests                  |
| Human takeover stops AI                       | 100%     | takeover drill                         |
| Secret leakage                                | 0        | log/trace redaction audit              |
| Provider-output validation                    | 100%     | gateway validation tests               |
| Accepted inbound-message durability           | 100%     | queue durability + crash tests         |
| Payment/refund only via authority boundary    | 100%     | Core-authority routing tests           |
| `LOCAL_ONLY` never uses hosted inference      | 100%     | data-class routing tests               |
| RAG uses only approved active knowledge       | 100%     | lifecycle enforcement tests            |
| Raw conversations never auto-train production | 100%     | pipeline gating tests                  |
| Rollback tested                               | yes      | deployment rollback drill              |
| Groq kill switch tested                       | yes      | kill-switch drill → HUMAN_ONLY         |
| HUMAN_ONLY tested                             | yes      | emergency-mode drill                   |
| Warm-standby recovery tested                  | yes      | failover drill + restore test          |
| Critical unresolved security incident         | none     | security review sign-off               |
| Owner-approved limited-production cohort      | required | explicit owner approval                |

## Event-backbone dependency audit (pre-launch, mandatory)

Before production activation, confirm: QFJ-P03.07 failure operations required by the customer-facing critical path are complete (dead-letter/quarantine/authorized-replay per [projection-failure-operations.md](../architecture/projection-failure-operations.md)); migrations applied under their own authorization; and **the synchronous WhatsApp acknowledgement path does not depend on projection completion** (ack is durable-queue-backed, not projection-backed). Any customer-facing path relying on projections/event-driven execution must have its P03 failure-operation implementation complete first.

## Operational procedures (conceptual)

- **Detect / monitor:** `[UNIMPLEMENTED]` dashboards for latency, failures, cost, handoff backlog, provider health, dedup counters, opt-out enforcement.
- **Kill switches:** `[UNIMPLEMENTED]` Groq kill switch (→ HUMAN_ONLY), global AI pause, per-conversation AI pause; each stops automatic replies immediately.
- **Human takeover:** `[UNIMPLEMENTED]` operator takes ownership → automatic replies stop until resumed.
- **Provider outage:** degrade to `HUMAN_ONLY`; inbound messages stay durably queued and are never lost.
- **Rollback:** redeploy prior version; retire the offending knowledge/model version; queue drains safely.
- **Warm-standby recovery:** promote standby region; restore from backup; verify queue and conversation continuity.
- **Incident closure:** capture evidence, attribute actions, record cause and decision; re-authorize any `SUSPENDED` capability before resuming.

## Prohibited at launch

Activating Post-MVP capabilities (marketing/specialist agents, local/hybrid inference, production LoRA, advanced RAG/voice/image, advanced automation, active-active); granting agents financial/commercial/administrative/destructive authority; auto-training on raw conversations; letting RAG override live Core facts; promising a launch date in repository governance; creating migration 0006 or 0007 outside their authorized slices.

## Not a launch date

This runbook defines **readiness**, not a schedule. Launch proceeds only when all gates pass and the owner approves a limited-production cohort.
