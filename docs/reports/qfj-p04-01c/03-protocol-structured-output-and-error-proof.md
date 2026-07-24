# Report 03 — Protocol, Structured-Output, and Error Proof

**Slice:** QFJ-P04.01C — Local OpenAI-Compatible Adapter. **ADR:** [ADR-0047](../../decisions/ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md).

## Request body — minimal, non-streaming, single choice

`LocalOpenAICompatibleModelProvider.invoke` builds exactly:

```
{ model, messages, stream: false, n: 1, max_tokens, response_format? }
```

Proven by the request-mapping test, which decodes the transport's captured body and asserts the fixed URL `http://127.0.0.1:11434/v1/chat/completions`, `stream === false`, `n === 1`, `max_tokens === 512` (the injected bound), the messages pass through, and the body has **no** `tools`, `functions`, `tool_choice`, `reasoning`, or `user` field. The completion bound is `max_tokens` — the field OpenAI-compatible local servers (Ollama/vLLM/llama.cpp/LocalAI) accept. There is **no `/models` discovery**, **no Responses API**, **no provider-specific extension**, and **no hard-coded model default** (the model id is injected).

## Structured output — per declared capability

`buildResponseFormat` maps a STRUCTURED request against the configured server's declared support:

| Declared support   | JSON Schema                           | Result                                                          |
| ------------------ | ------------------------------------- | --------------------------------------------------------------- |
| strict json_schema | object + `additionalProperties:false` | `response_format: json_schema` (strict, `qf_structured_output`) |
| strict json_schema | not strict-compatible                 | **fail before transport** → `{ status: 'failed' }`              |
| json_object only   | any                                   | `response_format: { type: 'json_object' }`                      |
| neither declared   | any                                   | **fail before transport** → `{ status: 'failed' }`              |

Each row is covered by a test (strict mapping; json_object fallback; strict-incompatible fails with zero transport calls; unsupported-mode fails with zero transport calls). A TEXT request carries **no** `response_format`. The provider parses structured content as JSON **locally** and returns `{ mode: 'STRUCTURED', value }`; the gateway's zod validation remains the authority. There is **no hidden JSON repair**.

## Response validation — content-type, then closed schema

On a `200`, the adapter first requires a **JSON content-type** (a `200 text/html` captive-portal/proxy page is treated as `malformed` — proven), then validates the entire body with `localChatResponseSchema` before reading a field. It then requires **exactly one** choice, **string** content, and a **recognized** finish reason (`stop`/`length`/`complete`/`eos`, or `null`). Latency comes from the **injected clock** (a test advances it inside the transport and asserts `latencyMs === 30`) — never a wall-clock read, never a sleep. Token usage is mapped when present and tolerated when absent.

## Error normalization — bounded, conservative retryability

`normalizeLocalHttpStatus` and the provider's response checks classify outcomes without surfacing a raw body/header/token:

| Outcome                                    | Normalized result               | Retryable |
| ------------------------------------------ | ------------------------------- | --------- |
| HTTP 429                                   | `unavailable`                   | **yes**   |
| HTTP 5xx (500/502/503/504, …)              | `unavailable`                   | **yes**   |
| Network/connect/refused/TLS (no abort)     | `unavailable`                   | **yes**   |
| HTTP 499                                   | `cancelled`                     | —         |
| Transport rejection with aborted signal    | `cancelled`                     | —         |
| Already-aborted signal (pre-call)          | `cancelled` (no transport call) | —         |
| HTTP 400/401/403/404/413/422 and other 4xx | `failed`                        | **no**    |
| 200 non-JSON content-type                  | `malformed`                     | —         |
| Unparseable / schema-invalid body          | `malformed`                     | —         |
| ≠1 choice, null content, unknown finish    | `failed`                        | **no**    |
| STRUCTURED content not valid JSON          | `malformed`                     | —         |

Each row is covered by a dedicated test; the raw error body (`must not leak`) is asserted absent from the result. The retryability classification is conservative: transient connect/capacity/server failures may be retried by the gateway; authentication/config/request/schema errors never are.

## One invocation, no internal reliability

`invoke` performs **exactly one** transport call and returns (proven). It never retries, never sleeps, never loops. Retry, backoff, timeout enforcement, circuit breaking, and budgets remain the gateway's job. The adapter's only timing input is the injected clock.
