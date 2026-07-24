# Report 05 — Exit-Readiness and Non-Goal Audit

**Slice:** QFJ-P04.01B — Groq Cloud Adapter. **ADR:** [ADR-0046](../../decisions/ADR-0046-qfj-p04-01b-groq-cloud-adapter.md).

## Exit criteria — met

- [x] ADR-0046 committed first (`9f2508a`), before any adapter code.
- [x] A real `GroqModelProvider` implements the existing `ModelProvider` contract — no contract fork.
- [x] One bounded, non-streaming Chat Completions invocation per `invoke`; the adapter never retries/sleeps.
- [x] Injected key + injected transport; the key value confined to the transport boundary and redacted everywhere else.
- [x] The single network egress is one SSRF-guarded `fetch` in `groq-transport.ts`; no other production file may call `fetch`.
- [x] Structured output via strict `json_schema` or best-effort `json_object`; the gateway's zod validation stays the authority.
- [x] Closed-schema response validation; bounded error/retryability normalization; raw bodies/headers/key never surfaced.
- [x] `health()` fails closed until a Groq data-controls (ZDR) attestation is injected.
- [x] Validated only through a deterministic injected transport with a sentinel key — no real key, no live call, no network in tests/CI.
- [x] Gateway respects Groq's retryability (retryable retried within budget; non-retryable not retried) with QFJ-P04.01A behaviour preserved.
- [x] All local gates green (format, lint, typecheck, 2802 unit tests, build, dist-containment).
- [x] Narrow docs only: ADR-0046, this report set, a bounded roadmap status update.

## Non-goals — confirmed absent

This slice did **not**, and this report asserts it did not:

- read, request, or create a Groq API key; place any secret in the repository; make any live external request; or activate production.
- add any agent runtime, Riya/Anisha prompt logic, memory, RAG, model tool-calls, MCP, web search, code execution, built-in provider tools, or n8n.
- touch any database, schema, or migration; reserve or add **migration 0008**; or access a managed database.
- deploy anything, merge this PR, delete a branch, or use squash/rebase/admin-bypass/auto-merge.
- introduce `process.env`, a secret loader, or a hard-coded production model default.
- add the deprecated `max_tokens`, streaming, the Responses API, tools/functions, or any chain-of-thought/reasoning output.
- change the event-backbone root API (remains **39**), migrations 0001–0007, or the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory.

## Standing boundary — reaffirmed

Riya is client-only, Anisha vendor-only, Jarvis the coordinator, QuickFurno Core the final authority, n8n execution-only. Kimi is excluded unless the owner reintroduces it. Model providers perform bounded inference only and authorize/execute nothing.

## Readiness

QFJ-P04.01B is **implementation-complete on a DRAFT PR, not merged, not production-active**. The next steps are: owner review, a separately authorized guarded merge (expected-head guard, normal merge commit), and — only when the owner supplies a real key, a real transport, and a ZDR attestation, and flips the gateway mode — production activation. The natural next slice is **QFJ-P04.01C (Local OpenAI-Compatible Adapter)** behind the same contract.
