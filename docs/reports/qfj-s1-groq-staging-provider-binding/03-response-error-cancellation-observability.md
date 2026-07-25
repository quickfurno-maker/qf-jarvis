# Report 03 — Response, Error/Rate-Limit, Cancellation, and Observability

**Slice:** QFJ-S1. **ADR:** [ADR-0060](../../decisions/ADR-0060-qfj-s1-groq-staging-provider-binding.md) §I, §J, §K, §L, §M, §O.

## HTTP / cancellation (§I)

Reused from ADR-0046 and exercised through the bound provider: the async fixed-origin transport forwards the gateway `AbortSignal`; the adapter owns **no** retry; **one HTTP request maximum** per invocation; bounded request/response size; body read once; raw body never exposed. Proven: a **pre-aborted signal cancels without any transport call** (`status: 'cancelled'`, `calls() === 0`); a normal structured invoke makes **exactly one** request (`calls() === 1`). The binding itself performs **no** invocation.

## Response / provenance (§J)

Reused: the entire response is validated by a closed schema before any field is read; exactly one choice, a string content, an accepted finish reason, and bounded usage are required; the provider returns only the provider-neutral `{ status, output, usage, latencyMs }` shape. A valid structured response maps to `{ mode: 'STRUCTURED', value }`; zero/multiple choices, an empty/malformed body, or an unacceptable finish reason fail closed. No raw provider object/body/header/CoT crosses the boundary.

## Error / rate-limit normalization (§K, §L)

Reused: HTTP/network failures map into the gateway vocabulary — 400 → invalid/failed, 401/403 → auth, 404 → unavailable, 408/5xx → transient/timeout, **429 → rate-limited** (bounded `retry-after` parsed), a network exception → transient, a malformed body → malformed. Proven: a **429 with a secret-bearing body** normalizes to a safe status and the raw body string never appears in the result. Only a bounded approved `retry-after` counter is surfaced; raw headers are never exposed; **the gateway, not the adapter, decides retry**.

## Observability (§M)

The S1 bind observability is content-free: `GroqStagingBindEvent` carries only safe reference ids (provider/model/version/config-digest/capability/evaluation), the execution and data class, the bind reason, and a `credentialResolved` boolean. It **never** carries a message, prompt/output/knowledge, subject/PII, a key/token/`Authorization` value, the credential reference value, a raw body/header/error, or chain-of-thought. Proven: across a completed bind and a refused bind, every event type is one of the closed `GROQ_STAGING_EVENT_TYPES` (`groq-bind-completed`, `groq-bind-refused`), the refused event carries the exact reason and `credentialResolved: false`, and the serialized events contain no sentinel key or reference value. The default hook is a silent no-op.

## Authority (§O)

Groq returns model output only; the bound provider is an **inference engine** (`descriptor`/`capabilities`/`health`/`invoke`) with **no** send/deliver/execute/callN8n method; the bind result exposes no such method either. **M4 makes a draft; QuickFurno Core remains the final authority.** No send/deliver/execute/n8n; no live call/key/activation; no DB/migration 0008; no RAG; no dashboard/deployment.
