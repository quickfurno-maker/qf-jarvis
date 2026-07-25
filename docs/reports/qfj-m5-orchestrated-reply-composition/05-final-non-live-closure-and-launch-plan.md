# Report 05 — Final Non-Live Closure and Staging-to-Launch Plan

**Slice:** QFJ-M5. **ADR:** [ADR-0059](../../decisions/ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) §A, §K.

## M5 is the final major non-live foundation

With M5 the runtime foundation is complete and wired end to end: M1 (authority-first runtime), M2 (double-gated orchestration), M3 (Core decision adapter), and M4 (model-gateway reply adapter) are composed by one **pre-transport** root behind **one authoritative content-free async state source**, proving `inbound → model draft → PENDING_CORE_VALIDATION proposal → Core decision` deterministically against deterministic fakes. **No further broad foundations are planned.** Everything remaining to launch is live integration, delivery/persistence, and the minimum operations surface.

## What remains deliberately out (unchanged)

No live Groq/local call; no key/token/env; no network/HTTP; no provider activation or rollout promotion; no live QuickFurno Core; no WhatsApp/webhooks/n8n/send/delivery; no persistence/DB/schema/**migration 0008**/managed DB; no real message data; no semantic retrieval/vector/embeddings/RAG; no dashboard; no deployment. Every concrete port implementation remains a deterministic fake under `./testing`. Binding a live provider or a live Core later is a **drop-in async implementation** of the already-async authoritative-state / gateway-invoker / Core-transport ports — no public contract of the lower packages breaks.

## Exact staging-to-launch plan (ADR-0059 §K)

After M5, in order:

1. **Live staging provider binding** — a real implementation of the M4 gateway invoker over the existing `@qf-jarvis/model-gateway` against a **staging** Groq/local provider (injected key holder, SSRF-guarded transport), behind the unchanged routing/rollout authority. No production activation.
2. **QuickFurno Core-side M3 protocol adoption** — the Core service implements the PROPOSED M3 command/response contract so the M3 transport can bind a real (staging) Core decision endpoint.
3. **Core-approved delivery command + n8n/WhatsApp transport** — only a `CORE_ACCEPTED` result may produce a delivery command, executed by n8n/WhatsApp as transport (which decides no business rule).
4. **Authoritative persistence / delivery states** — the conversation-state source and delivery outcomes become database-backed (the first migration beyond 0007), with the authoritative source implemented over managed storage.
5. **Minimum Conversation Operations Center** — the mandatory operator surface (human takeover / AI pause / escalation visibility) over the content-free snapshot contract already documented.
6. **Controlled pilot** — a bounded live pilot behind the rollout governance and evaluation approvals.

## Standing constraints (unchanged)

Riya client-only; Anisha vendor-only; Jarvis coordinator; **QuickFurno Core** is the final business authority and system of record; n8n is transport/execution only and decides no business rule; models/providers/evaluators/retrievers authorize and execute nothing; Kimi / Kimi K3 excluded. The **Conversation Operations Center** remains mandatory for a later slice and is **not** implemented here. Managed database / migration / live lanes remain paused; the `@qf-jarvis/event-backbone` root API remains 39; migrations 0001–0007 are byte-exact with no 0008.
