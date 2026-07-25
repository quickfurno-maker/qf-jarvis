# Report 01 — ADR and Implementation Manifest

**Slice:** QFJ-M2 — Core Decision and Reply Orchestration Foundation. **ADR:** [ADR-0055](../../decisions/ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md).

## What this slice adds

An **orchestration** module inside `@qf-jarvis/agent-runtime` that composes the M1 authority-first runtime with an **injected model reply port** and an **injected QuickFurno Core decision port**. It turns an inbound request into a bounded model **reply plan**, a validated structured **draft**, a `PENDING_CORE_VALIDATION` **proposal**, and a Core **decision** — and it **sends nothing**. It initiates the QFJ-P05 Core proposal-validation / reply-composition step. ADR-0055 was committed **first**.

## Boundary (what it does NOT do)

No real QuickFurno Core integration, WhatsApp API, or provider webhook; no n8n; **no sending/transport/delivery-state mutation**; no persistence/DB/schema/**migration 0008**; no live model/provider/key/token; no semantic retrieval/RAG; no dashboard; no deployment. The orchestration module imports **none** of the P04 packages — everything is an injected port with a deterministic fake. `@qf-jarvis/event-backbone` root API remains **39**; migrations 0001–0007 byte-exact.

## Package layout (additive to agent-runtime)

```
packages/agent-runtime/src/orchestration/
  vocabularies.ts        proposal kinds / Core outcomes / reasons
  observability.ts       content-free OrchestrationEvent + hook + NOOP
  contracts.ts           OrchestrationContext, KnowledgeCitation, ReplyPlan, ModelReplyDraft,
                         OrchestrationProposal, CoreDecision, OrchestrationResult
  model-reply-port.ts    injected ModelReplyPort / ConversationContextPort / KnowledgePort
  core-decision-port.ts  injected QuickFurno Core decision port + request/response
  create-reply-plan.ts   pure provider-neutral plan builder
  validate-reply-draft.ts strict draft validation (no raw body/CoT; exact citations)
  orchestrate-inbound.ts  createOrchestrator + orchestrateInbound (15-stage, double-gated)
  index.ts               module barrel (re-exported from the package root)

packages/agent-runtime/src/testing/
  deterministic-orchestration-ports.ts  scripted context/model/Core/knowledge fakes (./testing)
```

## Commits (ADR-first, small, auditable)

1. `docs(adr): define M2 Core decision orchestration` — ADR-0055 (committed first).
2. `feat(agent-runtime): add model and Core decision ports`.
3. `feat(agent-runtime): enforce proposal orchestration gates`.
4. `test(agent-runtime): prove Core authority and no-send boundary`.
5. `docs(reports): record M2 orchestration evidence` (this report set + roadmap).

## Base

Branch `qfj-m2-core-decision-reply-orchestration`, created from the exact post-M1 main
`7a4e8d4b6ddb254052f8072719b908d67f35e732`. DRAFT PR only — **do not merge** until owner acceptance.
