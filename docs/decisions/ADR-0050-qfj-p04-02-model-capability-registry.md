# ADR-0050 — QFJ-P04.02 Model Capability Registry

**Status:** Accepted (2026-07-25) — QFJ-P04.02
**Deciders:** Owner
**Phase:** QFJ-P04.02 — Capability Registry (Stage 4.1, capabilities)

**Relates to:** [ADR-0049](./ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md) (rollout governance / release refs) · [ADR-0048](./ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md) (hybrid routing) · [ADR-0047](./ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md) · [ADR-0046](./ADR-0046-qfj-p04-01b-groq-cloud-adapter.md) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (capability descriptors) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · design docs [model-provider-independence.md](../architecture/model-provider-independence.md), [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)

**Design documents introduced:** [docs/reports/qfj-p04-02/](../reports/qfj-p04-02/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds one immutable, version-bound **Model Capability Registry** inside `@qf-jarvis/model-gateway`: a canonical technical record of configured provider/model **release** capabilities that routing and rollout consume, replacing scattered/unverified capability assumptions. **No live Groq or local-model call, no real key/token, no external network, no model discovery.** Registry eligibility is technical inference eligibility only — it grants no business authority and activates no provider. Rollout is opt-in; a gateway with no registry behaves exactly as QFJ-P04.01E. No schema/migration (0008 absent); the `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-P04.01A gave the gateway a neutral `ProviderCapabilities` descriptor and a `capabilitiesSatisfy` matcher; QFJ-P04.01E introduced the immutable `ProviderReleaseRef` (exact release/provider/model/version/config-digest identity). QFJ-P04.02 binds declared technical capabilities to those exact release identities in one canonical registry so routing and rollout resolve a provider/release to an evaluation-approvable, version-bound profile rather than trusting an unverified raw adapter claim. This is the capabilities slice (roadmap QFJ-P04.02). It performs **no** model evaluation — QFJ-P04.04 supplies evaluation evidence and approval later.

## Decision

### A. Purpose

One immutable canonical technical registry of configured provider/model **release** capabilities used by the gateway. It replaces hard-coded/scattered capability assumptions with exact version-bound data. Registry eligibility is **technical inference eligibility only**; it grants no business authority and does not activate a provider. QuickFurno Core remains the final business authority.

### B. Ownership

The registry lives inside `@qf-jarvis/model-gateway`. Provider adapters expose neutral descriptors/capabilities; the registry binds those claims to exact `ProviderReleaseRef` identities (QFJ-P04.01E). Routing consumes the registry; rollout operations consume exact release identities. QFJ-P04.04 later supplies evidence/approval; **P04.02 performs no model evaluation**. There is **no global mutable singleton** and **no database/persistence** in this slice.

### C. Exact release key

Every registry profile is bound to: `releaseId`, `providerId`, `modelId`, `modelVersion`, `configDigest`, and execution class (`HOSTED`/`LOCAL`). **No wildcard** provider/model/version; **no `latest` alias** as authoritative identity; **no automatic provider model discovery**; **no `/models` runtime call**; **no model self-description as trusted truth**.

### D. Capability profile

The minimum launch-critical profile carries: supported **task classes**; supported **result modes** (TEXT/STRUCTURED); the **structured-output mode** (`strict-json-schema` / `json-object` / `unsupported`); maximum input/context and completion budgets; non-streaming support (a streaming declaration exists for future use, but current serving is non-streaming); timeout and cancellation support; execution class; provider/model identity; an optional cost-accounting **profile reference/version** (not mutable live pricing); and an optional prompt-compatibility **family/version reference**. It carries **no** business rule, agent prompt text, secret, provider SDK object, or arbitrary metadata bag. A profile must not claim capabilities that tests/evidence do not support.

### E. Task classes

The closed launch-oriented set: `INTENT_CLASSIFICATION`, `STRUCTURED_EXTRACTION`, `RESPONSE_GENERATION`, `CONVERSATION_SUMMARY`, `TOOL_INTENT_PROPOSAL`, `RESPONSE_EVALUATION`. **No tool execution.** No embedding/RAG task class. Agent scope and task class remain **separate**: Riya=CLIENT, Anisha=VENDOR, Jarvis=COORDINATION; capability matching never blurs these authority boundaries.

### F. Declared vs approved

P04.02 records **configured/declared** technical capabilities. A profile may carry an **opaque** evaluation-approval reference for future filtering, but it **must not fabricate approval**. QFJ-P04.04 remains the authority for evaluation evidence; ACTIVE rollout still requires the QFJ-P04.01E approval binding. **Registry presence alone never permits ACTIVE.**

### G. Registry invariants

Immutable after construction; deterministic ordering; a duplicate `releaseId` is rejected; a duplicate exact provider/model/version/config tuple is rejected; conflicting profiles are rejected; unknown task/result/structured modes are rejected; impossible limits are rejected; an exact descriptor/profile mismatch **fails closed**; no silent widening; resolution returns **frozen safe summaries**; provider instances and secrets are never exposed.

### H. Matching

A request capability requirement resolves only when: the exact release exists; the provider descriptor matches the release/profile identity; the execution class matches; the task class is supported; the result mode is supported; the structured mode/schema-strictness requirement is supported; the input/context/completion budgets fit; the timeout/cancellation requirements fit; the current non-streaming requirement fits; and optional prompt/cost profile references match when required. Matching **must not** decide health/readiness, circuit state, rollout mode, canary cohort, failover, business permissions, agent assignment, or n8n execution — those remain in their existing layers.

### I. Integration

Opt-in. With **no** registry configured, current QFJ-P04.01E behaviour is preserved exactly. With a registry configured: each provider/release used by routing or rollout must resolve to an exact matching profile; a missing/mismatched profile **fails closed before invocation**; routing uses registry-matched capabilities rather than trusting an unverified raw adapter claim alone; rollout stable/candidate `ProviderReleaseRef`s must resolve exactly. The Groq/local adapters remain unchanged. **No provider-specific type** appears in the registry API. One internal match function is the single technical authority.

### J. Observability

Safe closed reasons only: `registry-release-missing`, `registry-release-duplicate`, `registry-descriptor-mismatch`, `registry-task-unsupported`, `registry-result-mode-unsupported`, `registry-structured-mode-unsupported`, `registry-context-limit`, `registry-timeout-unsupported`, `registry-cancellation-unsupported`, `registry-prompt-profile-mismatch`, `registry-invariant`. Events/summaries carry only release/provider/model ids and versions, task/result/structured modes, numeric limits, and safe reason codes — **never** a prompt, message, subject reference, key, token, raw body, or operator PII.

### K. Authority / future agents

The capability registry selects no business outcome; models/providers/gateway authorize and execute nothing. Riya client-only, Anisha vendor-only, Jarvis coordinates, Core final authority, n8n execution-only. The **Jarvis Conversation Operations Center** remains a mandatory later phase but is **absent here** (no conversation store, no WhatsApp, no dashboard). Kimi is excluded.

### L. Non-goals

No live provider activation; no provider key/token; no external network; no model discovery; no model benchmarking/evaluation execution; no prompt library; no training/fine-tuning; no memory/RAG/knowledge; no agents; no WhatsApp/dashboard; no tools/n8n; no database/persistence; no schema/migration/0008; no deployment.

## Rejected alternatives

- **Trust the raw adapter capability claim at routing time.** Rejected — the registry binds a declared claim to an exact evaluation-approvable release identity and fails closed on mismatch.
- **Wildcard / `latest` model identity.** Rejected — every profile is bound to an exact release/provider/model/version/config-digest; no runtime `/models` discovery.
- **Let the registry gate health/readiness/rollout/failover.** Rejected — those remain in their existing layers; the registry decides technical capability match only.
- **Make the registry the default.** Rejected — it is opt-in; a gateway with no registry is byte-for-byte unchanged, preserving every existing test.
- **Record approval in the registry.** Rejected — declared capability is not evaluation approval; QFJ-P04.04 owns evidence and ACTIVE still requires the QFJ-P04.01E binding.

## Consequences

**Positive.** Routing and rollout can resolve a provider/release to an exact, version-bound, evaluation-approvable capability profile and fail closed on any mismatch, without trusting an unverified adapter claim and without touching health/rollout/failover.

**Negative — accepted.** The registry is populated from configured/declared data validated only against deterministic tests here; real evaluation evidence and approval come from QFJ-P04.04, and no provider is activated. The gateway integration is opt-in and minimal by design.

## Change-control rule

Adding a task class, a structured mode, a profile field, or a match rule, or changing the reason vocabulary or the integration surface, requires a superseding ADR. A registry profile never substitutes for QFJ-P04.04 evaluation approval or QFJ-P04.01E ACTIVE gating. The Conversation Operations Center is a separate, later, mandatory phase.
