# Report 02 — Async Contracts, State Gates, and At-Most-Once

**Slice:** QFJ-M4 async-compatibility correction. **ADR:** [ADR-0058](../../decisions/ADR-0058-asynchronous-runtime-integration-boundaries.md) §2, §6, §7, §8, §9, §10.

## Agent runtime async contract

`orchestrateInbound` is `async` and awaits the injected ports in their existing deterministic order — context read → first gate (privacy awaited) → knowledge → model plan → **await** `draftReply` → validate draft → **await** context re-read (double gate) → second gate → proposal → **await** Core `decide`. Every prior invariant is preserved: deterministic `CLIENT → RIYA` / `VENDOR → ANISHA`; human takeover / AI pause blocks **before** the awaited model call; the double state/privacy/revision gate now brackets the awaited model call; output is a `PENDING_CORE_VALIDATION` proposal only; a missing Core port fails closed to `CORE_UNAVAILABLE`; nothing is sent, executed, or persisted. `processInbound` is `async` and awaits the privacy gate before any model/knowledge interface.

**Rejection is normalized (ADR-0058 §7).** A rejected model `draftReply` Promise is caught and fails closed to `orchestration-model-unavailable` (Core is not invoked); a rejected Core `decide` Promise is caught and fails closed to `CORE_UNAVAILABLE` (never fabricated). Neither leaks a raw error, and neither becomes an unhandled rejection.

## Core decision adapter async transport contract

`decideDetailed`/`decide` are `async`. The flow awaits the **pre-transport** state gate, sends the command through the injected transport **at most once**, awaits it, strictly validates the response identity, then awaits the **post-response** state gate. A stale/takeover/pause/cancel/privacy/revision change — including one that lands **while the transport Promise is pending** — blocks a Core `ACCEPTED`. A rejected transport Promise (exception/timeout) is normalized to a safe `CORE_UNAVAILABLE` with no raw error and **no automatic retry**. `ACCEPTED` remains not sent, delivered, executed, or persisted.

## Model reply adapter async gateway contract

`draftReply`/`draftReplyDetailed` are `async`. The synchronous-only `ModelGatewayInvoker` seam is gone; `invoke` now returns `Promise<ModelGatewayInvocation>`, matching the existing gateway's `invoke(request, options?): Promise<ModelResponse>`. The flow awaits the **pre-gateway** state gate, invokes the gateway **at most once**, awaits the result, validates provenance / structured output / citations, then awaits the **post-gateway** state gate. A change during the round-trip (including one landing while the gateway Promise is pending) blocks the draft. The invoker stays a thin seam over the existing gateway — **no** second router, provider selection, fallback, hard-coded provider/model id, activation, or rollout mutation — and owns **no** retry. Cancellation is **not** re-invented: the gateway already owns `AbortSignal` at its boundary, and stale/cancelled conversation state is enforced by the awaited state gate.

## State change while awaiting → fail closed (ADR-0058 §7)

Each adapter re-reads content-free state **after** the awaited external call. Because the read happens after the `await`, any change that occurred during the pending Promise is observed and fails closed. The new async specs prove this with genuine interleaving: a fake whose awaited body mutates the shared state cell that the reader observes on the post-await read — the draft/ACCEPTED is then refused.

## At most once, no independent retry (ADR-0058 §8, §9)

The recording fakes assert `invoked() === 1` on every path — clean success, transient refusal, permanent refusal, and rejected Promise. The agent runtime, the Core decision adapter, and the model reply adapter contain no retry loop, backoff, or re-invocation; any bounded retry belongs solely to the existing model gateway.
