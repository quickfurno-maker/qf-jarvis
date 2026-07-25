# Report 04 — Tests, Observability, Public API, Dist, and CI

**Slice:** QFJ-M5. **ADR:** [ADR-0059](../../decisions/ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) §B, §F, §H, §J.

## Test matrix

Four spec files, **28** M5 tests, all passing (database-free, parallel; no PostgreSQL, no network):

- `end-to-end.test.ts` — CLIENT→Riya and VENDOR→Anisha reach the M4 draft, the M2 proposal, and the M3 Core decision (`CORE_ACCEPTED`, frozen, revision-bound, no send surface); model once / Core once; one authoritative source delegated to by all readers; deterministic; `MODEL_DRAFTED` when Core is deferred; each Core outcome maps to the closed runtime outcome.
- `state-gates.test.ts` — UNKNOWN→Jarvis drafts while UNKNOWN under a HUMAN policy refuses before the model; HUMAN_ONLY / LOCAL_ONLY / tombstone block before the model; a revision or takeover change **while the model Promise is pending**, and a cancellation **while the Core Promise is pending**, both fail closed (genuine interleaving fakes).
- `fail-closed.test.ts` — a missing mandatory dependency throws `JarvisRuntimeError` at construction; a missing gateway invoker fails closed at runtime (Core never reached); rejected state/model/Core Promises are normalized with no raw leak; exact citations flow through, a fabricated citation fails closed, RAG stays disabled.
- `observability-containment.test.ts` — the repository guardrails and observability below.

## Observability (§H)

`JarvisRuntimeEvent` is a **closed-type** record carrying only safe ids (run/conversation), party/actor, revision, stage type, outcome, safe reason, and a canonical observed-at. Events are proven content-free: a `SECRET-INBOUND-XYZ` input and a `SECRET-REPLY-BODY-XYZ` reply body never appear, and no `subject`/`sk-`/`wamid` token appears; every event type is one of the closed `JARVIS_RUNTIME_EVENT_TYPES`; a completed run emits `jarvis-completed`. The default hook is a silent no-op.

## Public API lock (§B)

The root barrel exports **exactly 6** value symbols (`createJarvisRuntime`, `JARVIS_RUNTIME_OUTCOMES`, `JARVIS_RUNTIME_ERROR_CODES`, `JarvisRuntimeError`, `JARVIS_RUNTIME_EVENT_TYPES`, `NOOP_JARVIS_RUNTIME_OBSERVABILITY`). The runtime object exposes **only** `processInbound` (frozen; no `send`/`deliver`/`execute`/`persist`/`callN8n`/`authorize`). The deterministic fakes are exposed **only** under `./testing` and are proven absent from the root barrel; the manifest depends only on the three lower packages and exposes only `.` and `./testing`.

## Containment guardrails (§J)

Scanning all production files proves: no `fetch(`, no `process.env`, no `node:{fs,net,http,https,dns,tls,dgram,child_process,crypto}` import, no provider/DB/n8n library (`pg`, `groq-sdk`, `openai`, `axios`, `undici`, `whatsapp-web.js`, `@whiskeysockets/baileys`, `n8n`), and **no** `Atomics.wait`/`execSync`/`spawnSync`/`deasync` sync-over-async primitive. The **dependency direction is one-way** — none of `@qf-jarvis/agent-runtime`, `@qf-jarvis/core-decision-adapter`, or `@qf-jarvis/model-reply-adapter` depends on `@qf-jarvis/jarvis-runtime` (no reverse dependency / cycle). Migrations 0001–0007 are **byte-exact** (sha256-locked) and there is **no 0008**. The `@qf-jarvis/event-backbone` public-api lock remains **39**. Production source holds **no** NUL/control byte.

## Dist containment (§B)

`tsconfig.build.json` sets `rootDir: src`, `outDir: dist`, and **excludes `src/tests/**`** (asserted). `dist/` therefore contains the production modules and the shipped `./testing` support and **zero** compiled `*.test.*` files (verified 0). The repository `check:dist-containment` reports `dist is production-only; no test-key material; exports are the approved root surface`.

## CI

Whole-repo `format:check`, `lint --max-warnings=0`, `typecheck` (+ `typecheck:tests`), `test:unit` (**3355** tests / **114** files), `build`, and `check:dist-containment` all pass locally on the exact branch head. The DRAFT PR CI is expected green on the same head.
