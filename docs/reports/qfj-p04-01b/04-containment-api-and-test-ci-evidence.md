# Report 04 — Containment, API Surface, and Test/CI Evidence

**Slice:** QFJ-P04.01B — Groq Cloud Adapter. **ADR:** [ADR-0046](../../decisions/ADR-0046-qfj-p04-01b-groq-cloud-adapter.md).

## Local quality gate — all green

Run against the working tree on branch `qfj-p04-01b-groq-cloud-adapter`:

| Gate                                  | Command                           | Result                                                 |
| ------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| Format                                | `prettier --check`                | PASS                                                   |
| Lint (whole repo, `--max-warnings=0`) | `pnpm run lint`                   | PASS                                                   |
| Typecheck (build + per-package tests) | `pnpm run typecheck`              | PASS                                                   |
| Unit tests (whole repo)               | `pnpm run test:unit`              | **2802 passed / 76 files**                             |
| — of which model-gateway              | 4 files                           | **98 passed** (47 foundation + 51 Groq)                |
| Build                                 | `pnpm run build`                  | PASS                                                   |
| Dist containment                      | `pnpm run check:dist-containment` | PASS (`dist is production-only; no test-key material`) |

Integration tests (`test:integration`) require the CI PostgreSQL service and run in CI; this slice touches no database, schema, or migration, so they are unaffected.

## Containment scan — the network boundary is exactly one function

`src/tests/containment.test.ts` was extended to the new bounded-network model and asserts, across every production (non-test) source file:

- **No env / filesystem I/O:** no `node:{fs,net,http,https,dns,tls,dgram,child_process}` import; no `process.env`; no provider SDK import (`pg`, `groq-sdk`, `openai`, `@anthropic-ai/sdk`, `ollama`, `axios`, `undici`).
- **`fetch` appears ONLY in `providers/groq/groq-transport.ts`** — the single designated egress — and is forbidden in every other production file.
- **No unauthorized adapter and no Kimi reference:** no `class OpenAIProvider` / `class LocalOpenAiCompatibleProvider`; the string `kimi` (any case) appears nowhere. Groq is the authorized first hosted adapter.

Cross-package invariants (unchanged by this slice, re-asserted):

- The event-backbone public-API lock remains **39**.
- Migrations 0001–0007 are byte-exact by SHA-256; **no 0008**.

## Public API surface — additive and neutral

The root barrel (`src/index.ts`) now also exports the Groq **composition** symbols and `createSystemClock`:

- `GroqModelProvider`, `GroqApiKey`, `createGroqApiKey`, `createGroqProviderConfig`, `createFetchGroqTransport`, `GROQ_CHAT_COMPLETIONS_ENDPOINT`, and the `GroqProviderConfig` / `GroqProviderConfigInput` / `GroqTransport` types.

It deliberately does **not** export: the raw `GroqHttpRequest`/`GroqHttpResponse` types, the response schema, the error-normalization table, or any key accessor. The `package.json` `exports` map is unchanged (`.` and `./testing`); the `FakeModelProvider` is still absent from the production root.

## Test inventory — `groq-adapter.test.ts` (51 tests)

Every test uses a deterministic injected transport and the sentinel key. **No network, no real key, no live call.**

| Group                           | Coverage                                                                                                                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key holder                      | rejects empty/whitespace/oversized; redacts via toString/toJSON/stringify; value only via Authorization builder                                                                                                                                                                              |
| Config                          | HOSTED capabilities; strict-flag reflection; rejects non-`GroqApiKey`, missing transport, bad identifier / token bound; error never echoes key; frozen + redacted on serialize                                                                                                               |
| Transport                       | SSRF guard rejects a non-official URL before the network; endpoint constant                                                                                                                                                                                                                  |
| Request mapping                 | minimal non-streaming single-choice body; no `max_tokens`/`tools`/`functions`/`reasoning`; headers to boundary; TEXT omits `response_format`; strict json_schema; pre-transport fail on non-strict schema; json_object fallback                                                              |
| Completed responses             | TEXT with injected-clock latency; STRUCTURED parsed locally; usage mapped / tolerated missing; each accepted finish reason                                                                                                                                                                   |
| Error normalization             | 429/498/500/503 → unavailable+retryable; 499 → cancelled; 400/401/403/404/422 → failed non-retryable; raw body never leaks; unparseable/schema-invalid → malformed; ≠1 choice / null content / unknown finish → failed; STRUCTURED non-JSON → malformed                                      |
| Cancellation / network / health | already-aborted (no call); rejection+abort → cancelled; rejection → unavailable+retryable; fail-closed health; key never in descriptor/capabilities/result                                                                                                                                   |
| Gateway integration             | HOSTED_ALLOWED routes through Groq; LOCAL_ONLY never selects HOSTED (no call); HUMAN_ONLY never reaches a provider; retryable 429 respects retry budget (2 calls); non-retryable 401 does not retry (1 call); structured validated through the gateway; schema-violating structured rejected |

## Working tree

Only the intended files are changed: the Groq adapter source, the four additive gateway/contract/clock/barrel edits, the two test files, ADR-0046, this report set, and the narrow roadmap update. No build artifact is tracked; the lockfile is unchanged (zod was already the model-gateway dependency from QFJ-P04.01A). The protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory is untouched.
