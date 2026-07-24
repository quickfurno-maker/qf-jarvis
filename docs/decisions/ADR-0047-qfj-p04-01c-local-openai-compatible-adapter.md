# ADR-0047 — QFJ-P04.01C Local OpenAI-Compatible Adapter

**Status:** Accepted (2026-07-24) — QFJ-P04.01C
**Deciders:** Owner
**Phase:** QFJ-P04.01 — Model Gateway (the second provider class: a private local workstation, QFJ-P04.01C)

**Relates to:** [ADR-0046](./ADR-0046-qfj-p04-01b-groq-cloud-adapter.md) (the first hosted provider — Groq) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (the provider-neutral gateway foundation) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) (provider-independent inference) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) (payload privacy) · design docs [model-provider-independence.md](../architecture/model-provider-independence.md), [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)

**Design documents introduced:** [docs/reports/qfj-p04-01c/](../reports/qfj-p04-01c/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds the SECOND provider class — a **local OpenAI-compatible** workstation adapter behind the existing `ModelProvider` contract in `@qf-jarvis/model-gateway`. **No live local model call, no model-server install, no model weights, no real token, no external/LAN network in tests/CI** — the adapter is validated through an injected deterministic transport, and its endpoint policy admits private IP literals only. No schema/migration (0008 absent); the `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-P04.01B added Groq, the first real HOSTED provider, behind the provider-neutral `ModelProvider` contract. The owner fixed a **local OpenAI-compatible workstation/private-GPU node** as the second provider class — the privacy-preserving, private-compute complement to Groq. It must implement the **same** contract so the gateway, agents, Core tools, n8n, memory, and business rules stay unchanged: adding it is configuration and evaluation, not a rewrite. The adapter is inference only; it authorizes and executes nothing. Because a local server lives on a private network reachable by IP, the dominant new risk is **SSRF** — an arbitrary destination masquerading as "local". This ADR therefore locks a strict private-IP endpoint policy.

## Decision

### A. Purpose

Add a **LOCAL** execution-class provider behind the existing `ModelProvider` contract, targeting an OpenAI-compatible **non-streaming** Chat Completions server on a future local workstation / private GPU node. The adapter is an inference engine only: no agent, tool, n8n, database, or business-authority coupling; its output is advisory and locally validated.

### B. Hybrid architecture

Groq remains the first hosted provider; the local provider is the privacy-preserving/private-compute provider. `LOCAL_ONLY` routes **only** to LOCAL providers; `HOSTED_ALLOWED` may route to Groq or local according to **injected policy** (provider array order); `HUMAN_ONLY` reaches no provider. The **gateway** selects providers — never n8n and never an agent. Hybrid failover policy stays gateway-owned and separately governed (QFJ-P04.01D). QuickFurno Core remains the final authority.

### C. Protocol

OpenAI-compatible `POST <validated-private-base>/v1/chat/completions`, **non-streaming only**, **one choice (`n=1`)**. The caller/gateway owns conversation history; the adapter holds **no provider state**. **No `/models` discovery at runtime.** No tools/functions/`tool_choice`/MCP/web search/code execution. **No reasoning / chain-of-thought output.** No Responses API. No provider-specific SDK. The final Chat Completions URL is constructed **internally** from a validated endpoint descriptor on the fixed path `/v1/chat/completions`; the response size is bounded before parsing.

### D. Private-endpoint security (SSRF)

No arbitrary public endpoint. The production endpoint must be an explicit **private/local** network destination. The default endpoint validator permits **only**:

- IPv4 loopback (`127.0.0.0/8`);
- IPv4 RFC1918 private ranges (`10/8`, `172.16/12`, `192.168/16`);
- IPv4 carrier-grade / shared-NAT range `100.64.0.0/10` (private overlay / VPN, e.g. Tailscale);
- IPv6 loopback (`::1`);
- IPv6 unique-local addresses (`fc00::/7`);
- IPv6 link-local (`fe80::/10`) **only** when explicitly enabled for a bounded local use.

It **rejects** public/non-private addresses, hostnames (by default), embedded username/password, query strings, fragments, non-`http(s)` schemes, wildcard hosts, arbitrary paths, redirects, unsupported ports, malformed IPv4/IPv6, **IPv4-mapped public IPv6**, and unspecified/multicast/broadcast addresses. **Prefer HTTPS** for non-loopback production endpoints; plain HTTP is allowed only for loopback development or an explicitly attested private-network composition. **Hostnames/private DNS are deferred** (they require a separately injected exact allowlist and DNS-rebinding defense); this slice prefers **IP literals**. Tests inject a transport function — never an endpoint bypass — so the production validator is always exercised.

### E. Auth

An **optional** local-server bearer token via an **injected, redacting** secret holder. **No `process.env` in the adapter**, no secret loader in `model-gateway`, and no token in logs/errors/events/provenance/tests/reports. Loopback test/dev may use **no token**. Production activation must attest the private endpoint and the auth/TLS posture. Tests use a sentinel token through injected transport and prove it never leaks.

### F. Model configuration

**No hard-coded model default.** Model ID/version/capabilities are injected configuration, evaluation-approved (QFJ-P04.04). Structured-output capability is declared per configured server/model. **No automatic model switching and no discovery.**

### G. Structured output

Support the configured modes: **strict `json_schema`** only when the local server/model capability declares it; **best-effort `json_object`** when declared; otherwise a STRUCTURED request **fails before transport**. The gateway's local zod validation remains authoritative; **no hidden JSON repair**.

### H. Reliability / errors

The **gateway** owns retry, fallback, circuit breaker, timeout, budgets, queue, and concurrency. The adapter performs **exactly one** transport call per `invoke`, respects the `AbortSignal`, and **never retries internally or sleeps**. It normalizes local network/HTTP/malformed responses into the existing safe provider-result contracts, classifying retryability conservatively: transient connect/refused/unreachable/TLS/capacity/5xx → retryable (`unavailable`); auth/config/request/schema/oversized → non-retryable (`failed`); cancellation → `cancelled`; malformed/non-JSON/oversized body → `malformed`. Raw bodies/headers are never surfaced.

### I. Activation

This slice makes **no live local-model call**. Production readiness/health **fails closed** unless the composition supplies a **private-endpoint attestation**, a **model/capability attestation**, and an **auth/TLS-posture attestation** appropriate to the endpoint. No remote attestation service and no database; no deployment.

### J. Scope / non-goals

No model-server installation (Ollama/llama.cpp/vLLM/LocalAI/etc.); no model download; no GPU orchestration/load-balancing/multi-node scheduler; no voice/audio/vision; no agents; no memory/RAG; no tools/n8n; no schema/migration/0008; no managed access; no production activation; no live external or LAN network in tests/CI.

## Rejected alternatives

- **Allow an arbitrary base URL / hostname.** Rejected — an SSRF vector. The validator admits private IP literals only; hostnames/private DNS are a separately governed future slice with a rebinding defense.
- **Follow redirects.** Rejected — a redirect can leave the private-network envelope; `redirect: 'error'`.
- **Read a token from `process.env` in the adapter.** Rejected — the token is injected at composition; the package reads no environment.
- **Retry inside the adapter.** Rejected — the gateway owns retry/circuit/backoff; the adapter does exactly one call.
- **Hard-code a local model default or call `/models`.** Rejected — model identity is injected, evaluation-approved; no runtime discovery.
- **Responses API / streaming / built-in tools / reasoning output.** Rejected — non-streaming Chat Completions is sufficient and minimal; tools/reasoning would breach the authority and privacy boundaries.

## Consequences

**Positive.** A second provider class coexists with Groq behind the unchanged contract; a `LOCAL_ONLY` request has a real local destination that never falls back to a hosted provider; the SSRF/secret/error boundaries are enforced and tested with no live model, no real token, and no network.

**Negative — accepted.** The adapter is not exercised against a live workstation in this slice (deterministic injected transport only); production activation is gated on separate endpoint/model/auth attestations and evaluation approval. Hostname/private-DNS endpoints are deferred.

## Change-control rule

Changing the endpoint policy (including enabling hostnames/private DNS), the secret boundary, the structured-output/tools policy, or the error normalization requires a superseding ADR. Activating the local provider in production requires the endpoint/model/auth attestations and QFJ-P04.04 evaluation approval. Hybrid routing/failover (QFJ-P04.01D) and provider operations/governance (QFJ-P04.01E) are separate slices.
