# Report 03 — Double State Gate, Retry Classification, Privacy, and Authority

**Slice:** QFJ-M3. **ADR sections:** [ADR-0056](../../decisions/ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) §A, §F, §I, §J, §K, §L.

## The injected transport (§F)

`CoreDecisionTransport.send(serializedCommand: string): string` is a **narrow, synchronous** seam. It carries **no business logic, no hidden retry, and no live network implementation**. The adapter serializes the command to a content-free canonical wire form, calls `send` **at most once**, and treats its return as untrusted input for strict validation. The **only** concrete implementations live under `./testing`.

## The double state gate (§I)

The adapter re-reads a **content-free** `CoreDecisionState` (`revision`, `partyType`, `humanTakeover`, `aiPaused`, `cancelled`, `subjectStatus`) through an injected reader and applies the **same** `isStateBlocked` check **twice**:

- **Pre-transport** — a revision drift, a party/assignment change, a human takeover, an AI pause, a cancellation, or a non-`clear` subject status blocks acceptance **before any transport**, returning `STALE_REVISION` / `adapter-state-blocked` with `transportInvoked: false`. Proven for each of the six blocking conditions; the scripted transport records **zero** invocations.
- **Post-response** — when Core returns `ACCEPTED` but the state changed during the round-trip, the second read blocks it: the outcome becomes `STALE_REVISION` / `adapter-state-blocked` (the reader is read **twice**). For a non-`ACCEPTED` outcome the post-response gate is skipped (the reader is read **once**).

This makes acceptance conditional on a stable conversation at both ends of the round-trip; a proposal accepted against a stale conversation is impossible.

## Transport-at-most-once and fail-closed (§A, §F)

- **Missing transport** → `CORE_UNAVAILABLE` / `adapter-transport-missing`, `transportInvoked: false`.
- **Transport exception/timeout** → normalized to `CORE_UNAVAILABLE` / `adapter-transport-error`; the raw error is caught and **never** escapes (the thrown message is proven absent from the serialized result), and the transport was invoked exactly once.
- **Malformed / mismatched response** → `CORE_UNAVAILABLE` with `adapter-response-invalid` / `adapter-identity-mismatch`.

The transport is invoked **at most once per decision**; the adapter **never auto-retries**.

## Retry classification — information only (§J)

`isRetryable(reason)` is a **pure classifier** returning `true` only for `core-unavailable`, `core-retry-later`, `adapter-transport-missing`, and `adapter-transport-error`; it returns `false` for `core-rejected`, `core-human-review`, `core-stale-revision`, `adapter-state-blocked`, `adapter-response-invalid`, and `adapter-identity-mismatch`. Every closed reason is asserted. This is **advisory** for a caller — the adapter itself performs no retry.

## Content-free observability (§K)

`CoreAdapterEvent` is a **closed-type** record carrying only safe ids, revisions, protocol references, the outcome, and a content-free reason. Events are proven to contain **no** message/reply body, subject reference, PII, secret, raw error, or chain-of-thought (a `SECRET-REPLY-BODY` reply is never present in emitted events). The default hook is a **silent no-op**; a completed acceptance emits only closed event types ending in `completed`, and a gate refusal emits `response-refused` (never `completed`, never `transport-requested`).

## Authority (§L)

`ACCEPTED` originates **solely** from a validated Core response with the exact identity and unchanged state — the adapter never fabricates it and **never upgrades** a `REJECTED` or `HUMAN_REVIEW_REQUIRED`. The adapter object exposes **only** `decide` and `decideDetailed`; it has **no** `send`, `deliver`, `execute`, `persist`, `callN8n`, or `authorize` method, and it is frozen. **QuickFurno Core remains the only business authority**; `ACCEPTED` is an approved proposal only — never sent, delivered, executed, or persisted.
