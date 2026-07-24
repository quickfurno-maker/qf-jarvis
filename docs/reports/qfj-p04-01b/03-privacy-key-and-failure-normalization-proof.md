# Report 03 — Privacy, Key-Containment, and Failure-Normalization Proof

**Slice:** QFJ-P04.01B — Groq Cloud Adapter. **ADR:** [ADR-0046](../../decisions/ADR-0046-qfj-p04-01b-groq-cloud-adapter.md).

## The key never leaves the transport boundary

`GroqApiKey` holds the value in a private `#value` field. `toString`, `toJSON`, and Node's inspect hook all return the fixed marker `[REDACTED_GROQ_API_KEY]`. The value is readable **only** through `authorizationHeaderValue()`, which only `GroqModelProvider.invoke` calls, only to populate the transport request header.

A **sentinel** key (`gsk_SENTINEL_test_value_do_not_use_000000` — not a real key, grants nothing) is used throughout the tests to prove non-leakage:

- `String(key)`, `key.toJSON()`, and `JSON.stringify({ key })` never contain the sentinel.
- `JSON.stringify(config)` never contains the sentinel (the frozen config redacts the held key).
- A validation error from `createGroqProviderConfig` never echoes the sentinel.
- On a `401` failure, `JSON.stringify(result)`, `JSON.stringify(provider.descriptor)`, and `JSON.stringify(provider.capabilities())` never contain the sentinel.
- Through the full gateway, `JSON.stringify(response)` contains neither the sentinel nor the request prompt (`SECRET-PROMPT`).

There is **no** `process.env` access and **no** secret loader anywhere in the package (Report 04's containment scan asserts this); the key is injected at composition only.

## No raw provider content escapes

Every HTTP/network/body failure is mapped to the gateway's bounded result vocabulary. The raw response body is never surfaced: test **"normalizes HTTP <status>"** asserts the result never contains the marker string `must not leak` that the transport returned as the error body.

## Failure normalization — bounded, with correct retryability

`normalizeGroqHttpStatus` and the provider's response checks classify outcomes as:

| Outcome                                 | Normalized result                  | Retryable |
| --------------------------------------- | ---------------------------------- | --------- |
| HTTP 429 (rate limit)                   | `unavailable`                      | **yes**   |
| HTTP 498                                | `unavailable`                      | **yes**   |
| HTTP 5xx (500, 503, …)                  | `unavailable`                      | **yes**   |
| HTTP 499 (client-closed)                | `cancelled`                        | —         |
| HTTP 400/401/403/404/422 and other 4xx  | `failed`                           | **no**    |
| Network/DNS/TLS rejection (no abort)    | `unavailable`                      | **yes**   |
| Transport rejection with aborted signal | `cancelled`                        | —         |
| Already-aborted signal (pre-call)       | `cancelled` (transport NOT called) | —         |
| Unparseable / schema-invalid body       | `malformed`                        | —         |
| ≠1 choice, null content, unknown finish | `failed`                           | **no**    |

Each row is covered by a dedicated test.

## The gateway respects Groq's retryability

The additive `retryable?: boolean` on the `unavailable`/`failed` result variants lets the gateway distinguish a transient failure from a terminal one:

- **Retryable (429):** with `retryBudget: 1`, the gateway retries once and ends `retry-budget-exhausted` — **two** transport calls (asserted).
- **Non-retryable (401):** with `retryBudget: 3`, the gateway does **not** retry and ends `provider-failed` — **one** transport call (asserted).

This preserves the existing QFJ-P04.01A gateway behaviour (a failure with no explicit retryability defaults to retryable, so the foundation's retry-budget test is unchanged) while letting a real adapter stop a pointless retry against an auth or client error.

## Fail-closed health

`health()` returns `{ available: config.dataControlsAttested }`. With no positive Groq data-controls (ZDR) attestation, the provider reports unavailable and the router excludes it — proven by the health test (attested → available; not attested → unavailable). Activation in production therefore requires an explicit attestation; the adapter cannot silently enable itself.

## Authority boundary — unchanged

The provider is an inference engine only: it has no authorize/execute method, no n8n access, no database, and no tool. It returns bounded data. Riya remains client-only, Anisha vendor-only, Jarvis the coordinator, QuickFurno Core the final authority, n8n execution-only; Kimi is excluded; the model authorizes and executes nothing.
