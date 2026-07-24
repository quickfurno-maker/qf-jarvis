# Report 01 — ADR and Implementation Manifest

**Date:** 2026-07-24. **Slice:** QFJ-P04.01C — Local OpenAI-Compatible Adapter. **ADR:** [ADR-0047](../../decisions/ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md).

> Implemented on a feature branch / DRAFT PR. Not complete, not merged. Merge is separately authorized after owner review.

## Baseline

- Locked base `main`: `55a948f6e813b4d92110d86694179d4eb6b02577` (QFJ-P04.01B merged via PR #41, two-parent merge of `2b4d362` + `797490e`).
- Feature branch: `qfj-p04-01c-local-openai-compatible-adapter`, from that exact SHA.
- ADR-0047 committed first: `97c6e9d` (`docs(adr): define QFJ-P04.01C local model adapter`).

## What this slice adds

The **second provider class** — a `LocalOpenAICompatibleModelProvider` (execution class **LOCAL**) implementing the same provider-neutral `ModelProvider` contract as Groq. It targets an OpenAI-compatible **non-streaming** Chat Completions server on a future private workstation/GPU node, reached through an **injected transport** whose production endpoint is validated down to a **private IP literal** (SSRF guard), with an **optional injected redacting** bearer token.

**No live local-model call, no model-server install, no model weights, no real token, no external/LAN network in tests/CI. No agent, no n8n, no RAG, no memory, no schema, no migration.** Production health fails closed until endpoint/model/auth-posture attestations are injected. Groq and local coexist behind the unchanged contract; adding local required no gateway/agent/Core/n8n rewrite.

## Changed-file manifest

**Added — local adapter (`packages/model-gateway/src/providers/local-openai-compatible/`):**

| File                           | Responsibility                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `local-endpoint-policy.ts`     | `createLocalEndpoint` + `LocalEndpointDescriptor` (branded class) — private-IP-only SSRF validator      |
| `local-secret.ts`              | `LocalAuthToken` — optional, redacting `toString`/`toJSON`/inspect; `createLocalAuthToken` bounds input |
| `local-transport.ts`           | `LocalTransport` + `createFetchLocalTransport` — the single network egress, pinned to the endpoint URL  |
| `local-contracts.ts`           | Internal request body type (`max_tokens`) + closed zod response schema; accepted finish reasons         |
| `local-structured-output.ts`   | Maps a STRUCTURED request to strict `json_schema` / `json_object` per declared support                  |
| `local-error-normalization.ts` | Maps an HTTP status to a normalized result with bounded `retryable`                                     |
| `local-provider-config.ts`     | `createLocalProviderConfig` — validates/freezes; LOCAL capabilities; three activation attestations      |
| `local-model-provider.ts`      | `LocalOpenAICompatibleModelProvider` — one bounded call per invoke; content-type check; never retries   |
| `index.ts`                     | Local composition surface — no raw HTTP type, no token accessor, no IP parser, no server-specific type  |

**Added — tests:** `src/tests/local-adapter.test.ts` (93 unit tests, deterministic transport + sentinel token).

**Modified — provider-neutral integration:**

| File                            | Change                                                                                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                  | Root barrel re-exports the local composition symbols (provider, config/factory, endpoint factory + descriptor, optional token type/factory, transport factory/type) — no raw HTTP type, no token accessor, no IP parser |
| `src/tests/containment.test.ts` | `fetch` now allowed in **two** designated transport files (Groq + local); local adapter authorized; unauthorized-adapter ban narrowed to a direct hosted OpenAI/Anthropic SaaS class                                    |

**Added — docs:** `docs/decisions/ADR-0047-*.md`; this `docs/reports/qfj-p04-01c/` set; a narrow `docs/architecture/qf-jarvis-roadmap-v3.md` status update.

## Package / dependency / public-API impact

- **No new dependency.** The adapter uses the platform `fetch` and `URL`; `zod` was already the package's only dependency. The lockfile is unchanged.
- **No new export subpath.** The `package.json` `exports` map remains exactly `.` and `./testing`.
- The root barrel public API is **deliberately widened** with the local composition symbols only (the same shape as the Groq block); no raw HTTP/SDK type, no token accessor, no internal IP parser is exported. `FakeModelProvider` remains absent from the production root.

## Files that must NOT change — verified unchanged

- `@qf-jarvis/event-backbone` package-root barrel — unchanged; its public-API lock remains **39** symbols.
- Migrations 0001–0007 — byte-identical (SHA-256 asserted in the containment test); **migration 0008 absent** and unreserved.
- The protected untracked directory `docs/reports/qfj-managed-reconciliation-0002-0005/` — untouched.
- The Groq adapter (QFJ-P04.01B) — unchanged.

## Commit plan (staged)

1. `docs(adr): define QFJ-P04.01C local model adapter` — **committed** (`97c6e9d`).
2. `feat(model-gateway): add local OpenAI-compatible adapter` — adapter source + barrel export.
3. `test(model-gateway): prove private endpoint and hybrid safety` — local test + containment update.
4. `docs(reports): record QFJ-P04.01C implementation evidence` — reports + roadmap update.
