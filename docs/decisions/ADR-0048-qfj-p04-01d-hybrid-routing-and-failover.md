# ADR-0048 — QFJ-P04.01D Hybrid Routing and Failover

**Status:** Accepted (2026-07-24) — QFJ-P04.01D
**Deciders:** Owner
**Phase:** QFJ-P04.01 — Model Gateway (governed hybrid routing across the hosted and local providers)

**Relates to:** [ADR-0047](./ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md) (the local provider) · [ADR-0046](./ADR-0046-qfj-p04-01b-groq-cloud-adapter.md) (the Groq provider) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (the gateway foundation) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) (provider-independent inference) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · design docs [model-provider-independence.md](../architecture/model-provider-independence.md), [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)

**Design documents introduced:** [docs/reports/qfj-p04-01d/](../reports/qfj-p04-01d/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It converts ad-hoc provider order into one explicit, immutable, validated **hybrid-routing policy** with a bounded **failover matrix**, over the existing Groq (HOSTED) and local (LOCAL) providers, behind the unchanged `ModelProvider` contract. **No live Groq or local-model call, no real key/token, no external network in tests/CI** — validated through deterministic injected transports. No schema/migration (0008 absent); the `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-P04.01B/C delivered a hosted (Groq) and a local provider behind the provider-neutral contract; the foundation's selection is deterministic but keys only on array order and does not gate a fallback by _why_ the primary failed. QFJ-P04.01D adds an explicit, validated routing **profile** and a **failover matrix** so a composition routes by privacy, eligibility, capability, readiness/health, injected preference, and bounded reliability — and only fails over on genuinely transient failures. Routing is opt-in and additive: a gateway with no routing profile behaves exactly as before.

## Decision

### A. Purpose

Route by privacy/data class, provider eligibility, declared capability, readiness/health, injected preference, and bounded reliability policy — **only**. Never route on business outcome, conversion likelihood, client/vendor identity, protected attributes, or model self-recommendation. The `ModelProvider` contract is unchanged; routing selects **inference only** and authorizes/executes nothing.

### B. MVP routing profiles (closed)

- **HOSTED_FIRST** (current MVP profile while Groq is primary): `HOSTED_ALLOWED` → eligible hosted primary, eligible local fallback; `LOCAL_ONLY` → eligible local only; `HUMAN_ONLY` → no provider.
- **LOCAL_FIRST** (future workstation-primary): `HOSTED_ALLOWED` → eligible local primary, eligible hosted fallback; `LOCAL_ONLY` → eligible local only; `HUMAN_ONLY` → no provider.

No cost-first, latency-first, model-voting, random, percentage-split, learning, or autonomous dynamic profile is added. A profile selects **execution class first**; within a class, the deterministic configured provider order chooses the provider. Provider/model IDs remain injected config; no provider or model is architectural truth.

### C. Deterministic eligibility order (fail closed)

validate request → reject `HUMAN_ONLY` → kill switch / execution mode → privacy/data class → token/cost/concurrency/queue → provider readiness attestation → provider health → execution-class eligibility → declared capability match → apply routing profile → select exactly one primary → optionally select exactly one fallback → invoke under a single total attempt budget → accept at most one response.

### D. Failover matrix

Fallback is allowed **only** when: the data class permits the fallback execution class; policy explicitly permits fallback; an eligible fallback exists; the primary failure is explicitly retryable/transient; the total attempt budget remains; the request is not cancelled; and kill-switch/mode/budget/privacy checks still pass. The transient allowlist is bounded: `provider-unavailable`, transient network/connect/capacity/server failure, `timeout` (only when not cancelled and budget remains), and a circuit-open/unhealthy primary (pre-invocation selection of an eligible fallback).

Fallback is **NOT** allowed for: `HUMAN_ONLY`; `LOCAL_ONLY` → hosted; cancelled; gateway OFF or kill-switch active; `request-invalid`; privacy/data-class rejection; token/cost/concurrency/queue refusal; authentication/authorization/configuration failure; non-retryable provider failure; `malformed-provider-output`; `structured-output-invalid`; unsupported schema/capability mismatch; policy/invariant failure. **No hidden repair by another model.**

### E. Attempt budget

One total attempt ledger per gateway run: bounded primary retries plus **at most one** fallback provider. Total provider invocations never exceed `1 + request.retryBudget + (fallback allowed ? 1 : 0)`, and never exceed the policy's `maxTotalAttempts` (the stricter bound wins). Fallback does **not** reset the retry budget. **Exactly one accepted response**; no invocation after acceptance; no parallel or speculative calls; no voting; no duplicate charge from an already-accepted response.

### F. Readiness

Groq is eligible only when its ZDR/data-controls attestation and health pass; local only when its endpoint/model/auth-TLS attestations and health pass. A missing attestation makes a provider **ineligible** (its `health()` fails closed) — never silently treated as healthy. Provider health/readiness affects inference eligibility only and grants no business authority.

### G. Observability / decision proof

Every routing decision can emit bounded, content-free evidence: routing profile, request data class, eligible execution classes, primary provider id/execution class, fallback provider id/execution class (if any), exclusion reason codes, fallback reason code, attempt counts, final provider — and **never** a prompt, message, subject reference, secret, or raw error body. A **frozen** routing-decision summary may be returned internally for testing/observability; mutable provider instances are never exposed.

### H. Mode boundary

`OFF` remains fail-closed; `ACTIVE` executes. **No** `SHADOW`/`CANARY` traffic duplication and **no** parallel provider calls are implemented here — those and provider rollout governance are QFJ-P04.01E. Existing mode behaviour must not silently widen; routing is **opt-in** (a gateway with no routing profile is byte-for-byte unchanged).

### I. Authority

Routing selects inference only; the gateway and providers authorize and execute nothing. Riya is client-only, Anisha vendor-only, Jarvis the coordinator, QuickFurno Core the final authority, n8n execution-only. Kimi is excluded.

### J. Scope / non-goals

No real provider activation; no live calls; no keys/tokens; no provider account changes; no adaptive scoring, cost optimizer, latency optimizer, A/B or percentage traffic; no shadow/canary duplication; no persistence/database; no migration/0008; no agents/memory/RAG/tools/n8n; no deployment.

## Rejected alternatives

- **Fall back on any primary failure (the foundation's array-order behaviour).** Rejected — failover must be gated by an explicit transient allowlist; auth/config/malformed/structured-invalid/non-retryable failures must not trigger a wasted second provider.
- **A dynamic cost/latency/learning router.** Rejected for this slice — deterministic, evaluation-approved profiles only; no adaptive scoring or model voting.
- **Parallel/speculative provider calls or shadow duplication.** Rejected — at most one accepted response; shadow/canary is P04.01E.
- **A global mutable provider registry.** Rejected — an injected immutable roster with validated unique ids and declared execution classes.
- **Make routing the default and rewrite the gateway flow.** Rejected — routing is opt-in via a validated policy; the default path is unchanged, preserving every existing test.

## Consequences

**Positive.** A composition can switch between HOSTED_FIRST and LOCAL_FIRST by configuration + evaluation, with a bounded, auditable failover that never crosses the privacy boundary and never wastes a second provider on a terminal failure. Groq and local coexist unchanged.

**Negative — accepted.** The routing policy is evaluated only against deterministic injected transports in this slice; production activation and the choice of live profile are gated on separate provider activation and QFJ-P04.04 evaluation approval. Shadow/canary and rollout governance are deferred to QFJ-P04.01E.

## Change-control rule

Adding or changing a routing profile, the failover allowlist, the attempt-budget bound, or the observability surface requires a superseding ADR. Activating a live profile requires provider activation (ADR-0046/0047 attestations) and QFJ-P04.04 evaluation approval. Shadow/canary traffic and provider rollout governance are QFJ-P04.01E.
