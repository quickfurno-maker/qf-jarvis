# Jarvis durable orchestration architecture

```text
QuickFurno Web / WhatsApp / Android / Jarvis OS
                    │
                    ▼
              Jarvis Gateway
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
   Mastra / Agents      Temporal Client
 Riya Anisha Aarohi       signalWithStart
          │                   │
          └─────────┬─────────┘
                    ▼
          TEMPORAL DURABLE PLANE
      timers • signals • retries • recovery
        Continue-As-New • visibility
                    │
                    ▼
          Temporal Activity Worker
                    │
           agent/model reasoning
                    │
                    ▼
             ACTION KERNEL
       fingerprint • single-flight • audit
                    │
                    ▼
           QUICKFURNO CORE API
        authorization • business rules
                    │
                    ▼
       QUICKFURNO CORE AUTOMATION
      authorized effects • idempotency
                    │
                    ▼
        WhatsApp / other providers
                    │
                    ▼
          QuickFurno Core truth
                    │
             canonical events
                    └──────────────► wake Temporal journey
```

## Non-negotiable separation

**Intelligence plane:** Mastra, Riya, Anisha, Aarohi, Jarvis, model router, RAG.
**Durability plane:** Temporal.
**Submission-control plane:** Action Kernel.
**Authority + execution plane:** QuickFurno Core + Core Automation.
**Truth/event plane:** QuickFurno Core canonical state and Jarvis event backbone/read models.

Temporal may decide *when to run the next cycle*. It may not decide whether a business effect is
permitted. Action Kernel may decide whether a proposal is structurally safe to submit. It may not
approve it. Only Core authorizes, and only Core Automation executes an authorized effect.

## Why native Temporal, not the Mastra Temporal package

Mastra remains central to agent intelligence. The production durability layer uses Temporal's stable
TypeScript SDK directly because the current Mastra Temporal package is still explicitly experimental.
This avoids coupling Jarvis's most reliability-sensitive control plane to an experimental adapter while
preserving the option to adopt it later when it reaches production maturity.

## Privacy posture

Temporal's persistence is treated as infrastructure metadata, not a conversation database. Workflow
history receives references such as `lead.8421`, `conversation.19`, event IDs, phases, counters and
reason codes. Model prompts, generated replies and personal contact information stay outside workflow
history.
