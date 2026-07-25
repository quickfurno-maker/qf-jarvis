# Report 04 — Tests, Observability, Public API, Dist, and CI

**Slice:** QFJ-M4. **ADR sections:** [ADR-0057](../../decisions/ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) §C, §K, §L, §M, §N.

## Test matrix

Seven spec files, **66** M4 tests, all passing (database-free, parallel; no PostgreSQL, no network):

- `request-translation.test.ts` — exact, deeply-frozen request; exact actor/party/task/data class, release/provider/model/version/config/execution, prompt/capability/evaluation/policy, and citation digest; wildcard/`latest`, oversized id, and non-canonical instant rejected; closed scalar metadata; deterministic identity.
- `state-privacy.test.ts` — HUMAN_ONLY reaches no gateway; LOCAL_ONLY cannot use a hosted release; privacy/tombstone, takeover, pause, cancel, and party/assignment mismatch block pre-gateway; a post-gateway revision/privacy/cancel change blocks the draft (reader read twice).
- `gateway-authority.test.ts` — missing invoker fails closed; exception normalized with no raw leak; at most one invocation; no independent retry/fallback/provider-selection; a refusal remains a refusal; the adapter exposes no rollout/capability/evaluation/selection method.
- `structured-result.test.ts` — each closed kind accepted; malformed/unknown-kind/extra/chain-of-thought/send/oversized/body-less rejected; deterministic draft.
- `provenance-citations.test.ts` — exact provenance accepted; provider/model/version/prompt/run mismatch fails closed; capability/evaluation/execution-class mismatch fails closed at plan validation; exact citation subset accepted; fabricated/versionless/superseded rejected, never silently trimmed.
- `authority-observability.test.ts` — content-free events and minimized request; draft-only result with no Core `ACCEPTED`/send/execute field or method.
- `containment.test.ts` — the repository guardrails below.

## Observability (§L)

`ModelReplyAdapterEvent` is a **closed-type** record carrying only safe ids (run/conversation), actor/party/data class/task, release/provider/model/prompt/capability/evaluation reference ids, the result kind, a content-free reason, and already-normalized token/latency counters. Events are proven to contain **no** inbound/reply content (a `SECRET-INBOUND` input and a `SECRET-REPLY-BODY` reply never appear), no prompt/knowledge content, no subject/PII/key/token/raw error/chain-of-thought. The default hook is a silent no-op; a completed draft emits `model-adapter-completed` and a refusal emits `model-result-refused`.

## Public API lock (§C)

The root barrel exports **exactly 8** value symbols: `MODEL_REPLY_ADAPTER_ERROR_CODES`, `MODEL_REPLY_ADAPTER_EVENT_TYPES`, `MODEL_REPLY_ADAPTER_REASONS`, `ModelReplyAdapterError`, `NOOP_MODEL_REPLY_ADAPTER_OBSERVABILITY`, `STRUCTURED_REPLY_KINDS`, `createModelReplyAdapter`, `structuredReplySchema` (plus type-only exports incl. the `ModelGatewayInvoker` seam). The internal request builder, validators, and digest helpers are **not** exported; the deterministic fakes/fixtures are exposed **only** under `./testing` and are proven **absent** from the root barrel.

## Containment guardrails (§N)

Scanning all production files proves: no `fetch(`, no `process.env`, no `node:{fs,net,http,https,dns,tls,dgram,child_process,crypto}` import, no provider/DB/n8n library (`pg`, `groq-sdk`, `openai`, `axios`, `undici`, `whatsapp-web.js`, `@whiskeysockets/baileys`, `n8n`), and **no** governed-knowledge/model-evaluation/rag-provisioning/core-decision-adapter/event-backbone import — `@qf-jarvis/agent-runtime` and `@qf-jarvis/model-gateway` are the **only** workspace dependencies. The manifest depends **only** on agent-runtime + model-gateway + zod and exposes **only** `.` and `./testing`. Migrations 0001–0007 are **byte-exact** (sha256-locked) and there is **no 0008**. The `@qf-jarvis/event-backbone` public-api lock remains **39**. Production source holds **no NUL/control byte**.

## Dist containment (§C)

The emitting build (`tsconfig.build.json`) sets `rootDir: src`, `outDir: dist`, and **excludes `src/tests/**`**. `dist/` therefore contains the production modules and the shipped `./testing` support and **zero** compiled `*.test.*` files (verified 0). The repository `check:dist-containment` reports `dist is production-only; no test-key material; exports are the approved root surface`.

## CI

Whole-repo `format:check`, `lint --max-warnings=0`, `typecheck` (+ `typecheck:tests`), `test:unit` (**3307** tests / **107** files), `build`, and `check:dist-containment` all pass locally on the exact branch head. The DRAFT PR CI is expected green on the same head.
