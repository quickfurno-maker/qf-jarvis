# Report 03 — Tests, Evidence, and Preserved Invariants

**Slice:** QFJ-M4 async-compatibility correction. **ADR:** [ADR-0058](../../decisions/ADR-0058-asynchronous-runtime-integration-boundaries.md).

## Async test matrix

Every existing M1–M4 spec that calls an I/O-capable port now awaits it. Three new async-behavior specs prove the matrix directly:

- **`packages/agent-runtime/src/tests/async-runtime.test.ts`** — `orchestrateInbound` returns a `Promise`; a delayed valid model + Core result yields a proposal only with both ports awaited (invoked once each); a rejected model Promise → `orchestration-model-unavailable` (Core not invoked, no raw error); a rejected Core Promise → `CORE_UNAVAILABLE` (no raw error); a revision bump / takeover that lands **while `draftReply` is pending** is seen by the awaited post-draft re-read and blocks Core; determinism across awaits; pure `createReplyPlan` stays synchronous (not a `Promise`).
- **`packages/core-decision-adapter/src/tests/async-transport.test.ts`** — the transport is awaited and invoked exactly once; a rejected transport Promise → `CORE_UNAVAILABLE` with no retry/raw error; a cancellation landing while the transport is pending → `STALE_REVISION` (post-response read observed it); a delivered `ACCEPTED` exposes no send/deliver/execute/persist surface.
- **`packages/model-reply-adapter/src/tests/async-gateway.test.ts`** — `draftReplyDetailed` returns a `Promise`; the gateway is invoked exactly once; a rejected invocation → `model-gateway-transient` with no retry/raw error; a revision bump / cancellation landing while the gateway is pending blocks the draft.

## Whole-repo evidence

- `pnpm run format:check` — clean.
- `pnpm run lint` (`eslint . --max-warnings=0`) — clean.
- `pnpm run typecheck` (`tsc --build` + every package `typecheck:tests`) — clean.
- `pnpm run test:unit` — **3327** tests across **110** files pass (was 3307; +20 async specs). No PostgreSQL, no network.
- `pnpm run build` + `pnpm run check:dist-containment` — build green; `dist is production-only; no test-key material; exports are the approved root surface`.

## Public API locks (deliberately reviewed)

No root barrel gained or lost a value symbol. `@qf-jarvis/model-reply-adapter` still exports exactly its 8 value symbols; `@qf-jarvis/core-decision-adapter` and `@qf-jarvis/agent-runtime` barrels are unchanged. Only method **return types** changed (T → `Promise<T>`) on the injected port interfaces; the deterministic fakes stay under `./testing` and remain absent from every root barrel.

## Preserved M1–M4 invariants

- **Authority.** Riya client-only; Anisha vendor-only; Jarvis coordinator; **QuickFurno Core** is the only business authority; model output is a draft/proposal only; a missing Core port fails closed; nothing is sent, delivered, executed, or persisted. Making a boundary async changed **when** a value arrives, never **who** decides.
- **Containment.** No `fetch`, `process.env`, `node:{fs,net,http,https,dns,tls,dgram,child_process,crypto}` import, provider/DB/n8n library, or forbidden `@qf-jarvis/*` import in production source; a new scan proves **no** `Atomics.wait`/`execSync`/`spawnSync`/`deasync` sync-over-async primitive.
- **Migrations** 0001–0007 are byte-exact (sha256-locked) and there is **no** 0008. The `@qf-jarvis/event-backbone` public-api lock remains **39**. Production source holds no NUL/control byte. The protected directory `docs/reports/qfj-managed-reconciliation-0002-0005/` is untouched.

## Deliberately deferred (unchanged from M4)

No live async gateway/Core binding is wired here — the ports are async-shaped and driven by deterministic async fakes only. Live Groq/local/Core calls, keys/tokens/env, provider activation, rollout promotion, delivery/n8n/WhatsApp, persistence/DB, and semantic retrieval/RAG remain separate, later, owner-authorized slices. Binding a live provider or Core is now a drop-in `async` implementation of an already-async port — no public contract breaks.
