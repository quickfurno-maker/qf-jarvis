# Report 02 — Provider-Neutral and Hybrid-Readiness Proof

**Date:** 2026-07-24. **Slice:** QFJ-P04.01A. **ADR:** [ADR-0045](../../decisions/ADR-0045-qfj-p04-01a-model-gateway-foundation.md).

## Provider-neutral contract

The runtime depends only on repository-owned contracts: `ModelRequest`, `ModelResponse`, `ProviderCapabilities`, and the `ModelProvider` interface (`descriptor`, `capabilities()`, `health()`, one non-streaming `invoke()`). A provider is an **inference engine only** — it has no business-authority method, executes no tool, holds no n8n access, and touches no database. A provider SDK type **never crosses the boundary**: `invoke` takes a bounded, sanitized `ProviderInvocationInput` and returns a normalized `ProviderInvocationResult` (completed/timeout/cancelled/unavailable/failed/malformed) — never a raw SDK object, header, or body.

## Hybrid-ready from day one (proven by tests)

- **Execution class is first-class:** every capability declares `HOSTED` or `LOCAL`; the router enforces the data class before availability/cost/latency.
- **`LOCAL_ONLY` can never select a hosted provider** — proven: a `LOCAL_ONLY` request against a hosted-only registry fails `local-provider-required` and the hosted provider is never invoked.
- **`HOSTED_ALLOWED` may select a hosted OR a local provider** — proven with both.
- **Provider policy order is configuration/injection** (the `providers` array), not hard-coded business logic — proven by the deterministic-order test.
- **No provider-specific field in public contracts:** no Groq/local/OpenAI field appears; the containment test asserts no real adapter class and no provider SDK import anywhere in production source.
- **No n8n dependency, no agent-specific prompt logic, no Core business rule** in the gateway; **no model name is hard-coded as architectural truth** (model identity is a provider-declared capability).

Therefore future Groq-first (QFJ-P04.01B) and later local-first (QFJ-P04.01C) operation are **configuration + evaluation approval**, not architecture rewrites: a real adapter implements the same `ModelProvider` interface, wrapping its SDK/HTTP internally, and is registered in the `providers` policy order.

## Runtime modes

`OFF / SHADOW / CANARY / ACTIVE / FALLBACK` are represented. In QFJ-P04.01A only **OFF** and **ACTIVE** execute; **SHADOW/CANARY/FALLBACK fail closed as not-enabled** (proven), so there is no hidden production enablement. Default is **OFF**.

## Not a real provider

`FakeModelProvider` (deterministic, no network/env/key) is the only adapter, exported from the **`@qf-jarvis/model-gateway/testing`** subpath so it can never be a production default (proven: the root barrel does not re-export it).
