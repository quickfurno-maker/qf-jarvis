# Report 02 — Provider Contracts and Operating Modes

**Date:** 2026-07-21. **Documentation only — no provider implemented, no API called, no key used, no WhatsApp activated, no migration created. QFJ-P03 remains the active priority.** Authoritative source: [model-provider-independence.md](../../architecture/model-provider-independence.md), [ADR-0041](../../decisions/ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md).

## Provider-independence contract

```
Riya / Anisha runtime → repository-owned ModelProvider → selected adapter → provider SDK/HTTP (never crosses the boundary)
```

- Conceptual adapters: `GroqProvider`, `LocalOpenAICompatibleProvider`, `FakeModelProvider`, future approved adapters.
- **Riya, Anisha, WhatsApp webhook, memory, queues, RAG, human handoff, and QuickFurno integration must not import Groq-specific or local-model-specific types.**
- A provider change requires **only**: configuration, adapter activation, a model identifier, and compatibility + evaluation approval.
- A provider change must **not** require rewriting: Riya, Anisha, WhatsApp webhook, queue workers, delayed delivery, memory, RAG, task contracts, human handoff, or QuickFurno Core contracts.

## Operating modes

| Mode                 | Primary | Fallback         | Failure                                         | Privacy                              | Health                             | Timeout          | Cost                                      | Capacity                         | Handoff              | Rollback                                   |
| -------------------- | ------- | ---------------- | ----------------------------------------------- | ------------------------------------ | ---------------------------------- | ---------------- | ----------------------------------------- | -------------------------------- | -------------------- | ------------------------------------------ |
| GROQ_CLOUD           | Groq    | none             | fail closed → queue/retry → human               | minimized/sanitized only             | Groq reachable + budget            | bounded          | token budget + rate cap                   | provider rate limits             | on outage/exhaustion | → LOCAL_PC or HUMAN_ONLY                   |
| LOCAL_PC             | Local   | none             | fail closed → queue/retry → human               | on-prem; no hosted egress            | node healthy (GPU, model)          | bounded          | local compute budget                      | GPU/session cap                  | on node-down         | → GROQ_CLOUD or HUMAN_ONLY                 |
| HYBRID_LOCAL_PRIMARY | Local   | Groq (explicit)  | primary fail → single explicit fallback → human | restricted content stays local/human | local healthy; Groq for fallback   | bounded/provider | prefer local; cloud on fallback           | local first, cloud on saturation | both unavailable     | disable fallback → LOCAL_PC / HUMAN_ONLY   |
| HYBRID_GROQ_PRIMARY  | Groq    | Local (explicit) | primary fail → single explicit fallback → human | cloud primary; local for continuity  | Groq reachable; local for fallback | bounded/provider | prefer cloud in budget; local on fallback | cloud first, local on saturation | both unavailable     | disable fallback → GROQ_CLOUD / HUMAN_ONLY |
| HUMAN_ONLY           | humans  | none             | all to humans                                   | strictest; no model sees content     | always available                   | n/a              | n/a                                       | staffing-bounded                 | is the mode          | re-enable a provider profile               |

## Fallback safety

- **Explicit only** — no unexpected provider fallback.
- The runtime **does not call both providers for every message**; fallback triggers only on a defined primary failure/health/timeout condition.
- **No fallback creates a duplicate outbound reply**: one inbound message → at most one accepted outbound result (idempotency key on the conversation turn).
- Fallback is **idempotent**; `HUMAN_ONLY` is **always available**.

## Agent ownership (unchanged by provider selection)

Provider selection never alters agent authority. **Riya** — Customer Conversation and Qualification Agent. **Anisha** — Vendor Sales, Relationship and Success Agent (complete vendor lifecycle; **not** narrowed to onboarding/support). QuickFurno Core = final business authority; Jarvis recommends/coordinates; n8n executes approved intents; providers deliver only.

## Compatibility verdicts

- **Groq compatibility:** COMPATIBLE via `GroqProvider` behind the `ModelProvider` contract; requires only config + model id + evaluation approval.
- **Local-PC compatibility:** COMPATIBLE via `LocalOpenAICompatibleProvider` (OpenAI-compatible local server) behind the same contract.
- **Hybrid compatibility:** COMPATIBLE via QFJ-P04.01D routing/failover with explicit, idempotent, non-duplicating fallback and the five QFJ-P11.06 profiles.
