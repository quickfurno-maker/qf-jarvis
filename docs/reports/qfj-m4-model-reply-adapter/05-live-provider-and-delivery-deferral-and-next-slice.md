# Report 05 — Live Provider Configuration and Delivery Deferral; Next Slice

**Slice:** QFJ-M4. **ADR:** [ADR-0057](../../decisions/ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) (§ Non-goals, § Consequences).

## What is deliberately deferred

This slice is the **drafting seam only**. It implements the adapter shape, the exact request translation, the strict result/provenance/citation validation, and the pre/post-gateway state gate **against deterministic fakes only**. Explicitly **out of scope** and awaiting separate, owner-authorized slices:

1. **A live async gateway binding.** The M2 `ModelReplyPort` is synchronous and this phase authorizes no credential/network, so the gateway is reached through a **synchronous injected invoker facade** with fakes only. A real invocation of the existing gateway's async `invoke` (and the sync/async bridge, cancellation `AbortSignal`, and backpressure policy it needs) is a later slice.
2. **Live Groq/local provider calls.** No live provider is contacted; the gateway's real providers, key holders, and HTTP transports are **not** wired here.
3. **Provider keys / tokens / environment.** No key, token, or `process.env` access; no endpoint provisioning.
4. **Provider activation and rollout promotion.** The adapter activates no release and promotes no rollout mode; the P04.01E rollout controller and P04.04 evaluation approval remain the sole authorities for those.
5. **Delivery / execution.** A validated draft is only an **input** to the M2 proposal / Core-decision flow. Sending, delivering, executing, n8n orchestration, and WhatsApp transport remain out of scope and are Core/n8n responsibilities.
6. **Persistence, live Core, knowledge retrieval, RAG, dashboard, deployment.** Unchanged from M1–M3 — none are touched; **migration 0008** is absent; semantic/vector/embedding/RAG stays disabled.

## Why this ordering is safe

The adapter **cannot** select a provider, invent a fallback, activate a release, fabricate a Core `ACCEPTED`, or expose a send/execute surface — and it fails closed on any state change, provenance mismatch, malformed output, or unauthorized citation. Shipping the drafting seam before a live provider binding therefore introduces **no** live provider, credential, routing-authority, or send risk: every path terminates in a validated draft or a safe fail-closed reason.

## Suggested next launch slice

**QFJ-M5 — Orchestrated reply-drafting composition (still no live provider).** Compose the M4 adapter into the M2 orchestrator's `ModelReplyPort` injection point behind the still-injected synchronous invoker, and add a deterministic end-to-end proof that an inbound envelope produces a `PENDING_CORE_VALIDATION` proposal whose reply body came through the gateway request/validation path — keeping live provider, keys, activation, delivery, and persistence deferred. This advances the QFJ-P05 Jarvis reply pipeline one composed step without crossing any not-authorized line.

## Standing constraints (unchanged)

Riya client-only; Anisha vendor-only; Jarvis coordinator; **QuickFurno Core** is the final business authority and system of record; n8n is transport/execution only and decides no business rule; models/providers/evaluators/retrievers authorize and execute nothing; Kimi / Kimi K3 excluded. The **Conversation Operations Center** remains mandatory for a later slice and is **not** implemented here (no dashboard, WhatsApp, persistence, or n8n). Managed database/live lanes remain paused.
