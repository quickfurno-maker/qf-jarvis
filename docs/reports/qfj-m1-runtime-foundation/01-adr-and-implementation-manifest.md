# Report 01 — ADR and Implementation Manifest

**Slice:** QFJ-M1 — Agent and Conversation Runtime Foundation. **ADR:** [ADR-0054](../../decisions/ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md).

## What this slice adds

One dedicated, provider-neutral package — **`@qf-jarvis/agent-runtime`** — the **deterministic, authority-first** spine for the future WhatsApp coordinator: who an inbound conversation is assigned to, what state it is in, whether a human has taken over, and what **proposals** the runtime produces. It **initiates QFJ-P05 (Jarvis Orchestration)** — the coordinator/routing/human-escalation runtime whose exit gate is "zero agents registered" and whose exclusions are "no execution; no message sent." ADR-0054 was committed **first**.

## Boundary (what it does NOT do)

No transport/provider/database/n8n coupling; **no WhatsApp API, no dashboard UI, no persistence, no live model call, no real message data**; no memory/RAG/tools/execution; no deployment. Depends only on `zod`. Migrations 0001–0007 byte-exact; **no 0008**; `@qf-jarvis/event-backbone` root API remains **39**. QuickFurno Core remains final authority.

## Package layout

```
packages/agent-runtime/
  package.json            (@qf-jarvis/agent-runtime; exports "." and "./testing"; dep: zod)
  tsconfig.build.json     (emitting build; EXCLUDES src/tests → production-only dist)
  tsconfig.json           (noEmit typecheck incl. tests)
  src/
    contracts/
      vocabularies.ts        closed actors/party/channel/direction/state/data-class/proposal/reason
      errors.ts              AgentRuntimeError + closed codes
      instant.ts             pure canonical-instant validator (no wall-clock read)
      scope.ts               actor↔party rule (Riya client-only, Anisha vendor-only)
      inbound-envelope.ts     content-minimized inbound envelope
      conversation-context.ts content-free conversation context
      proposals.ts           authority-first proposals (PENDING_CORE_VALIDATION; no execute/send)
      conversation-state.ts   validated state machine (authorized-only return-to-AI)
      policy.ts              versioned routing policy
      privacy-gate.ts        injected ConversationPrivacyGate interface
      observability.ts       content-free RuntimeEvent + hook + NOOP
      operations-center.ts   documented future dashboard projection contract (no impl)
    router/
      assign-agent.ts        pure deterministic assignment
    runtime/
      create-agent-runtime.ts injected-collaborator runtime factory
      process-inbound.ts      the authority-first, fail-closed, proposal-only decision
    testing/
      deterministic-privacy-gate.ts  the only shipped gate impl (./testing)
      fixtures.ts            synthetic envelope/context/policy + throwing model interface
      index.ts               ./testing barrel
    index.ts                 public root barrel
    tests/                   deterministic specs (excluded from dist)
```

## Commits (ADR-first, small, auditable)

1. `docs(adr): define QFJ-M1 runtime foundation` — ADR-0054 (committed first).
2. `feat(agent-runtime): add authority-first runtime contracts`.
3. `feat(agent-runtime): enforce assignment and human takeover gates`.
4. `test(agent-runtime): prove privacy scope and Core authority`.
5. `docs(reports): record QFJ-M1 runtime foundation evidence` (this report set + roadmap).

## Base

Branch `qfj-m1-agent-conversation-runtime-foundation`, created from the exact post-P04.05 main
`612c4ac5758bf5ff5e7197bc0504fdb84a1927c1`. DRAFT PR only — **do not merge** until owner acceptance.
