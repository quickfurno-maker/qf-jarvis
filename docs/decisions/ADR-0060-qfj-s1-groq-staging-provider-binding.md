# ADR-0060 — QFJ-S1 Groq Staging Provider Binding

**Status:** Accepted (2026-07-25) — QFJ-S1 (the first post-M5 launch-integration slice; a staging binding over the existing Groq Chat Completions adapter — **no real credential, no live call**)
**Deciders:** Owner
**Phase:** QFJ-S1 / Launch Integration — Groq Staging Provider Binding (the first hosted-provider binding toward a controlled pilot of [QFJ-P05 Jarvis Orchestration](../architecture/qf-jarvis-roadmap-v3.md))

**Relates to:** [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (model gateway) · [ADR-0046](./ADR-0046-qfj-p04-01b-groq-cloud-adapter.md) (**the existing Groq Chat Completions adapter this slice binds**) · [ADR-0048](./ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md) · [ADR-0049](./ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md) (release refs + rollout) · [ADR-0050](./ADR-0050-qfj-p04-02-model-capability-registry.md) (capability registry) · [ADR-0052](./ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) (M4) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) (M5)

**Design documents introduced:** [docs/reports/qfj-s1-groq-staging-provider-binding/](../reports/qfj-s1-groq-staging-provider-binding/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs, and it EXTENDS rather than duplicates.** The Groq **OpenAI-compatible Chat Completions adapter already exists** (ADR-0046, QFJ-P04.01B): `GroqModelProvider` (one HTTP call, `AbortSignal`, no retry, non-streaming, one choice), the fixed-origin SSRF-guarded transport (`createFetchGroqTransport` → `https://api.groq.com/openai/v1/chat/completions`, `redirect: 'error'`, bounded body), the redacting `GroqApiKey`, the strict `response_format` JSON-Schema translation (`groq-structured-output`), the HTTP/error normalization (`groq-error-normalization`, incl. `retry-after`), and the ZDR-gated `health()`. **S1 adds only the missing STAGING BINDING** over that adapter: an **injected async credential resolver** (opaque reference → redacting key, materialized only at bind time), a **release-driven staging factory** that constructs the existing `GroqModelProvider` from a **model-gateway-approved `ProviderReleaseRef`** (no hard-coded model id, no wildcard/`latest`), fail-closed data-class/execution/attestation/credential gates **before** any transport, and **content-free bind observability**. **No real Groq key is read/created/rotated/stored/printed/validated; no live Groq request; no provider activation or rollout promotion; no live Core/WhatsApp/n8n/send; no persistence/DB/migration 0008; no dashboard/deployment.** The existing model gateway remains the **only** router and the sole owner of retry/timeout/circuit/failover; Groq returns model output only; M4 makes a draft; **QuickFurno Core remains the only business authority.** The `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

M5 (ADR-0059) closed the final non-live foundation. The roadmap's next launch step is a **live staging provider binding through the model gateway**. The Groq HOSTED adapter itself was already built and proven against deterministic fakes in P04.01B, but it was never **bound** for staging use: there is no async credential-resolution flow (the adapter takes an already-materialized `GroqApiKey`), and no factory that constructs the adapter from an **approved release** with fail-closed data-class/execution/attestation gates. S1 supplies exactly that binding — deterministically, behind fakes, making **no** live call and touching **no** real credential — so a later, separately-authorized step can inject a staging secret and run one synthetic live smoke test.

## Decision

### A. Purpose

The first production-capable hosted-provider **binding** behind the model gateway. It reuses the existing Groq Chat Completions adapter and adds a staging binding. **No live call or real credential now.**

### B. API

Groq **OpenAI-compatible Chat Completions** (as in ADR-0046) is the MVP surface. The Responses API is **not** an MVP dependency. Non-streaming structured output only. **No** tools, MCP, web search, code execution, Compound, or provider built-ins.

### C. Fixed origin / SSRF

Only the exact endpoint (unchanged from ADR-0046): scheme `https`, host `api.groq.com`, default port `443`, path `/openai/v1/chat/completions`. No request-supplied URL/path, no arbitrary base URL, `redirect: 'error'`, no proxy/tunnel config, no credential in URL/query. The binding never overrides the endpoint; the production factory uses the fixed transport.

### D. Credential boundary

Use an **injected async credential resolver** taking an **opaque reference only** (`GroqCredentialResolver.resolve(reference): Promise<GroqApiKey>`). **No `process.env`** in the provider/model packages. The key may exist only at the final Authorization-header construction edge (the existing `GroqApiKey`), never in models/events/errors/tests/reports. A **missing/unresolvable credential fails before transport** (before any provider is returned). Tests use an obvious fake sentinel only. **No** real environment or secret store is inspected.

### E. Exact release binding

**No hard-coded model id.** The binding is driven by a model-gateway-approved `ProviderReleaseRef` (exact `releaseId`/`providerId`/`modelId`/`modelVersion`/`executionClass`/`configDigest`) plus the approved capability/token/strict-schema/data-controls/prompt/capability/evaluation references. **No wildcard or `latest`** (an explicit guard rejects `*`/`latest` on any identity field). The binding **activates nothing, promotes no rollout, and selects no fallback** — release resolution, capability gates, rollout, retry, timeout, circuit, and failover stay with the gateway.

### F. Data class / minimization

`HOSTED_ALLOWED` only. `LOCAL_ONLY` / `HUMAN_ONLY` fail **before credential resolution and transport**. The M4-minimized input is not expanded here (the binding constructs a provider; it does not build a request). No subject id, phone, internal notes, hidden history, or unrelated context; no real user data.

### G. Structured output

Unchanged from ADR-0046: the strict schema is translated to `response_format` JSON Schema when the exact capability permits (`additionalProperties: false`, explicit `required`), the capability registry determines strict support, strictness is never silently downgraded, best-effort mode is followed by strict local validation, and malformed output fails closed. S1 binds the `supportsStrictJsonSchema` flag from the approved release.

### H. Request

Unchanged from ADR-0046: non-streaming; `n` absent or `1`; exact release model; exact bounded messages; exact structured schema; exact approved sampling/token config; **no** `tools`/`tool_choice`/`logprobs`/`logit_bias`/`top_logprobs` or arbitrary provider fields.

### I. HTTP / cancellation

Unchanged from ADR-0046: the async fixed-origin transport forwards the gateway `AbortSignal`, the adapter owns no retry, **one HTTP request maximum per invocation**, bounded request/response size, JSON content assumed, redirects denied, body read once, raw body never exposed. The binding injects this transport (production = the fixed fetch transport; tests = a deterministic fake) and performs **no** invocation itself.

### J. Response / provenance

Unchanged from ADR-0046: validate status, JSON shape, exactly one choice, non-empty structured content, model/provenance consistency, acceptable finish reason, bounded usage; return the provider-neutral response/provenance only; no raw header/body/CoT.

### K. Error normalization

Unchanged from ADR-0046: HTTP/network failures map into the gateway vocabulary (invalid request, auth, model unavailable, rate-limited, timeout/cancelled, transient server/network, malformed, permanent refusal/invariant). 429 → rate-limited (bounded `retry-after` parsed); 401/403 → auth; 404 → unavailable; 408/5xx → transient/timeout. No raw content/key; no adapter retry.

### L. Rate-limit metadata

Unchanged from ADR-0046: only a bounded approved `retry-after` (and, where present, remaining/reset) counter; never raw headers; the gateway decides retry.

### M. Observability

Content-free everywhere. The S1 bind observability carries only safe references (provider/model/version/config-digest/capability/evaluation/data/execution class), the bind reason, and a `credentialResolved` boolean — **never** messages, prompt/output/knowledge, subject/PII, key/token/auth, the credential reference value, raw body/header/error, or CoT.

### N. Data-control attestation

Reuse the exact provider-operations/data-controls (ZDR) attestation. The binding **fails closed** (`groq-bind-attestation-missing`) when a required attestation is absent; it fabricates **no** ZDR/privacy/billing/production approval. Synthetic tests are **not** production approval.

### O. Authority / non-goals

Groq returns model output only; M4 makes a draft; **QuickFurno Core is the final authority.** No send/deliver/execute/n8n. No live call/key/activation; no DB/migration 0008; no RAG; no dashboard/deployment. Kimi excluded. The minimum Conversation Operations Center remains mandatory before a pilot and is not implemented here.

## Consequences

- The existing Groq adapter becomes **staging-bindable**: a caller supplies an approved release, an opaque credential reference, an async resolver, and the fixed transport, and receives a ready `GroqModelProvider` — with the credential materialized only at bind time and all data-class/execution/attestation/credential gates failing closed before any transport.
- Nothing external is contacted: production would use the fixed fetch transport, but S1 tests inject a deterministic fake transport and a fake sentinel credential and make **no** network request.
- A later, **separately-authorized** step injects a real staging secret and runs **one** synthetic live Groq smoke test; only then does Core-side M3 adoption, delivery/persistence, the minimum Operations Center, and a controlled pilot follow.
