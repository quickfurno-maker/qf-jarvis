# Report 01 — ADR and Composition Manifest

**Slice:** QFJ-M5. **ADR:** [ADR-0059](../../decisions/ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) (committed first).

## What this slice adds

One new package, **`@qf-jarvis/jarvis-runtime`** — a single **pre-transport composition root** that wires the already-merged M1 runtime, M2 orchestration, M3 Core decision adapter, and M4 model reply adapter into one deterministic, fail-closed, **async end-to-end** flow behind **ONE authoritative content-free async conversation-state source**. It **duplicates no business rule** and performs **no delivery, persistence, or live call**. It is the **FINAL major non-live foundation**.

## Package manifest

- **Name:** `@qf-jarvis/jarvis-runtime` (private, ESM, `sideEffects: false`).
- **Dependencies (one-way, only downward):** `@qf-jarvis/agent-runtime`, `@qf-jarvis/core-decision-adapter`, `@qf-jarvis/model-reply-adapter`. No reverse dependency and no cycle — a test asserts none of the three lower packages depends on `@qf-jarvis/jarvis-runtime`.
- **Exports:** `.` (the root surface) and `./testing` (deterministic fakes only). No other subpath.
- **Root barrel (6 value symbols):** `createJarvisRuntime`, `JARVIS_RUNTIME_OUTCOMES`, `JARVIS_RUNTIME_ERROR_CODES`, `JarvisRuntimeError`, `JARVIS_RUNTIME_EVENT_TYPES`, `NOOP_JARVIS_RUNTIME_OBSERVABILITY` (plus type-only exports incl. `AuthoritativeConversationStatePort`, `ConversationControlState`, `JarvisRuntimeConfig`, `JarvisRuntimeResult`, `JarvisRuntimeOutcome`, `JarvisRuntime`). The deterministic fakes stay under `./testing` and are proven absent from the root barrel.

## Layout

```
src/contracts/{authoritative-state,runtime-config,runtime-result,reasons,errors,observability}.ts
src/composition/{state-adapters,validate-composition,process-inbound,create-jarvis-runtime}.ts
src/testing/{deterministic-authoritative-state,deterministic-runtime-fixture,index}.ts
src/index.ts
```

## Commit sequence

1. `docs(adr): define M5 runtime composition root` — ADR-0059, committed **before** any code.
2. `feat(jarvis-runtime): add authoritative state composition` — the one authoritative source contract, the config/result/error/observability contracts, the state-adapter projections, fail-closed config validation, and the `./testing` fakes.
3. `feat(jarvis-runtime): wire model proposal and Core decision flow` — `composeAndProcess` and `createJarvisRuntime`.
4. `test(jarvis-runtime): prove end-to-end authority and stale-state gates` — the 28-test suite.
5. `docs(reports): record M5 composition evidence` — these reports and the narrow roadmap update.

## Authority boundary (unchanged)

Riya client-only; Anisha vendor-only; Jarvis coordinator; **QuickFurno Core** is the final business authority and system of record; n8n is transport/execution only and is absent here; models/providers/evaluators/retrievers authorize and execute nothing; Kimi is excluded. The Conversation Operations Center remains a mandatory later phase (not implemented here). The `@qf-jarvis/event-backbone` root API remains **39**; migrations 0001–0007 are byte-exact and there is no 0008.
