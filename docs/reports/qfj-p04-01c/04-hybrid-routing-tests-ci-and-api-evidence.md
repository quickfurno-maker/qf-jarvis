# Report 04 — Hybrid Routing, Tests, CI, and API Evidence

**Slice:** QFJ-P04.01C — Local OpenAI-Compatible Adapter. **ADR:** [ADR-0047](../../decisions/ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md).

## Hybrid routing — Groq (HOSTED) and local (LOCAL) coexist

The local provider implements the same `ModelProvider` contract as Groq, so the gateway routes both with **no rewrite**. Proven by gateway-integration tests using a deterministic Groq transport and a deterministic local transport together:

| Behaviour                                                | Result                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `LOCAL_ONLY` → local provider                            | selects local; **Groq transport called 0 times**                           |
| `LOCAL_ONLY` provenance                                  | `providerId: 'local'`, `modelId: 'qwen2.5-coder-7b'`                       |
| `HUMAN_ONLY`                                             | reaches **no** provider (`human-only`); both idle                          |
| `HOSTED_ALLOWED`, policy `[groq, local]`                 | selects Groq first; local idle                                             |
| `HOSTED_ALLOWED`, policy `[local, groq]`                 | selects local first; Groq idle                                             |
| `HOSTED_ALLOWED` primary fails, `allowFallback`          | **one** hosted→local fallback; `usedFallback: true`                        |
| `LOCAL_ONLY` local fails, `allowFallback`, Groq in array | **never** falls back to Groq; Groq called 0 times                          |
| `OFF` / kill switch                                      | prevents **both** providers                                                |
| retryable local failure (503), `retryBudget: 1`          | gateway retries once (2 transport calls), circuit uses normalized failures |
| local structured output                                  | gateway-validated; a schema violation → `structured-output-invalid`        |
| local response                                           | no `authorize`/`execute` method (advisory only)                            |

Privacy is enforced **before** availability: a `LOCAL_ONLY` request can never select the HOSTED Groq provider, and cannot fall back to it even when Groq is present in the policy array and fallback is enabled. The response never contains the request prompt (`SECRET-PROMPT`) or either secret.

## Local quality gate — all green

Run against the working tree on branch `qfj-p04-01c-local-openai-compatible-adapter`:

| Gate                                  | Command                           | Result                                   |
| ------------------------------------- | --------------------------------- | ---------------------------------------- |
| Format                                | `pnpm run format:check`           | PASS                                     |
| Lint (whole repo, `--max-warnings=0`) | `pnpm run lint`                   | PASS                                     |
| Typecheck (build + per-package tests) | `pnpm run typecheck`              | PASS                                     |
| Unit tests (whole repo)               | `pnpm run test:unit`              | **2895 passed / 77 files**               |
| — of which model-gateway              | 5 files                           | **191 passed** (98 P04.01B + 93 P04.01C) |
| Build                                 | `pnpm run build`                  | PASS                                     |
| Dist containment                      | `pnpm run check:dist-containment` | PASS                                     |

Integration tests (`test:integration`) require the CI PostgreSQL service and run in CI; this slice touches no database, schema, or migration, so they are unaffected.

## Containment scan — two egress points, still bounded

`src/tests/containment.test.ts` was extended so that, across every production (non-test) source file:

- **`fetch` appears ONLY in the two designated transport files** — `providers/groq/groq-transport.ts` and `providers/local-openai-compatible/local-transport.ts` — and is forbidden everywhere else.
- **No env / filesystem I/O:** no `node:{fs,net,http,https,dns,tls,dgram,child_process}` import; no `process.env`; no provider SDK import (`pg`, `groq-sdk`, `openai`, `@anthropic-ai/sdk`, `ollama`, `llama`, `vllm`, `localai`, `axios`, `undici`).
- **No unauthorized adapter and no Kimi reference:** Groq and the local OpenAI-compatible adapter are authorized; a direct hosted OpenAI/Anthropic SaaS class is not; the string `kimi` appears nowhere.

Cross-package invariants (unchanged by this slice, re-asserted): the event-backbone public-API lock remains **39**; migrations 0001–0007 are byte-exact by SHA-256; **no 0008**.

## Test inventory — `local-adapter.test.ts` (93 tests)

Every test uses a deterministic injected transport and a sentinel token. **No external/LAN network, no real token, no live call.**

| Group                  | Coverage                                                                                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint policy        | 14 allowed private forms; 21 rejected forms (public v4/v6, hostname, credentials, query/fragment/path, scheme, link-local, mapped-public, unspecified/broadcast/multicast, malformed, non-loopback plain-HTTP, port 0); error never echoes credentials; plain-HTTP-attestation rule |
| Transport              | SSRF guard rejects a mismatched URL before the network                                                                                                                                                                                                                              |
| Token holder           | rejects empty/whitespace/oversized; redacts via toString/toJSON/stringify; value only via Authorization builder                                                                                                                                                                     |
| Config                 | LOCAL capabilities; rejects forged endpoint / non-token / missing transport; no-token loopback; frozen + redacted; fail-closed health across all three attestations                                                                                                                 |
| Request mapping        | minimal non-streaming single-choice body; no tools/functions/tool_choice/reasoning/user; Authorization only with a token; TEXT omits `response_format`; strict json_schema; json_object; fail-before-transport on strict-incompatible and on unsupported structured mode            |
| Completed responses    | TEXT with injected-clock latency; STRUCTURED parsed locally; usage mapped/tolerated; each accepted finish reason                                                                                                                                                                    |
| Error normalization    | 429/500/502/503/504 → unavailable+retryable; 499 → cancelled; 400/401/403/404/413/422 → failed; non-JSON 200 → malformed; unparseable/schema-invalid → malformed; ≠1 choice / null content / unknown finish → failed; STRUCTURED non-JSON → malformed; raw body never leaks         |
| Cancellation / network | already-aborted (no call); rejection+abort → cancelled; rejection → unavailable+retryable; exactly one call; token never in descriptor/capabilities/result                                                                                                                          |
| Hybrid gateway         | the 11 routing rows above                                                                                                                                                                                                                                                           |

## Public API surface — additive and neutral

The root barrel now also exports the local **composition** symbols: `LocalOpenAICompatibleModelProvider`, `createLocalProviderConfig`, `createLocalEndpoint`, `LocalEndpointDescriptor`, `LOCAL_CHAT_COMPLETIONS_PATH`, `createFetchLocalTransport`, `LocalAuthToken`, `createLocalAuthToken`, and their config/endpoint/transport/structured-support types. It does **not** export the raw HTTP request/response types, the response schema, the error-normalization table, the internal IP parsers, or any token accessor. The `exports` map is unchanged (`.` and `./testing`).
