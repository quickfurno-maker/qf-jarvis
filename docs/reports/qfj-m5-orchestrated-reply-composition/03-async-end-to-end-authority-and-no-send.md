# Report 03 — Async End-to-End Flow, Authority, and No-Send

**Slice:** QFJ-M5. **ADR:** [ADR-0059](../../decisions/ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) §E, §F, §I.

## The composed flow (async end to end)

`createJarvisRuntime(config).processInbound(envelope): Promise<JarvisRuntimeResult>` runs the ADR-0059 §E order, awaiting every I/O-capable boundary:

1. validate inbound (M2, against the authoritative context);
2. **await** read authoritative state (context);
3. M1 assignment / scope / takeover / pause / privacy (first gate; the privacy gate is **awaited** when a subject is present);
4. exact optional governed knowledge via the existing injected port (**awaited**; bounded exact, no RAG);
5. **await** the M4 model reply adapter through the existing gateway boundary;
6. **await** the post-model authoritative re-read (M4 post-gateway gate);
7. M2 `PENDING_CORE_VALIDATION` proposal;
8. **await** the M3 Core decision adapter (only when a Core transport is wired);
9. **await** the post-Core authoritative re-read (M3 post-response gate);
10. an immutable, deeply-frozen `JarvisRuntimeResult`;
11. **no** send / delivery / persistence.

The entry point is `async` and returns a `Promise`; the model and Core ports are each invoked **at most once** (proven by recording fakes), and there is **no** composition-owned retry, second router, or fallback — the existing model gateway stays the only routing authority.

## Closed result mapping

`JarvisRuntimeResult.outcome` is one of `REFUSED`, `MODEL_DRAFTED`, `CORE_ACCEPTED`, `CORE_REJECTED`, `HUMAN_REVIEW_REQUIRED`, `RETRY_LATER`, `STALE_REVISION`, `CORE_UNAVAILABLE`, `NO_ACTION`:

- a gate block / invalid draft / rejected Promise → **`REFUSED`** with the safe orchestration reason (no raw error, no unhandled rejection);
- a valid proposal with **no Core transport wired** → **`MODEL_DRAFTED`** (Core deferred, never faked);
- a Core decision → the mapped `CORE_ACCEPTED` / `CORE_REJECTED` / `HUMAN_REVIEW_REQUIRED` / `RETRY_LATER` / `STALE_REVISION` / `CORE_UNAVAILABLE`, retaining the exact proposal/conversation/revision references.

`NO_ACTION` is a reserved closed member for a future non-`REPLY` model outcome; the current `REPLY`-only orchestration does not fabricate it.

## Authority and no-send

- Every proposal remains `PENDING_CORE_VALIDATION` (inherited from M2); the model draft is a **proposal input only**.
- **`CORE_ACCEPTED` comes solely from the M3 Core response** — never fabricated, never upgraded — and is **revision-bound** (`boundRevision`). A run with no Core transport yields `MODEL_DRAFTED`, never a faked acceptance.
- `CORE_ACCEPTED` is **never sent, delivered, executed, or persisted**: the result exposes no `send`/`deliver`/`execute`/`persist`/`callN8n`/`transmit` field, and the runtime object exposes **only** `processInbound` (asserted; frozen).
- CLIENT → Riya, VENDOR → Anisha, UNKNOWN → Jarvis (or Human under a HUMAN policy, which refuses before the model); HUMAN_ONLY reaches no model; LOCAL_ONLY never uses a hosted release; a non-`clear` subject (tombstoned/erased) blocks before the model.

## Rejection normalization

A rejected authoritative-state read, gateway invocation, or Core transport is normalized to a fail-closed result (`REFUSED` / `CORE_UNAVAILABLE`) with **no raw error** in the result — proven by asserting the synthetic fault strings never appear in the serialized result.
