# Report 01 — Design and Implementation Manifest

**Date:** 2026-07-24. **Slice:** QFJ-P04.01B — Groq Cloud Adapter. **ADR:** [ADR-0046](../../decisions/ADR-0046-qfj-p04-01b-groq-cloud-adapter.md).

> Implemented on a feature branch / DRAFT PR. Not complete, not merged. Merge is separately authorized after owner review.

## Baseline

- Locked base `main`: `2b4d362ac28b86699b61f6d68eb17323b938ec35` (QFJ-P04.01A merged via PR #40).
- Feature branch: `qfj-p04-01b-groq-cloud-adapter`, from that exact SHA.
- ADR-0046 committed first: `9f2508ad8a29b7b32020dbe3e0b8c9464ccf3924` (`docs(adr): define QFJ-P04.01B Groq cloud adapter`).

## What this slice adds

The first **real HOSTED provider** — a `GroqModelProvider` implementing the existing provider-neutral `ModelProvider` contract from QFJ-P04.01A. It performs Groq's OpenAI-compatible Chat Completions call through an **injected HTTP transport**, behind a redacting **injected key** holder. It is the ONLY code in the package that may reach the network, and even that single egress is confined to one SSRF-guarded transport function.

**No real key, no live Groq call, no network in tests or CI. No agent, no n8n, no RAG, no memory, no MCP, no schema, no migration.** Production health fails closed until a Groq data-controls (ZDR) attestation is injected.

## Changed-file manifest

**Added — Groq adapter (`packages/model-gateway/src/providers/groq/`):**

| File                          | Responsibility                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `groq-secret.ts`              | `GroqApiKey` — private field, redacted `toString`/`toJSON`/inspect; `createGroqApiKey` bounds input |
| `groq-transport.ts`           | `GroqTransport` interface + `createFetchGroqTransport` — the SINGLE network egress; SSRF guard      |
| `groq-contracts.ts`           | Internal request body type + closed zod response schema; accepted finish reasons                    |
| `groq-config.ts`              | `createGroqProviderConfig` — validates/freezes injected config; HOSTED capabilities                 |
| `groq-structured-output.ts`   | Maps a STRUCTURED request to strict `json_schema` or best-effort `json_object`                      |
| `groq-error-normalization.ts` | Maps an HTTP status to a normalized result with bounded `retryable`                                 |
| `groq-model-provider.ts`      | `GroqModelProvider` — one bounded invocation per `invoke`; never retries/sleeps                     |
| `index.ts`                    | Groq composition surface — no raw HTTP type, no key accessor, no SDK object                         |

**Added — tests:** `src/tests/groq-adapter.test.ts` (51 unit tests, deterministic transport + sentinel key).

**Modified — additive, provider-neutral (required to let a real adapter request structured output and to let the gateway respect a provider's retryability):**

| File                            | Change                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contracts/provider.ts`     | Added optional `structuredJsonSchema?: unknown` to the invocation input; added `retryable?: boolean` to the `unavailable`/`failed` result variants |
| `src/gateway.ts`                | Renders a STRUCTURED request's zod schema to JSON Schema as a hint; threads per-failure `retryable` through retry/fallback                         |
| `src/reliability/clock.ts`      | Added `createSystemClock()` (production monotonic clock; never used by unit tests)                                                                 |
| `src/index.ts`                  | Root barrel re-exports the Groq composition symbols + `createSystemClock` (no raw HTTP type, no key accessor)                                      |
| `src/tests/containment.test.ts` | Split the network-boundary check: `fetch` allowed ONLY in `groq-transport.ts`, forbidden everywhere else; Groq allowed as an authorized adapter    |

**Added — docs:** `docs/decisions/ADR-0046-*.md`; this `docs/reports/qfj-p04-01b/` set; a narrow `docs/architecture/qf-jarvis-roadmap-v3.md` status update.

## Files that must NOT change — verified unchanged

- `@qf-jarvis/event-backbone` package-root barrel — unchanged; its public-API lock remains **39** symbols.
- Migrations 0001–0007 — byte-identical (SHA-256 asserted in the containment test); **migration 0008 absent** and unreserved.
- The `@qf-jarvis/model-gateway` package `exports` map — still exactly `.` and `./testing`; no new subpath.
- The protected untracked directory `docs/reports/qfj-managed-reconciliation-0002-0005/` — untouched.

## Commit plan (staged)

1. `docs(adr): define QFJ-P04.01B Groq cloud adapter` — **committed** (`9f2508a`).
2. `feat(model-gateway): add Groq provider adapter` — adapter source + additive gateway/contract/clock/barrel changes.
3. `test(model-gateway): prove Groq privacy and protocol boundaries` — Groq test + containment split.
4. `docs(reports): record QFJ-P04.01B implementation evidence` — reports + roadmap update.
