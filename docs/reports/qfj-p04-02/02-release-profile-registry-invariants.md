# Report 02 — Release / Profile / Registry Invariants

**Slice:** QFJ-P04.02 — Model Capability Registry. **ADR:** [ADR-0050](../../decisions/ADR-0050-qfj-p04-02-model-capability-registry.md).

## Exact release key

Every profile is bound to a validated `ProviderReleaseRef` (QFJ-P04.01E): `releaseId`, `providerId`, `modelId`, `modelVersion`, `configDigest`, and execution class. There is **no wildcard** and **no privileged `latest` alias** — `latest` (if used) is only ever an exact literal id, never an authoritative alias (proven). The registry performs **no runtime model discovery** and makes **no `/models` call**.

## Capability profile — validated and frozen

`createModelCapabilityProfile` validates and freezes: closed `taskClasses` and `resultModes` (deduped); a `structuredOutputMode` of `strict-json-schema` / `json-object` / `unsupported`; positive bounded `maxInputTokens` / `maxCompletionTokens`; `supportsNonStreaming` fixed **true** (current serving is non-streaming) with a future-only `supportsStreaming`; timeout/cancellation support; and optional opaque `promptProfileRef` / `costProfileRef` / `evaluationApprovalRef`. It carries **no** business rule, agent prompt text, secret, provider SDK object, or arbitrary metadata bag.

Coherence rejections (each covered by a test):

- an invalid release identity (bad grammar) → rejected;
- an unknown task/result/structured mode → rejected;
- `maxCompletionTokens > maxInputTokens` (impossible budget) → rejected;
- a STRUCTURED result mode with `structuredOutputMode: 'unsupported'` → rejected;
- a non-`unsupported` structured mode without STRUCTURED in `resultModes` → rejected.

## Registry invariants

`createModelCapabilityRegistry(profiles)` builds an **immutable** registry (frozen handle) with **deterministic** ordering (sorted by release id). It rejects at construction:

- a **duplicate release id** (proven);
- a **duplicate exact provider/model/version/config tuple** even under a different release id (proven — a conflicting duplicate).

Resolution returns a **frozen, content-free `ModelCapabilityProfileSummary`** — release/provider/model ids and versions, execution class, config digest, task/result/structured modes, numeric limits, and the opaque profile references only. No provider instance, no secret, and no function is exposed (proven: `JSON.stringify(snapshot)` contains no api-key/bearer/private-key pattern, no message content, and no `function`). The registry offers no mutation and no register-after-construction; it reads no environment and performs no network/model discovery.

## Ownership and boundary

The registry lives inside `@qf-jarvis/model-gateway`. Provider adapters expose neutral `ProviderCapabilities` descriptors; the registry binds those claims to exact release identities. Routing consumes the registry; rollout consumes exact release identities. QFJ-P04.04 later supplies evaluation evidence/approval — **P04.02 performs no model evaluation**. There is **no global mutable singleton** and **no database/persistence**. `Kimi` appears nowhere (proven).
