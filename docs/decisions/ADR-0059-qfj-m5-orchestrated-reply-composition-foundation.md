# ADR-0059 — QFJ-M5 Orchestrated Reply Composition Foundation

**Status:** Accepted (2026-07-25) — QFJ-M5 (one pre-transport Jarvis composition root wiring M1–M4 behind ONE authoritative content-free async conversation-state source; no live call, no send, no persistence). **This is the FINAL major non-live foundation slice.**
**Deciders:** Owner
**Phase:** QFJ-M5 / MVP Runtime — Orchestrated Reply Composition Foundation (the Jarvis runtime composition root of [QFJ-P05 Jarvis Orchestration](../architecture/qf-jarvis-roadmap-v3.md))

**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) (M1 runtime) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) (M2 orchestration) · [ADR-0056](./ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) (M3 Core adapter) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) (M4 model reply adapter) · [ADR-0058](./ADR-0058-asynchronous-runtime-integration-boundaries.md) (async runtime boundaries) · [ADR-0025](./ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md)

**Design documents introduced:** [docs/reports/qfj-m5-orchestrated-reply-composition/](../reports/qfj-m5-orchestrated-reply-composition/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds one new package `@qf-jarvis/jarvis-runtime`: a single **pre-transport composition root** that wires the already-merged M1 runtime, M2 orchestration, M3 Core decision adapter, and M4 model reply adapter into one deterministic, fail-closed, async end-to-end flow — inbound → model draft → `PENDING_CORE_VALIDATION` proposal → Core decision — behind **ONE authoritative content-free async conversation-state source** that every lower state reader delegates to. It **duplicates no business rule** (assignment, privacy, model routing/fallback, reply validation, Core validation all stay in the lower packages), performs **no delivery, persistence, or live call**, and is the **FINAL major non-live foundation**. After M5, work moves to live staging integration, delivery/persistence, and the minimum Conversation Operations Center. QuickFurno Core remains the only business authority; model output is a draft only. The `@qf-jarvis/event-backbone` root API remains **39**; migrations 0001–0007 are unchanged and there is no migration 0008.

---

## Context

QFJ-M1–M4 delivered the runtime foundation as separately-tested packages: the M1 authority-first runtime and router, the M2 double-gated orchestrator with injected model/Core/knowledge/context ports, the M3 concrete `CoreDecisionPort` behind a narrow transport, and the M4 concrete `ModelReplyPort` composing the existing model gateway. Each was proven against deterministic fakes in isolation. What did **not** yet exist is a single composition root that wires them together end-to-end — and, critically, that guarantees they all observe **the same** conversation state rather than three independently-injected readers that could disagree (a split-brain). ADR-0058 made every I/O-capable boundary asynchronous, so the composition is async end-to-end. This slice adds that root, deterministically and behind fakes only, and closes the non-live foundation.

## Decision

### A. Purpose

One pre-transport Jarvis composition root that wires M1–M4 without duplicating policy or business logic, proving `inbound → model draft → PENDING_CORE_VALIDATION proposal → Core decision`. No delivery, persistence, or live calls. M5 is the **final major non-live foundation**.

### B. Package

`packages/jarvis-runtime/` (`@qf-jarvis/jarvis-runtime`). Dependency direction is **one-way**, only from `jarvis-runtime` to the lower stable packages (`@qf-jarvis/agent-runtime`, `@qf-jarvis/core-decision-adapter`, `@qf-jarvis/model-reply-adapter`). No reverse dependency, no global mutable singleton, no database, no persistence.

### C. One authoritative conversation-state source

Define one **injected async content-free** source: `AuthoritativeConversationStatePort.read(conversationId): Promise<ConversationControlState>`. The state carries only safe fields: conversation id, tenant id, revision, assigned-relevant party type, data class, conversation-control flags (AI pause, human takeover, cancellation), subject privacy/tombstone status, an optional opaque subject reference, and a canonical observed-at instant/reference. **All M1/M2/M3/M4 state readers used by the composition (the orchestrator's conversation-context port, the M3 `CoreDecisionStateReader`, the M4 `ReplyStateReader`, and the privacy gate) delegate to the SAME source instance** via thin projection adapters — never to independent state.

### D. Split-brain prevention

No module-local competing state authority. No cached state is reused across an awaited boundary without revision binding and a re-read: each lower adapter re-reads the authoritative source at its own pre/post gate, so a change during any await is observed and fails closed. Incompatible revision/assignment/privacy views fail closed. The composition root does **not** reconcile business state — QuickFurno Core remains authoritative.

### E. Composition order

1. validate inbound; 2. read authoritative state; 3. M1 assignment/scope/takeover/pause/privacy; 4. exact optional governed knowledge via the existing injected port; 5. M4 model reply adapter through the existing gateway boundary; 6. post-model authoritative state re-read; 7. M2 `PENDING_CORE_VALIDATION` proposal; 8. M3 Core decision adapter; 9. post-Core state re-read; 10. immutable runtime result; 11. no send/delivery/persistence. (Steps 2/6/8/9 all read the single authoritative source; the double gate and the M3/M4 pre/post gates are preserved.)

### F. Closed result

Closed runtime outcomes: `REFUSED`, `MODEL_DRAFTED`, `CORE_ACCEPTED`, `CORE_REJECTED`, `HUMAN_REVIEW_REQUIRED`, `RETRY_LATER`, `STALE_REVISION`, `CORE_UNAVAILABLE`, `NO_ACTION`. `CORE_ACCEPTED` means an **exact Core approval only** — never sent, delivered, executed, or persisted — and retains the exact proposal/conversation/revision references. `MODEL_DRAFTED` is a validated draft/proposal with the Core decision deliberately deferred (no Core transport wired). `NO_ACTION` is reserved for a non-`REPLY` model outcome and is not produced by the current `REPLY`-only orchestration (it is not fabricated here). No raw errors; the result is deeply frozen.

### G. Configuration

`createJarvisRuntime` receives the injected authoritative state source, the model identity (release/prompt/capability/evaluation), the injected model gateway invoker, the injected Core transport dependencies, an optional injected knowledge port, safe observability hooks, and deterministic time/id inputs. A missing **mandatory** dependency (authoritative state, model identity, policy, clock) fails closed at construction; a missing optional integration dependency (gateway invoker, Core transport, knowledge port) fails closed at runtime through the lower adapter (`MODEL`-unavailable refusal / `CORE_UNAVAILABLE` / no retrieval). No `process.env`, service locator, or global registry.

### H. Observability

Correlated **content-free** stage events only: safe ids, actors, parties, revisions, stages, outcomes, references, and timestamps/counters. Never message/reply/prompt/knowledge content, subject content, PII, secret, raw error, or chain-of-thought.

### I. Authority

QuickFurno Core is the final authority; the model draft is a proposal input only; Jarvis coordinates; n8n is absent; there is no send/deliver/execute/persist. Riya is client-only; Anisha is vendor-only; the Conversation Operations Center is a mandatory later phase (not implemented here); Kimi is excluded.

### J. Non-goals

No live provider/Core call; no secrets/env; no provider activation/rollout; no WhatsApp/n8n/send/delivery; no persistence/DB/schema/migration 0008; no RAG/semantic retrieval; no dashboard; no deployment.

### K. Next mandatory launch work

After M5 there are **no more broad foundations**. The roadmap moves to: (1) live staging provider binding through the model gateway; (2) QuickFurno Core-side M3 protocol adoption; (3) a Core-approved delivery command plus n8n/WhatsApp transport; (4) authoritative persistence/delivery states; (5) the minimum Conversation Operations Center; (6) a controlled pilot.

## Consequences

- The runtime finally has a single wired entry point (`createJarvisRuntime(...).processInbound(envelope)`) proving the end-to-end proposal flow deterministically, with one authoritative state source guaranteeing no split-brain across the awaited M1–M4 boundaries.
- Binding a live provider or a live Core later is a drop-in async implementation of the already-async authoritative-state/gateway/transport ports — no public contract of the lower packages breaks.
- Because the root only wires and projects, all M1–M4 authority, containment, fail-closed, and at-most-once invariants are preserved and re-proven end-to-end.
