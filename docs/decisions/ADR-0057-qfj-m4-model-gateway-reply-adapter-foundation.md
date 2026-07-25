# ADR-0057 — QFJ-M4 Model-Gateway Reply Adapter Foundation

**Status:** Accepted (2026-07-25) — QFJ-M4 (a concrete `ModelReplyPort` composing the existing `@qf-jarvis/model-gateway`; no live provider call, no send)
**Deciders:** Owner
**Phase:** QFJ-M4 / MVP Runtime — Model-Gateway Reply Adapter Foundation (the Jarvis→model reply-drafting boundary of [QFJ-P05 Jarvis Orchestration](../architecture/qf-jarvis-roadmap-v3.md))

**Relates to:** [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) (M2 `ModelReplyPort`) · [ADR-0056](./ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) (M3 Core adapter) · [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (model gateway) · [ADR-0046](./ADR-0046-qfj-p04-01b-groq-cloud-adapter.md) · [ADR-0047](./ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md) · [ADR-0048](./ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md) · [ADR-0049](./ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md) · [ADR-0050](./ADR-0050-qfj-p04-02-model-capability-registry.md) · [ADR-0052](./ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md) · [ADR-0025](./ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md)

**Design documents introduced:** [docs/reports/qfj-m4-model-reply-adapter/](../reports/qfj-m4-model-reply-adapter/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds one new package `@qf-jarvis/model-reply-adapter`: a concrete implementation of the M2 `ModelReplyPort` that translates an authority-safe reply **plan** into an **exact model-gateway request**, obtains a result through a **narrow injected gateway invoker**, and **strictly validates** the returned structured result — its **provenance**, its **citations**, and the surrounding **conversation state** — into a bounded structured reply **draft**. It composes the **existing** `@qf-jarvis/model-gateway` for all routing, capability, rollout, failover, provider selection, and error normalization; it introduces **no second router**, **no hard-coded provider/model id**, and **no fallback**. **No live Groq/local call, no key/token/env, no provider activation, no rollout promotion; no live QuickFurno Core; no WhatsApp/n8n/send/transport; no persistence/DB/schema/migration 0008; no knowledge retrieval; no semantic/vector/embedding/RAG.** Model output is a **draft/proposal input only** — never a Core `ACCEPTED`, never sent, delivered, or executed. QuickFurno Core remains the only business authority. The `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-M2 (ADR-0055) defined an injected, provider-neutral `ModelReplyPort` and proved the orchestrator turns its candidate into a validated draft, a `PENDING_CORE_VALIDATION` proposal, and a Core decision — with the port left as an injected seam whose only concrete form was a deterministic fake. QFJ-P04.01A–E built the provider-neutral `@qf-jarvis/model-gateway` (routing, capability, rollout, failover, provider adapters) with a `FakeModelProvider` and **no** live key. The natural next MVP slice is the **concrete `ModelReplyPort`** that composes that gateway. This slice makes **no live provider call**: the M2 port is synchronous and this phase authorizes no credential/network, so the gateway is reached through a **narrow synchronous injected invoker facade** (a thin provider-neutral wrapper over the existing gateway) driven by **deterministic fakes only**. A live async gateway binding, keys, activation, and rollout are later, separately authorized slices.

## Decision

### A. Purpose

Implement the M2 `ModelReplyPort` using the existing provider-neutral model gateway: translate an authority-safe reply plan into an exact gateway request, validate the returned model result into a bounded structured reply draft, and preserve QuickFurno Core as the only business authority. Perform **no** delivery, Core decision, persistence, or transport.

### B. Package ownership

`packages/model-reply-adapter/` (`@qf-jarvis/model-reply-adapter`). Dependency direction is **one-way**: `model-reply-adapter → @qf-jarvis/agent-runtime` (stable `ModelReplyPort`/contracts) and `model-reply-adapter → @qf-jarvis/model-gateway` (stable public contracts). Never `agent-runtime → model-reply-adapter` or `model-gateway → model-reply-adapter`. It does **not** duplicate gateway routing, capability, rollout, failover, or provider logic. No global mutable singleton; no database/persistence.

### C. Existing model-gateway authority

The adapter **delegates to the existing gateway** for exact provider-release resolution, capability matching, data-class and execution-class eligibility, rollout mode, provider routing, local/hosted selection, failover, timeout/retry/circuit behaviour, and provider-error normalization. The adapter must **not** select Groq/local directly, hard-code a provider/model id, invent fallback, call a second provider itself, activate a release, promote a rollout mode, or fabricate evaluation approval.

### D. Exact request binding

Every gateway request binds exact: run id; conversation id and expected revision; assigned actor; party type; task class; data class; structured result mode/schema revision; provider release id; provider id; model id; model version; configuration digest; execution class; prompt family and prompt version/reference; capability profile reference; evaluation reference when policy requires it; policy revision; exact knowledge citation references/digests; a canonical requested-at instant; and the bounded normalized user input/context. **No wildcard or `latest`; no arbitrary metadata bag; no raw provider SDK object.** The gateway request itself is the gateway's own validated `ModelRequest`; the exact release/prompt/capability/evaluation/policy/citation identities are carried in its closed, scalar metadata.

### E. Content minimization

Include only the bounded normalized input necessary for the reply task; only the approved exact knowledge excerpts/references already supplied by the M2 plan (this adapter performs **no** knowledge retrieval); never subject references, phone numbers, provider credentials, internal notes, hidden system data, or unrelated conversation history. `HUMAN_ONLY` fails **before** gateway invocation; `LOCAL_ONLY` must not use a hosted route; `HOSTED_ALLOWED` external context stays minimal and redacted.

### F. Prompt contract

Use an exact versioned prompt template/contract. The prompt preserves: Riya client-only; Anisha vendor-only; Jarvis coordinator; QuickFurno Core final authority; reply/proposal only; no direct execution, n8n, or business mutation; exact citations when knowledge is used; and no chain-of-thought request or storage. No free-form provider-specific prompt construction spread through business logic.

### G. Structured output

The adapter accepts only a strict provider-neutral structured reply result. Closed draft kinds: `REPLY`, `ESCALATE_TO_HUMAN`, `REQUEST_CLARIFICATION`, `NO_ACTION`. The result may contain bounded reply text (for `REPLY`), bounded safe reason/intent codes, exact citation references, safe model provenance, and safe usage counters/trace reference. It must **not** contain chain-of-thought, a raw provider request/response, provider headers/body, a tool-execution result, a send/deliver/execute instruction, a Core `ACCEPTED` status, or arbitrary metadata. Malformed or extra-field output **fails closed**.

### H. Citation validation

Any returned citation must **exactly** match a citation in the input plan (same `knowledgeId` and `version`). A versionless, fabricated, stale, superseded, conflicting, or unauthorized citation is **rejected**. The adapter performs **no** fresh retrieval, and **no** citation is silently dropped to make output pass.

### I. Exact provenance validation

The gateway result must match the plan's exact provider/model/version and prompt family/version (the fields model-gateway provenance exposes), and the request must bind the plan's exact release/configuration, capability profile, evaluation reference where required, and data/execution class. Any observable mismatch **fails closed** before a `ModelReplyDraft` is returned.

### J. Cancellation / stale state

Use an injected **content-free** state/cancellation reader (revision; assignment; party; conversation state; AI paused; human takeover; cancelled; privacy/tombstone status). Check **immediately before** gateway invocation and **immediately after** the gateway result. Any change (or any blocking condition) prevents a reply draft from returning.

### K. Error normalization

Closed, safe adapter outcomes/reasons: `model-adapter-unavailable`, `model-plan-invalid`, `model-state-blocked`, `model-gateway-refused`, `model-gateway-transient`, `model-result-invalid`, `model-provenance-mismatch`, `model-citation-mismatch`, `model-structured-output-invalid`, `model-cancelled`, `model-invariant`. A raw provider/gateway error is **never** exposed. The adapter performs **no** automatic retry beyond whatever the gateway itself owns, and invokes the gateway **at most once** per draft.

### L. Observability

Content-free events: `model-adapter-plan-validated`, `model-gateway-requested`, `model-gateway-result-received`, `model-result-refused`, `model-adapter-completed`. Allowed: run/conversation ids; actor/party/data class/task; release/provider/model/prompt/capability/evaluation reference ids; result kind; safe reason; already-normalized token/latency counters; timestamps. Never: inbound/reply content; prompt text; knowledge content; subject ref; PII; key/token; raw provider error/body/header; chain-of-thought.

### M. Authority / no-send

Model output is a **draft/proposal input only**. The adapter cannot create a Core `ACCEPTED`; it has **no** `send`/`deliver`/`execute`/`callN8n`/`authorize` method, makes **no** Core decision, issues **no** delivery command, and performs **no** WhatsApp/provider transport. The Conversation Operations Center remains a mandatory later phase, not implemented here. Kimi is excluded.

### N. Non-goals

No live Groq/local call; no key/token/env provisioning; no provider activation or rollout promotion; no live Core call; no WhatsApp/n8n/send; no persistence/DB/schema/migration 0008; no knowledge retrieval; no semantic/vector/embedding/RAG; no dashboard; no deployment.

## Consequences

The M2 `ModelReplyPort` gains its first concrete, provider-neutral implementation that composes the existing gateway without re-implementing any routing/rollout logic, so the Jarvis reply-drafting boundary advances one step with **no** live provider, credential, or send risk: every path terminates in a validated draft or a fail-closed reason, and the draft is only ever an input to the M2 proposal/Core-decision flow. A live async gateway binding, real keys, provider activation, rollout promotion, delivery, and persistence remain deferred to separate, owner-authorized slices. **This is the drafting seam only; QuickFurno Core remains the sole business authority.**
