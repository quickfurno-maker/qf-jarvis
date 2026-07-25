# ADR-0058 — Asynchronous Runtime Integration Boundaries

**Status:** Accepted (2026-07-25) — cross-cutting runtime correction (make every I/O-capable runtime port `Promise`-based before a live provider/Core binding exists)
**Deciders:** Owner
**Phase:** QFJ-M4 async-compatibility correction (applies across QFJ-M1 runtime, QFJ-M2 orchestration, QFJ-M3 Core adapter, QFJ-M4 model reply adapter)

**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) (M1 runtime) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) (M2 orchestration / `ModelReplyPort`, `CoreDecisionPort`) · [ADR-0056](./ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) (M3 Core adapter) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) (M4 model reply adapter) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (model gateway; already async `invoke(): Promise<ModelResponse>`)

> **This ADR corrects a runtime-shape decision, not an authority or safety decision.** The M1–M4 ports that may cross a network, database, provider, QuickFurno Core, privacy, knowledge, or conversation-state boundary were declared **synchronous** while every concrete implementation was still a deterministic in-memory fake. A live model provider and a live QuickFurno Core decision transport are asynchronous I/O; the existing `@qf-jarvis/model-gateway` already exposes `invoke(request, options?): Promise<ModelResponse>`. Shipping synchronous public ports now would force a breaking runtime redesign immediately before a live binding. This ADR makes every I/O-capable runtime port genuinely `Promise`-based **now**, while adding **no** live provider, key, network, send, delivery, persistence, or database. It **supersedes any implicit synchronous assumption** in ADR-0055, ADR-0056, and ADR-0057 **without** rewriting their authority, containment, or fail-closed decisions. QuickFurno Core remains the only business authority; model output remains a draft/proposal. The `@qf-jarvis/event-backbone` root API remains **39**; migrations 0001–0007 are unchanged and there is no migration 0008.

---

## Context

QFJ-M2 defined injected, provider-neutral ports — `ConversationContextPort`, `KnowledgePort`, `ModelReplyPort`, `CoreDecisionPort`, and the M1 `ConversationPrivacyGate` — and proved the orchestrator turns a plan into a validated draft, a `PENDING_CORE_VALIDATION` proposal, and a Core decision. QFJ-M3 added a concrete `CoreDecisionPort` behind an injected `CoreDecisionTransport`; QFJ-M4 added a concrete `ModelReplyPort` behind an injected `ModelGatewayInvoker`. Because no phase authorized a live call, all of these were declared **synchronous** with in-memory fakes.

Real integration is asynchronous: a model provider, a Core decision service, a database-backed state/privacy read, and a governed-knowledge lookup all perform I/O and return a `Promise`. The model gateway already reflects this (`invoke(): Promise<ModelResponse>`). Leaving the runtime ports synchronous would mean that the first live binding rewrites every public port signature and every awaiting call site at once — a breaking change at the worst possible time. This ADR fixes the boundary **shape** now, deterministically and behind fakes, so a later live binding is an implementation swap, not a contract break.

## Decision

1. **I/O-capable ports return `Promise<T>`.** Every runtime boundary that may perform network, database, provider, QuickFurno Core, privacy/tombstone, knowledge, or conversation-state I/O returns `Promise<T>`. This covers, at minimum: the M2 `ConversationContextPort.read`, `KnowledgePort.retrieve`, `ModelReplyPort.draftReply`, and `CoreDecisionPort.decide`; the M1 `ConversationPrivacyGate.subjectStatus` and `RuntimeModelInterface.draftReply`; the M3 `CoreDecisionTransport.send` and `CoreDecisionStateReader.read`; and the M4 `ModelGatewayInvoker.invoke` and `ReplyStateReader.read`.

2. **The orchestration entry points are asynchronous and await each stage in order.** `orchestrateInbound` and `processInbound` return a `Promise`, and each external stage is `await`ed in its existing deterministic order — context read, privacy gate, knowledge, model, double-gate re-read, Core.

3. **Pure functions stay synchronous.** Schema validation, canonical serialization, digest computation, instant validation, classification, plan construction, and frozen-object factories remain synchronous; they perform no I/O and must not be wrapped in a `Promise`.

4. **Deterministic test fakes are asynchronous.** Every fake for an I/O-capable port is `async` (resolves or rejects a `Promise`) and may support a controlled resolution, a controlled rejection, an invocation count, and a state mutation observed on a later read. Fakes remain under `./testing` and stay absent from every root barrel.

5. **No sync-over-async blocking.** No `Atomics.wait`, no busy/polling loop, no deasync, no synchronous spawn of a child process, and no other hidden event-loop block is introduced to make an async boundary look synchronous. A `T | Promise<T>` ambiguous contract is disallowed — a boundary is either synchronous (pure) or `Promise`-returning (I/O-capable), never both.

6. **Pre-call and post-result gates surround awaited external work.** Each awaited external call is bracketed by a content-free state/privacy gate read before it and (where the existing design already re-reads) after it — the M2 double gate, the M3 pre/post-transport gate, and the M4 pre/post-gateway gate are all preserved across the `await`.

7. **A state change while awaiting invalidates the result.** If the revision, party/assignment, human-takeover, AI-pause, cancellation, or privacy/tombstone status changes while an external `Promise` is pending, the post-await gate fails closed: no draft is produced, no Core `ACCEPTED` is returned, and nothing is sent.

8. **At most one call per external port per orchestration attempt.** The model gateway invoker and the Core transport are each invoked at most once per attempt. Any bounded retry belongs **only** to the existing model gateway, which internally owns retry/backoff/timeout/circuit; the runtime does not re-drive it.

9. **No independent retry loops.** The agent runtime, the model reply adapter, and the Core decision adapter own **no** retry loop, backoff, or re-invocation of their injected ports.

10. **Cancellation is forwarded, not reinvented.** An `AbortSignal` is forwarded to an external port **only** where the existing canonical gateway already accepts one (`invoke(request, { signal })`). The runtime introduces no competing cancellation protocol; stale/cancelled state is still enforced by the content-free state gate around the awaited call.

11. **Authority is unchanged.** Model/provider output remains a **draft/proposal input only**; QuickFurno Core remains the **only** business authority and system of record; the runtime fabricates no `ACCEPTED`. Making a boundary async changes when a value arrives, never who decides.

12. **No live integration is added.** This correction adds no live Groq/local call, no key/token/env, no network/HTTP, no provider activation or rollout promotion, no WhatsApp/n8n/send/delivery, and no persistence/DB/schema/migration. Every concrete port implementation remains a deterministic fake under `./testing`.

## Consequences

- The public port signatures across `@qf-jarvis/agent-runtime`, `@qf-jarvis/core-decision-adapter`, and `@qf-jarvis/model-reply-adapter` become `Promise`-returning; awaiting call sites and every deterministic fake are updated in lockstep. Because the change is a shape correction behind fakes, all prior M1–M4 authority, containment, and fail-closed invariants are preserved and re-proven.
- A later, separately authorized slice can bind a live model gateway and a live Core transport by supplying an `async` implementation of the already-async ports — no public contract breaks.
- Pure validation/digest/schema code is deliberately left synchronous, keeping the async surface confined to genuine integration boundaries.

## Non-goals

No live provider/Core call; no keys/tokens/env; no network; no activation or rollout promotion; no send/delivery/WhatsApp/n8n; no persistence/DB/schema/migration 0008; no knowledge retrieval or RAG; no dashboard; no deployment; no change to the event-backbone root API (remains 39) or the locked migrations 0001–0007.
