# Report 02 — Endpoint, Credential, Request, and Structured Output

**Slice:** QFJ-S1. **ADR:** [ADR-0060](../../decisions/ADR-0060-qfj-s1-groq-staging-provider-binding.md) §C, §D, §E, §F, §G, §H.

## Fixed origin / SSRF (§C)

Unchanged from ADR-0046 and reused as-is: the only endpoint is `https://api.groq.com/openai/v1/chat/completions` (`GROQ_CHAT_COMPLETIONS_ENDPOINT`). The production transport (`createFetchGroqTransport`) refuses any other URL, sets `redirect: 'error'`, bounds the response body, and reads no environment. The binding never overrides the endpoint; a bound-provider structured invoke is asserted to target exactly that URL, and no credential appears in the URL/query (the key rides only the `Authorization` header at the transport edge).

## Credential boundary (§D)

- `GroqCredentialResolver.resolve(reference): Promise<GroqApiKey>` is injected and **async**; the reference is **opaque** (`{ ref: 'groq.staging.secret.v1' }` in fixtures), never the key.
- The key is materialized **only at bind time** into the existing redacting `GroqApiKey` (whose `toString`/`toJSON`/inspect return `[REDACTED_GROQ_API_KEY]`), read only by the transport when building the `Authorization` header.
- **No environment-variable access** anywhere in the package.
- A **missing/unresolvable credential fails closed before transport** (`groq-bind-credential-unavailable`); the resolver is consulted **at most once**.
- Proven: the fake sentinel key (`sk-FAKE-…`) and the opaque reference value **never** appear in the bind result or any event; a rejected resolver leaks no raw error string.

## Exact release binding (§E)

The binding is driven by a model-gateway-approved `ProviderReleaseRef` (`releaseId`/`providerId`/`modelId`/`modelVersion`/`executionClass`/`configDigest`) plus the approved bounds/refs (`maxInputTokens`, `maxCompletionTokens`, `supportsStrictJsonSchema`, `dataControlsAttested`, `capabilityProfileRef?`, `evaluationRef?`). **No hard-coded model id** — the request model equals `release.modelId` (asserted). **No wildcard/`latest`**: the binding rejects `latest` on any identity field (`groq-bind-release-invalid`) before credential resolution, and `createProviderReleaseRef` rejects `*` upstream. The binding **activates nothing, promotes no rollout, and selects no fallback**.

## Data class / minimization (§F)

`HOSTED_ALLOWED` only. `LOCAL_ONLY` / `HUMAN_ONLY` → `groq-bind-data-class-refused` **before** credential resolution and transport (resolver consulted 0 times). A non-`HOSTED` execution class → `groq-bind-execution-refused` (also before credential). The binding constructs a provider; it builds no request and expands no input — no subject id, phone, internal notes, hidden history, or real user data.

## Structured output (§G) and request (§H)

Reused from ADR-0046 and exercised through the bound provider: a STRUCTURED invoke with a strict-compatible schema (`type: 'object'`, `additionalProperties: false`) yields a `response_format` of `type: 'json_schema'` with `strict: true` — **no silent downgrade**; a non-strict-compatible schema (while strict is supported) **fails before any transport call**. The request is non-streaming (`stream: false`, `n: 1`), carries the exact release model and bounded messages, and contains **no** `tools`/`tool_choice`/`logprobs`/`logit_bias`/`top_logprobs` or arbitrary provider fields (all asserted). Malformed structured content fails closed as `malformed`.
