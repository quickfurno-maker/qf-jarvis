# ADR-0045 — QFJ-P04.01A Model Gateway Foundation

**Status:** Accepted (2026-07-24) — QFJ-P04.01A
**Deciders:** Owner
**Phase:** QFJ-P04.01 — Model Gateway (canonical Roadmap v3.0; the provider-neutral foundation, QFJ-P04.01A)

**Relates to:** [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) (AI runtime foundations & sequencing) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) (provider-independent cloud/local/hybrid inference) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) (recommend/authorize/execute) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) (memory/learning boundaries) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) (payload privacy boundary) · [ADR-0039](./ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md) (migration-allocation rule) · design docs [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md), [model-provider-independence.md](../architecture/model-provider-independence.md)

**Design documents introduced:** [docs/reports/qfj-p04-01a/](../reports/qfj-p04-01a/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It creates ONE new package `@qf-jarvis/model-gateway` containing the provider-neutral contracts, a deterministic `FakeModelProvider`, and the governed gateway skeleton — **no real provider adapter, no key, no network, no agent, no schema/migration**. The `@qf-jarvis/event-backbone` package-root API remains **exactly 39 symbols**; migration 0008 remains absent and unreserved.

---

## Context

QFJ-P03 is repository-complete. The next phase, QFJ-P04 (Model Gateway, Knowledge and Evaluation Foundation), begins with the **single governed model gateway** through which every model call must pass — the narrow waist where privacy, cost, provenance, validation, routing, and reliability live, built **before** any agent reasons with a model ([model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)). ADR-0028 sequenced it; ADR-0041 made it provider-neutral and hybrid-ready. This ADR is its **implementing** decision for the foundation slice QFJ-P04.01A.

## Decision

### A. Purpose

Every model call passes through one governed **Model Gateway**. The gateway is the privacy, cost, validation, provenance, routing, and reliability boundary. **It authorizes no business action and executes no business action** (ADR-0002 applied to model invocation); a model's output is **advisory/proposed only** and its confidence is not business authority. A fully hijacked model can, at most, produce a misleading recommendation a human reviews — it can never authorize, execute, message, move money, or write business state.

### B. Hybrid strategy (locked)

The gateway is **provider-neutral from day one**. **Groq is the planned first real hosted provider** (added in QFJ-P04.01B). A **local OpenAI-compatible workstation provider follows later** (QFJ-P04.01C). Adding a provider must not require rewriting agents, Core tools, n8n workflows, memory, or business rules — only configuration, adapter activation, a model identifier, and evaluation approval (QFJ-P04.04). Runtime modes support hosted, local, and hybrid operation. **A `LOCAL_ONLY` request can never silently fall back to a hosted provider.** **No real provider adapter is implemented in P04.01A** — only the deterministic `FakeModelProvider`.

### C. Authority (locked)

Riya = client-side only; Anisha = vendor-side only; Jarvis = central coordinator; **QuickFurno Core = final business authority**; n8n = execution/integration only (decides no business rule). Models, the gateway, and providers **cannot call n8n or mutate Core state directly** — a model proposes a typed intent/tool request; Core authorizes or rejects; n8n executes only authorized intents; protected/high-risk actions require human approval. **Kimi / Kimi K3 is excluded** unless the owner explicitly reintroduces it.

### D. Scope (QFJ-P04.01A)

A new package `@qf-jarvis/model-gateway` containing: provider-neutral contracts (data class, agent scope, provider execution class, capabilities, request, response, provenance, mode, the `ModelProvider` interface); a deterministic `FakeModelProvider`; the governed gateway skeleton with **runtime modes default OFF**; data-class + capability routing; a timeout/cancellation boundary; a bounded retry budget; a deterministic circuit breaker; an emergency kill switch; token/cost budgets; bounded concurrency and queue caps; a structured-output validation boundary; prompt/model/provider provenance; closed safe error codes; observability hooks; **non-streaming first**; and evaluation hooks designed in. All reliability/time is via an **injected clock** — no wall-clock sleeps, no background daemon.

### E. Non-goals

No Groq adapter; no local adapter; no network; no API key; no provider SDK; no agent runtime; no Riya/Anisha conversation logic; no memory/RAG/knowledge; no tools/n8n; no database/schema/migration; no deployment; no model training/fine-tuning; **no chain-of-thought storage**; no full evaluation platform.

### F. Schema / API

**NO_MIGRATION_REQUIRED**; migration 0008 remains absent and unreserved (provenance is not persisted in this slice; any future persistence follows the ADR-0039 allocation rule). The `@qf-jarvis/event-backbone` package-root API remains **exactly 39 symbols** (untouched). The new package exposes only the minimum stable gateway contracts required by future consumers; **provider SDK types never cross the package boundary**; internal routers, mutable circuit state, and registries are not exported; the `FakeModelProvider` is a **test-scope** export (an internal subpath), not a production-root default.

### G. First real provider

Deferred to **QFJ-P04.01B**, and the owner decision is fixed: **Groq first**. P04.01B must still pass privacy, structured-output, budget, fallback, and evaluation gates before any agent use. A **local workstation adapter** follows as a separate provider (QFJ-P04.01C) without an architecture rewrite.

## Rejected alternatives

- **Each agent holds its own model client.** Rejected — capability you distribute is capability you cannot govern; there is exactly one gateway.
- **Widen the event-backbone package.** Rejected — the gateway is a separate package that agents/transport/memory depend on only through its contract.
- **Implement Groq (or any real provider) now.** Rejected — the foundation must be provider-neutral and testable with a fake before any SDK/key/network exists.
- **Persist provenance to a database now.** Rejected — NO_MIGRATION_REQUIRED; provenance is returned in-memory; persistence is a later, separately-authorized decision.
- **Streaming first.** Rejected — WhatsApp turns are message-atomic; streaming is a capability field for later.

## Consequences

**Positive.** The governed narrow waist exists before any agent; provider addition (Groq, then local) becomes configuration + evaluation, not a rewrite; privacy (data class), cost (budgets), reliability (timeout/retry/circuit/kill-switch), and provenance are enforced centrally; the fake provider makes the whole contract deterministically testable with no network/key.

**Negative — accepted.** Only `FakeModelProvider` runs in this slice (no real inference yet); SHADOW/CANARY/FALLBACK modes are represented but fail closed as not-yet-enabled (only OFF and ACTIVE execute); provenance is not persisted.

## Change-control rule

Changing the provider-neutral contract shape, the authority boundary, the hybrid/data-class rules, or the migration verdict requires a superseding ADR. Adding a real provider adapter (Groq, local) is a separate slice under this architecture. Operational status may advance without replacing this design.
