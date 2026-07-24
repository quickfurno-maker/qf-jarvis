# Report 02 — Protocol and Request-Mapping Proof

**Slice:** QFJ-P04.01B — Groq Cloud Adapter. **ADR:** [ADR-0046](../../decisions/ADR-0046-qfj-p04-01b-groq-cloud-adapter.md).

This report proves the adapter speaks exactly the bounded Groq protocol ADR-0046 authorizes — nothing deprecated, nothing streaming, nothing that leaks a raw provider shape across the neutral boundary.

## The one endpoint, the one egress

- `GROQ_CHAT_COMPLETIONS_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'` is fixed and not overridable — there is no base-URL input anywhere in the config.
- `createFetchGroqTransport` is the **only** function in the whole package that calls `fetch`. It refuses any URL other than the official endpoint (an SSRF guard that throws **before** the network is touched), sets `redirect: 'error'`, and reads at most `GROQ_MAX_RESPONSE_BYTES` (1 MB) before returning a bounded `{ status, retryAfterSeconds, bodyText }`.
- The containment test (Report 04) asserts `fetch(` appears in `groq-transport.ts` and **nowhere else** in production source.

## Request body — minimal, non-streaming, single choice

`GroqModelProvider.invoke` builds exactly:

```
{ model, messages, stream: false, n: 1, max_completion_tokens, response_format? }
```

Proven by test **"sends a minimal non-streaming, single-choice body to the fixed endpoint"**, which decodes the transport's captured body and asserts:

- `model` is the injected `modelId` (no hard-coded production default);
- `stream === false`, `n === 1`, `max_completion_tokens === 1024` (the injected bound);
- the messages pass through as `{ role, content }`;
- the body has **no** `max_tokens` (the deprecated field), **no** `tools`, **no** `functions`, **no** `reasoning`.

## Structured output

`buildResponseFormat` maps a STRUCTURED request:

| Model capability                 | JSON Schema                           | Result                                                                                                          |
| -------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `supportsStrictJsonSchema` true  | object + `additionalProperties:false` | `response_format: { type: 'json_schema', json_schema: { name: 'qf_structured_output', strict: true, schema } }` |
| `supportsStrictJsonSchema` true  | not strict-compatible                 | **fails BEFORE any transport call** → `{ status: 'failed', retryable: false }`                                  |
| `supportsStrictJsonSchema` false | any                                   | `response_format: { type: 'json_object' }` (best-effort; gateway zod validation is the authority)               |

Proven by tests: strict json_schema mapping; the non-strict-compatible schema failing with **zero** transport calls; and the json_object fallback. A TEXT request carries **no** `response_format` (asserted).

## Authorization — value confined to the transport boundary

The adapter sets `authorization: Bearer <key>` and `content-type: application/json` on the request handed to the transport. Test **"carries the Authorization and content-type headers to the transport boundary only"** confirms the transport receives the header; Report 03 proves the value appears in **no** result, error, descriptor, provenance, or serialized config.

## Response validation — closed schema before any field is read

`groqChatResponseSchema` validates the entire decoded body before the adapter reads a single field. The adapter then requires **exactly one** choice, a **string** content, and a **recognized** finish reason (`stop`/`length`/`complete`/`eos`, or `null`). A STRUCTURED response is parsed as JSON locally and returned as `{ mode: 'STRUCTURED', value }` for the gateway to validate against the original zod schema; a TEXT response returns `{ mode: 'TEXT', text }`. Latency comes from the **injected clock** (test advances it inside the transport and asserts `latencyMs === 25`) — never a wall-clock read, never a sleep.

## One invocation, no internal reliability

`invoke` performs **one** transport call and returns. It never retries, never sleeps, never loops. Retry, backoff, timeout enforcement, circuit breaking, and budgets remain the gateway's job (Report 03). The provider's only timing input is the injected clock.
