# Report 01 — ADR and Manifest

**Slice:** QFJ-S1. **ADR:** [ADR-0060](../../decisions/ADR-0060-qfj-s1-groq-staging-provider-binding.md) (committed first).

## What this slice adds — and what it deliberately reuses

The Groq **OpenAI-compatible Chat Completions adapter already exists** (ADR-0046, QFJ-P04.01B): `GroqModelProvider`, the fixed-origin SSRF-guarded transport (`createFetchGroqTransport` → `https://api.groq.com/openai/v1/chat/completions`), the redacting `GroqApiKey`, the strict `response_format` JSON-Schema translation, the HTTP/error/rate-limit normalization, and the ZDR-gated `health()`. **S1 extends — it does not duplicate.** It adds only the missing **staging binding**:

- `GroqCredentialResolver` — an injected **async** resolver over an **opaque reference** (`resolve(reference): Promise<GroqApiKey>`); the key is materialized only at bind time, never held early, never from the environment.
- `bindGroqStagingProvider(config)` — a **release-driven factory** that constructs the existing `GroqModelProvider` from a model-gateway-approved `ProviderReleaseRef` (no hard-coded model id; an explicit wildcard/`latest` guard), with fail-closed data-class/execution/attestation/credential gates **before** any transport, the credential resolved **at most once**, and **no** invocation (no live call).
- Content-free bind observability (`GROQ_STAGING_EVENT_TYPES`, `GROQ_STAGING_BIND_REASONS`).

No second router or adapter is created. The existing gateway remains the only router and the sole owner of retry/timeout/circuit/failover.

## Manifest

- **Placement:** `packages/model-gateway/src/providers/groq/` — `groq-credential-resolver.ts`, `groq-staging-binding.ts`, `groq-staging-observability.ts` — plus `src/testing/groq-staging-testing.ts` (fakes) and `src/tests/groq-staging-binding.test.ts` (specs). No new package.
- **Root barrel additions:** `bindGroqStagingProvider`, `GROQ_STAGING_BIND_REASONS`, `GROQ_STAGING_EVENT_TYPES`, `NOOP_GROQ_STAGING_OBSERVABILITY`, and the S1 types (`GroqCredentialReference`, `GroqCredentialResolver`, `GroqStagingRelease`, `GroqStagingBindingConfig`, `GroqStagingBindResult`, `GroqStagingBindReason`, `GroqStagingEventType`, `GroqStagingBindEvent`, `GroqStagingObservabilityHook`). No barrel symbol was removed. The model-gateway barrel has no fixed symbol-count lock.
- **Testing subpath (`./testing`) additions:** `FAKE_GROQ_SENTINEL_KEY`, `SYNTHETIC_GROQ_CREDENTIAL_REFERENCE`, `fakeGroqCredentialResolver`, `missingGroqCredentialResolver`, `fakeGroqTransport`, `groqStructuredResponseBody`, `syntheticGroqStagingRelease`.
- **Dependencies:** unchanged (model-gateway depends on `zod` only). No new workspace dependency; the binding lives inside the gateway.

## Commit sequence

1. `docs(adr): define S1 Groq staging binding` — ADR-0060, committed **before** any code.
2. `feat(model-gateway): add secure Groq staging provider binding` — resolver + binding + observability + barrel exports.
3. `feat(model-gateway): normalize Groq staging fakes and structured response` — the `./testing` fakes.
4. `test(model-gateway): prove Groq staging binding safety and structured output` — the 16-test suite.
5. `docs(reports): record S1 Groq binding evidence` — these reports and the narrow roadmap update.

## Authority boundary (unchanged)

Riya client-only; Anisha vendor-only; Jarvis coordinator; **QuickFurno Core** is the final business authority; n8n is transport/execution only (absent here); models/providers authorize and execute nothing; Kimi excluded; RAG disabled. The minimum Conversation Operations Center remains mandatory before a pilot (not implemented here). Groq returns model output only; M4 makes a draft. **No real key, no live call, no activation/rollout, no Core/WhatsApp/n8n/send, no persistence/DB/migration 0008, no dashboard/deployment.** The `@qf-jarvis/event-backbone` root API remains **39**; migrations 0001–0007 are byte-exact with no 0008.
