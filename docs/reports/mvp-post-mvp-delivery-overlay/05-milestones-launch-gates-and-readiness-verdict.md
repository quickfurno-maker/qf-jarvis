# Report 05 — Milestones, Launch Gates and Readiness Verdict

**Date:** 2026-07-22. **Documentation only — no implementation; no migration/SQL; no external access.** Source: [qf-jarvis-mvp-post-mvp-delivery-overlay.md](../../architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md), [mvp-launch-readiness-runbook.md](../../operations/mvp-launch-readiness-runbook.md).

## Milestones (inside Phase 1 — not phases)

| Milestone                                    | Scope                                                                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** — Governance and dependency readiness | overlay merged; QFJ-P03.07B complete; QFJ-P03.07C complete; migration 0006 created (separate authorization); Core authority contracts frozen; MVP capability matrix frozen |
| **M1** — Model and conversation foundation   | provider-neutral contracts; fake provider; Groq adapter; prompt assets; strict output; conversation state; durable queue; human-only fallback                              |
| **M2** — Riya and Anisha internal alpha      | agent workflows; templates; field extraction; handoff; synthetic/internal conversations                                                                                    |
| **M3** — RAG, memory and Core integration    | pgvector; knowledge lifecycle; memory; Core read/write contracts; audit and consent                                                                                        |
| **M4** — Commercial pilot                    | package recommendation; negotiation policy; approvals; payment cases; refund cases; renewal/upsell/retention                                                               |
| **M5** — Controlled production launch        | analytics; operational runbooks; warm standby; recovery test; security/evaluation gates; limited live users; human monitoring                                              |

**These milestones are not new canonical QFJ phases.**

## Launch gates (all must pass; no date promised)

Strict response-schema validation = 100% · unauthorized financial/commercial actions = 0 · duplicate accepted outbound reply = 0 · inbound dedup = 100% · opt-out enforcement = 100% · human takeover stops AI = 100% · secret leakage = 0 · provider-output validation = 100% · accepted inbound durability = 100% · payment/refund only via authority boundary = 100% · `LOCAL_ONLY` never uses hosted inference = 100% · RAG uses only approved active knowledge = 100% · raw conversations never auto-train production = 100% · rollback tested · Groq kill switch tested · HUMAN_ONLY tested · warm-standby recovery tested · no critical unresolved security incident · owner-approved limited-production cohort.

## Activation-state summary (launch)

- Groq base model: `ACTIVE`; Jarvis: `LIMITED_AUTONOMY`; Riya/Anisha: `HUMAN_APPROVAL → LIMITED_AUTONOMY`; RAG: `LIMITED_AUTONOMY` (approved knowledge only); commercial-policy engine: `FULLY_ACTIVE` (deterministic); payment/refund: `HUMAN_APPROVAL`; LoRA: `SHADOW`/`NOT_YET_TRAINED`; local custom model: `INTERNAL_TEST`/`DISABLED`; all Post-MVP capabilities: `DISABLED`. **Implemented ≠ fully autonomous.**

## Readiness verdict

The MVP/Post-MVP delivery overlay is internally consistent, maps every capability to its canonical QFJ owner without renumbering, preserves QuickFurno Core authority and event-backbone invariants, keeps migration 0006 absent and separately gated, and defines measurable launch gates and a conservative activation model. **Ready for owner review.**

## Explicit confirmations

- **Exactly two product-delivery phases;** no QFJ phase renumbering.
- **Advanced marketing agents are Post-MVP.**
- **Riya and Anisha are MVP; RAG and pgvector are MVP; controlled-learning foundation is MVP.**
- **LoRA/fine-tuning foundation is MVP, but production custom-model activation is not required for launch.**
- **Negotiation/payment/refund workflows are MVP with authority controls.**
- **Active region + warm standby is MVP; active-active is Post-MVP.**
- **No implementation occurred; no migration or SQL was created; migration 0006 remains absent; QFJ-P03.07B was not started.**
