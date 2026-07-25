# ADR-0054 — QFJ-M1 Agent and Conversation Runtime Foundation

**Status:** Accepted (2026-07-25) — QFJ-M1 (initiates QFJ-P05 Jarvis Orchestration runtime)
**Deciders:** Owner
**Phase:** QFJ-M1 / MVP Runtime — Authority-First Agent and Conversation Runtime Foundation (the coordinator/routing/human-escalation core of [QFJ-P05 Jarvis Orchestration](../architecture/qf-jarvis-roadmap-v3.md); foundations for P05.01 Agent Registry + P05.04 Routing and Coordination + P05.06 Human Escalation)

**Relates to:** [ADR-0053](./ADR-0053-qfj-p04-05-no-op-rag-provisioning.md) · [ADR-0052](./ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md) · [ADR-0051](./ADR-0051-qfj-p04-03-governed-knowledge-system.md) · [ADR-0049](./ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · design docs [agent-model.md](../architecture/agent-model.md), [communication-model.md](../architecture/communication-model.md), [responsibility-matrix.md](../architecture/responsibility-matrix.md), [system-boundary.md](../architecture/system-boundary.md)

**Design documents introduced:** [docs/reports/qfj-m1-runtime-foundation/](../reports/qfj-m1-runtime-foundation/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds one new provider-neutral package `@qf-jarvis/agent-runtime`: **deterministic, authority-first runtime contracts** for the future WhatsApp coordinator — an actor/party/channel vocabulary, strict agent assignment (Riya=client-only, Anisha=vendor-only, Jarvis=coordination), a validated conversation-state machine with **human takeover / AI pause** gates, a content-minimized inbound envelope, and **proposal-only** decisions that always remain `PENDING_CORE_VALIDATION`. **No transport/provider/database/n8n coupling; no WhatsApp API, no dashboard UI, no persistence, no live model call, no real message data.** QuickFurno Core remains final authority; the runtime coordinates proposals and executes nothing. The `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-P04 delivered the model gateway, capability registry, governed knowledge, evaluation evidence, and no-op RAG provisioning — the model/knowledge/evaluation foundation. The next canonical phase is **QFJ-P05 — Jarvis Orchestration** (the coordinator, routing/coordination, human escalation), whose exit gate is "events route to a placeholder-free registry with **zero agents registered**" and whose exclusions are "**no execution; no message sent**." QFJ-M1 begins the MVP runtime by building the narrowest deterministic, authority-first foundation those slices need: who an inbound conversation is assigned to, what conversation state it is in, whether a human has taken over, and what **proposals** the runtime produces — with Core as the only authority that could ever act on them. No transport, provider, or database is touched.

## Decision

### A. Purpose

Create deterministic, authority-first runtime contracts for the future WhatsApp agents, with **no transport/provider/database coupling**. The runtime coordinates **proposals only**; QuickFurno Core remains the final authority that validates and executes.

### B. Actor / channel / party vocabulary

Closed actors: `RIYA`, `ANISHA`, `JARVIS`, `HUMAN`, `SYSTEM`. Closed party types: `CLIENT`, `VENDOR`, `UNKNOWN`. Closed channels (initial): `WHATSAPP`, `INTERNAL`. There is **no real WhatsApp API** in this slice.

### C. Strict assignment

`CLIENT → RIYA` only; `VENDOR → ANISHA` only; `UNKNOWN → JARVIS` classification/triage only (or `HUMAN` per policy); a `HUMAN` takeover overrides all AI assignment. **Riya can never perform a vendor operation; Anisha can never perform a client operation** — the router refuses any cross-scope assignment/proposal.

### D. Conversation runtime state

Closed states: `NEW`, `ACTIVE_AI`, `WAITING_EXTERNAL`, `FOLLOW_UP_DUE`, `ESCALATED`, `HUMAN_TAKEOVER`, `CLOSED`. State changes are validated and deterministic; an invalid transition **fails closed**. There is **no message persistence/database** here.

### E. Human takeover / AI pause

`HUMAN_TAKEOVER` blocks **every** AI reply proposal **before** any model invocation. AI pause is **fail-closed**. Return-to-AI requires an **explicit authorized runtime transition** — there is **no automatic release** from human takeover. The future dashboard control will use these contracts.

### F. Inbound envelope

An immutable, content-minimized envelope carries: runtime/conversation/message ids; tenant id; channel; party type; direction; a received-at canonical instant; an opaque provider message reference; a data class; and an **optional bounded normalized** text/reference for test-only runtime composition. It carries **no** provider SDK object, token, webhook secret, or arbitrary metadata.

### G. Authority-first decision

The runtime produces **proposals only**: agent-assignment, reply, follow-up, escalation, and tool-intent proposals. Every proposal carries an exact proposal id/version, an actor/party/conversation binding, and an authority status **`PENDING_CORE_VALIDATION`**, and has **no** `execute`/`send`/`authorize` method. QuickFurno Core validation and command execution are **outside** this package.

### H. Model / knowledge / evaluation boundary

The runtime accepts **injected provider-neutral interfaces only**; there is **no live model call** in this slice and **no provider selection** inside the runtime (the model gateway selects providers later). Governed knowledge is evidence only; model evaluation grants no business authority; RAG remains disabled/no-op.

### I. Privacy / data class

`HOSTED_ALLOWED`/`LOCAL_ONLY`/`HUMAN_ONLY` are preserved. `HUMAN_ONLY` yields **no** model request. Erased/tombstoned/in-progress subjects are blocked by an injected **privacy gate before any model/knowledge interface**; a missing privacy gate for a subject-linked conversation **fails closed**. No raw sensitive content enters observability.

### J. Deterministic router

A pure router decides assignment from party type, takeover state, AI-pause state, the allowed agent scopes, and the policy revision. **No model guesses assignment; no random/time-dependent routing.**

### K. Safe observability

Content-free events: `runtime-envelope-accepted`/`-refused`, `runtime-agent-assigned`, `runtime-ai-paused`, `runtime-human-takeover-entered`/`-exited`, `runtime-proposal-created`/`-refused`, `runtime-escalation-required`. An event **never** emits message text, a subject reference, PII, a key/token, a provider body, or chain-of-thought.

### L. Conversation Operations Center contract

The mandatory future dashboard projection fields are **documented** (not implemented): active conversations; assigned actor; party type; conversation state; last activity time; AI-paused/human-takeover; escalation/follow-up status; a delivery-state placeholder; and safe audit references. No dashboard or persistence is built here; QuickFurno Core owns the authoritative conversation record.

### M. Non-goals

No DB/schema/migration 0008; no WhatsApp/n8n/provider API; no live model; no real messages; no memory/RAG/tools/execution; no dashboard/deployment.

## Rejected alternatives

- **Let a model choose the agent.** Rejected — assignment is a pure, deterministic function of party type / takeover / pause / policy; a model guessing authority would blur Riya/Anisha scopes.
- **Have the runtime send or execute.** Rejected — every output is a proposal `PENDING_CORE_VALIDATION` with no `execute`/`send`/`authorize` method; Core is the only authority that acts, n8n is transport-only.
- **Auto-release human takeover after a timeout.** Rejected — return-to-AI requires an explicit authorized transition; AI pause is fail-closed.
- **Persist conversations / integrate WhatsApp now.** Rejected — no DB, no transport, no provider API in this slice; the runtime is deterministic contracts only, and Core owns the authoritative record.

## Consequences

**Positive.** The coordinator has a deterministic, authority-first spine — who is assigned, what state a conversation is in, whether a human has taken over, and what proposals exist — with Core as the only authority and no transport/provider/database dependency, so the future WhatsApp agents and the Conversation Operations Center have a safe, testable foundation to build on.

**Negative — accepted.** The runtime sends and executes nothing and persists nothing; it produces proposals a later, separately authorized Core-integration and transport layer must validate and act on. Real messages, WhatsApp, persistence, and live model calls are later phases.

## Change-control rule

Adding an actor/party/channel, a conversation state, a proposal kind, or a transition, or changing the assignment/takeover/privacy rules or the proposal authority status, requires a superseding ADR. The runtime never sends, executes, authorizes, or calls n8n; it never selects a provider or calls a model; Riya stays client-only and Anisha vendor-only. The Conversation Operations Center is a separate, later, mandatory phase.
