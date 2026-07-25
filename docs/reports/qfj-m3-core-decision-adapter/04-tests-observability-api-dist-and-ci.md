# Report 04 — Tests, Observability, Public API, Dist, and CI

**Slice:** QFJ-M3. **ADR sections:** [ADR-0056](../../decisions/ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) §H–§L.

## Test matrix

Five spec files, **50** M3 tests, all passing (database-free, parallel):

- `adapter.test.ts` — a matching `ACCEPTED` succeeds and is frozen; a `REJECTED`/`HUMAN_REVIEW_REQUIRED` is never upgraded; a `RETRY_LATER` is retryable without auto-retry; a missing transport, a normalized exception/timeout (no raw leak), a malformed response, and a mismatched-identity `ACCEPTED` all fail closed to `CORE_UNAVAILABLE`; the pre-transport gate blocks on each of the six blocking conditions with **zero** transport invocations; the post-response gate blocks a late state change (reader read twice) while a non-`ACCEPTED` reads once; the adapter exposes only `decide`/`decideDetailed` (no send/deliver/execute/persist/callN8n/authorize) and `decide` returns the closed outcome only.
- `command-idempotency.test.ts` — the command is frozen, protocol-versioned, and identity-bound; a reply body appears only for a `REPLY`; an invalid protocol/instant/correlation id is rejected; the idempotency key is deterministic and changes on revision/proposal-version/protocol-version change and matches the embedded key; the serialized command carries no CoT/secret/raw provider field.
- `response-validation.test.ts` — an exact match validates and is frozen; non-JSON, a schema violation, and an unknown outcome fail as `adapter-response-invalid`; a wrong protocol/command id/idempotency key/proposal id/proposal version/conversation id/bound revision fails as `adapter-identity-mismatch`.
- `retry-observability.test.ts` — every closed reason is classified deterministically; observability emits only closed content-free event types; no message/subject/secret text appears in events; a gate refusal emits `response-refused` not `completed`; the default hook is a silent no-op.
- `containment.test.ts` — the repository guardrails below.

## Public API lock (§L)

The root barrel exports **exactly 18** value symbols: `CORE_ADAPTER_ERROR_CODES`, `CORE_ADAPTER_EVENT_TYPES`, `CORE_ADAPTER_REASONS`, `CoreAdapterError`, `DEFAULT_CORE_DECISION_PROTOCOL`, `NOOP_CORE_ADAPTER_OBSERVABILITY`, `buildCoreCommand`, `canonicalJson`, `contentDigest`, `coreCommandResponseSchema`, `coreDecisionProtocolSchema`, `createCoreDecisionAdapter`, `idempotencyKeyFor`, `isCanonicalInstant`, `isRetryable`, `isStateBlocked`, `serializeCommand`, `validateResponse` (plus type-only exports). The deterministic fakes/fixtures (`scriptedCoreTransport`, `coreRequest`, `scriptedStateReader`, `fixedClock`, …) are exposed **only** under `./testing` and are proven **absent** from the root barrel.

## Containment guardrails

Scanning all production (`src`, excluding `src/tests`) files proves: no `fetch(`, no `process.env`, no `node:{fs,net,http,https,dns,tls,dgram,child_process,crypto}` import, no provider/DB/n8n library (`pg`, `groq-sdk`, `openai`, `axios`, `undici`, `whatsapp-web.js`, `@whiskeysockets/baileys`, `n8n`), and **no P04 or event-backbone package import** — `@qf-jarvis/agent-runtime` is the **only** workspace dependency. The manifest depends **only** on `@qf-jarvis/agent-runtime` + `zod` and exposes **only** `.` and `./testing`. Migrations 0001–0007 are **byte-exact** (sha256-locked) and there is **no 0008**. The `@qf-jarvis/event-backbone` public-api lock remains **39**. Production source holds **no NUL/control byte**.

## Dist containment (§L)

The emitting build (`tsconfig.build.json`) sets `rootDir: src`, `outDir: dist`, and **excludes `src/tests/**`**. `dist/` therefore contains the production modules and the shipped `./testing` support, and **zero** compiled `*.test.*` files (verified: 0 test artifacts under `dist`). The repository `check:dist-containment` reports `dist is production-only; no test-key material; exports are the approved root surface`.

## CI

Whole-repo `format:check`, `lint --max-warnings=0`, `typecheck` (+ `typecheck:tests`), `test:unit` (**3241** tests / **100** files), `build`, and `check:dist-containment` all pass locally on the exact branch head. The DRAFT PR CI is expected green on the same head.
