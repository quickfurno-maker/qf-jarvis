# ADR-0046 — QFJ-P04.01B Groq Cloud Adapter

**Status:** Accepted (2026-07-24) — QFJ-P04.01B
**Deciders:** Owner
**Phase:** QFJ-P04.01 — Model Gateway (the first real hosted provider, QFJ-P04.01B)

**Relates to:** [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (the provider-neutral gateway foundation) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) (provider-independent inference) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) (no auto-training) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) (payload privacy) · design docs [model-provider-independence.md](../architecture/model-provider-independence.md), [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)

**Design documents introduced:** [docs/reports/qfj-p04-01b/](../reports/qfj-p04-01b/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds the FIRST real hosted provider — a **Groq** adapter behind the existing `ModelProvider` contract in `@qf-jarvis/model-gateway`. **No real API key, no live Groq call, no external network in tests/CI** — the adapter is validated through an injected deterministic transport. No schema/migration (0008 absent); the `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-P04.01A delivered the provider-neutral gateway and a deterministic `FakeModelProvider`. The owner fixed **Groq** as the first real hosted provider. This slice adds a Groq adapter that implements the same `ModelProvider` interface — the gateway, agents, memory, and n8n are unchanged. The adapter is inference only; it authorizes and executes nothing.

## Decision

### A. Purpose

Add Groq as the first real **HOSTED** provider behind the existing `ModelProvider` contract. Groq is an inference engine only: no agent, tool, n8n, database, or business-authority coupling; its output is advisory and locally validated.

### B. Endpoint / protocol

Groq's OpenAI-compatible Chat Completions endpoint (`POST https://api.groq.com/openai/v1/chat/completions`), **non-streaming only**, **one choice (`n=1`)**, using **`max_completion_tokens`** (not the deprecated `max_tokens`). No unsupported/unneeded fields (`logprobs`, `logit_bias`, `top_logprobs`, `messages[].name`). No Responses API, no stateful provider conversation — the caller/gateway owns history.

### C. Structured output

STRUCTURED requests map to `response_format.type = "json_schema"`. **Strict** mode is enabled only when the configured model capability declares strict JSON-schema support, and a strict schema must meet Groq's restrictions (all object properties required, `additionalProperties:false`, nullable unions for optionals). The provider's JSON is parsed locally and returned to the gateway for zod validation; **no hidden model-based JSON repair**. Structured output uses no provider tools and no streaming.

### D. Tools / reasoning

Send **no** `tools`, functions, `tool_choice`, MCP, built-in web search, code execution, or remote tools. Do not ask Groq to authorize or execute actions. Do **not** request or expose chain-of-thought/reasoning output — only the validated visible answer crosses the adapter boundary.

### E. Model configuration

No model ID is architectural truth. Model ID/version/capabilities are **injected configuration**, evaluation-approved (QFJ-P04.04). The adapter does not call `/models` at runtime and does not silently switch models. Candidate models may be documented for later evaluation; the adapter contains **no hard-coded production default**.

### F. Privacy

Execution class = **HOSTED**; the gateway rejects `LOCAL_ONLY`/`HUMAN_ONLY` before the adapter is ever invoked. Only already-sanitized/minimized content is sent; never a subject reference, secret, internal DB object, or protected Core data outside the request's allowed content. **Production activation requires a recorded Groq data-controls attestation (Zero Data Retention enabled for the production project).** The repository does not verify Groq settings remotely in this slice, and makes **no legal-compliance claim**.

### G. Secret boundary

The API key is **constructor/composition injection only** through a non-printable, non-serializable holder. **No `process.env` in the adapter**, no secret loader in `model-gateway`, no key in config/tests/snapshots/logs/errors/observability/provenance/reports, and no Authorization header in diagnostics. Tests use a sentinel key through injected transport and prove it never leaks.

### H. Reliability / errors

The **gateway** owns retries, fallback, circuit breaker, timeout, budgets, queue, and concurrency. The adapter performs **exactly one** HTTP invocation per `invoke`, respects the `AbortSignal`, and **never retries internally or sleeps**. It normalizes HTTP/network failures into the existing safe provider-result contracts, with bounded retryability: 429 and transient 5xx/capacity → retryable (`provider-unavailable`); auth/forbidden/invalid/oversized/unknown → non-retryable (`provider-failed`); cancellation → `cancelled`; malformed body → `malformed-provider-output`. `Retry-After` is parsed and bounded; raw bodies/headers are never surfaced.

### I. Hybrid future

A local OpenAI-compatible workstation adapter (QFJ-P04.01C) later implements the **same** `ModelProvider` contract. Groq-specific request/response types stay internal — no Groq type in the gateway public contracts. Adding local later is configuration + evaluation, not a rewrite.

### J. Scope / non-goals

No schema/migration/0008; no live external test; no production activation; no agent/n8n/memory/tool use; no app wiring beyond a compile-only factory if strictly required; no Groq Compound/built-in tools; no audio/vision/batch/fine-tuning; no MCP/web/code execution; no chain-of-thought output.

## Rejected alternatives

- **Responses API / streaming / built-in tools.** Rejected — non-streaming Chat Completions is sufficient and minimal; tools/reasoning would breach the authority and privacy boundaries.
- **Read the key from `process.env` in the adapter.** Rejected — the key is injected at composition; the package reads no environment.
- **Retry inside the adapter.** Rejected — the gateway owns retry/circuit/backoff; the adapter does exactly one call.
- **Hard-code a Groq model default.** Rejected — model identity is injected, evaluation-approved.
- **Verify Groq data-controls remotely.** Rejected — production readiness requires a recorded local attestation; no console scraping, no legal claim.

## Consequences

**Positive.** The first real provider exists behind the unchanged contract; provider addition proved to be configuration; privacy/secret/error boundaries are enforced and tested with no live key or network.

**Negative — accepted.** The adapter is not exercised against live Groq in this slice (deterministic injected transport only); production activation is gated on a separate data-controls attestation and evaluation approval.

## Change-control rule

Changing the endpoint/protocol, the secret boundary, the structured-output/tools policy, or the error normalization requires a superseding ADR. Activating Groq in production requires the data-controls attestation and QFJ-P04.04 evaluation approval. The local adapter (QFJ-P04.01C) and hybrid routing (QFJ-P04.01D) are separate slices.
