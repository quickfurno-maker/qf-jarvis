# ADR-0056 — QFJ-M3 QuickFurno Core Decision Adapter Foundation

**Status:** Accepted (2026-07-25) — QFJ-M3 (a concrete `CoreDecisionPort` behind an injected transport; a PROPOSED integration contract pending Core-side adoption)
**Amended by [ADR-0096](./ADR-0096-rwc-p2d-core-authorized-web-reply-materialization.md) (RWC-P2D correction).** The wire contract described below binds proposal IDENTITY but not proposal CONTENT: `proposalId` and `idempotencyKey` both exclude model output, so a stale `ACCEPTED` for one body validated against a command carrying another. ADR-0096 adds a required `proposalDigest` to the command, the response schema and `validateResponse`, and advances `qfj.core.decision` from v1/`c0de0001` to **v2/`c0de0002`**. The protocol name, the idempotency-key semantics and every decision below are otherwise unchanged. Core-side adoption remains pending, as it already was.
**Deciders:** Owner
**Phase:** QFJ-M3 / MVP Runtime — QuickFurno Core Decision Adapter Foundation (the Jarvis→Core decision boundary of [QFJ-P05 Jarvis Orchestration](../architecture/qf-jarvis-roadmap-v3.md))

**Relates to:** [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) (M2 CoreDecisionPort) · [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0025](./ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Core boundary) · [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (idempotency) · [ADR-0001](./ADR-0001-source-of-truth-boundary.md) · design docs [quickfurno-core-adapter-design.md](../compatibility/quickfurno-core-adapter-design.md), [quickfurno-authority-matrix.md](../compatibility/quickfurno-authority-matrix.md), [system-boundary.md](../architecture/system-boundary.md)

**Design documents introduced:** [docs/reports/qfj-m3-core-decision-adapter/](../reports/qfj-m3-core-decision-adapter/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds one new package `@qf-jarvis/core-decision-adapter`: a concrete implementation of the M2 `CoreDecisionPort` that converts a revision-bound proposal into a **versioned Core command**, hands it to a **narrow injected transport**, and **strictly validates** the Core response — producing an `ACCEPTED` **only** when Core returns it against the exact command identity. **No live QuickFurno Core, network, HTTP, auth, or secret; no WhatsApp/n8n/send/transport implementation; no persistence/DB/schema/migration 0008; no live model; no RAG.** `ACCEPTED` means Core-approved proposal only — never sent, delivered, executed, or persisted. The adapter contains **no business decision rule** and cannot fabricate or upgrade an outcome. **This is a PROPOSED integration contract; later QuickFurno Core-side adoption is required.** The `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-M2 defined an injected `CoreDecisionPort` and proved that model output is a `PENDING_CORE_VALIDATION` proposal, that a missing port fails closed to `CORE_UNAVAILABLE`, and that agent-runtime cannot fabricate `ACCEPTED`. The natural next slice is the **concrete adapter** behind that port. The QuickFurno Core adapter baseline ([ADR-0025](./ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md), **Proposed**) establishes that Core owns authority, that a model "does not get to decide whether its own output is permissible", that execution intent is Core-generated (Jarvis "structurally cannot construct one"), and that an idempotency key deduplicates a resubmission. **No authoritative live Core decision protocol exists today** — so M3 defines a **provider-neutral, proposed** command/response protocol and an injected transport seam, with deterministic fakes only. Real Core-side adoption, transport, auth, and persistence are later, separately authorized slices.

## Decision

### A. Purpose

A concrete implementation behind the M2 `CoreDecisionPort`: convert a revision-bound proposal into a **versioned Core command**, obtain and **validate** the Core response, and return a closed outcome. **No delivery, execution, or persistence.** Core remains the only business authority.

### B. Package

`packages/core-decision-adapter/` (`@qf-jarvis/core-decision-adapter`). Dependency direction is **one-way**: the adapter depends on `@qf-jarvis/agent-runtime` stable contracts; there is **no** reverse dependency, no global singleton, no database, and no persistence.

### C. Exact protocol

A command/response binds exact identities: protocol name/version/contract-digest, command id, idempotency key, correlation/run id, proposal id/version, conversation id, expected revision, actor, party, proposal kind, structured intent, policy revision, exact model/prompt/capability/evaluation/knowledge references, and canonical timestamps. **No wildcard/`latest`, no arbitrary metadata.**

### D. Command

Immutable and bounded. A reply body is included **only** for a `REPLY` when Core validation needs it. It carries **never** chain-of-thought, a raw provider body/header, an SDK object, a secret, a callback, an n8n command, a delivery-state mutation, or a DB handle.

### E. Response

Closed outcomes: `ACCEPTED`, `REJECTED`, `HUMAN_REVIEW_REQUIRED`, `RETRY_LATER`, `STALE_REVISION`, `CORE_UNAVAILABLE`. It binds the command/idempotency/proposal/conversation/revision/protocol/decision identity and a canonical `decidedAt`. `ACCEPTED` means an **approved proposal only** — not sent, delivered, executed, or persisted.

### F. Injected transport

A narrow `CoreDecisionTransport` accepts a **validated serialized command** and returns a **validated serialized response**. It contains **no business logic, no hidden retry, and no live network implementation** — only a deterministic fake under `./testing`. A **missing transport → `CORE_UNAVAILABLE`**; an exception/timeout/protocol error is normalized to a safe fail-closed outcome, and **no raw error escapes**.

### G. Idempotency

The idempotency key is **deterministic** from the immutable exact command identity: the same identity yields the same key; a proposal/revision/protocol difference yields a different key. The response's key must match the command's **exactly**.

### H. Response validation

Fail closed on **any** command/idempotency/proposal/conversation/revision/protocol version/digest mismatch; an unknown outcome; a malformed reason; an invalid instant; or an `ACCEPTED` without the exact identity.

### I. Double state gate

Immediately **before** transport and again **after** the response, re-check revision, human takeover, AI pause, cancellation, assignment/party, and privacy/tombstone via an injected content-free state reader. Any change prevents `ACCEPTED` and yields `STALE_REVISION` or a safe refusal.

### J. Retry classification

Retryable: `CORE_UNAVAILABLE`, `RETRY_LATER`, a bounded timeout. Non-retryable: `REJECTED`, `HUMAN_REVIEW_REQUIRED`, `STALE_REVISION`, a protocol mismatch. **No automatic retries/backoff/queue** — classification is information only.

### K. Observability

Content-free events only: `command-created`, `transport-requested`, `response-received`, `response-refused`, `completed`. Allowed fields: safe ids, revisions, outcome/reason, protocol references, and timestamps. **Never** inbound/reply content, a prompt, a subject reference, PII, a secret, a raw error, or chain-of-thought.

### L. Authority / non-goals

Only a Core response may produce `ACCEPTED`; the adapter cannot fabricate or upgrade an outcome and exposes no `send`/`deliver`/`execute`/`callN8n`. Non-goals: no live Core/HTTP/auth/secrets; no WhatsApp/n8n/send; no persistence/DB/migration 0008; no live model; no RAG; no dashboard; no deployment. Riya client-only, Anisha vendor-only, Jarvis coordinator; n8n execution-only; Kimi excluded; the Conversation Operations Center remains a mandatory later phase.

## Rejected alternatives

- **Let the adapter decide (fabricate/upgrade an outcome).** Rejected — only a Core response produces `ACCEPTED`; the adapter carries no business rule and normalizes transport failures to fail-closed outcomes.
- **Implement a live HTTP/Core transport now.** Rejected — the transport is an injected seam with a deterministic fake; no network, auth, or secret exists in this slice.
- **Skip strict response-identity validation.** Rejected — any command/idempotency/proposal/revision/protocol mismatch, or an `ACCEPTED` without exact identity, fails closed.
- **Automatic retry/backoff/queue.** Rejected — outcomes are classified for a future caller, but the adapter performs the transport at most once and never retries.

## Consequences

**Positive.** M2's `CoreDecisionPort` now has a concrete, strictly-validated, revision-bound, idempotent adapter with a clean injected-transport seam and a double state gate — so a later real Core transport drops in behind the port without changing the orchestrator, and `ACCEPTED` provably originates only from Core.

**Negative — accepted.** The transport is a deterministic fake and the protocol is **proposed**, pending QuickFurno Core-side adoption; nothing is sent, delivered, executed, or persisted, and no live Core call is made.

## Change-control rule

Adding a protocol field, an outcome, a retry class, or an event, or changing the idempotency/validation/state-gate rules, requires a superseding ADR **and** coordinated QuickFurno Core-side adoption of the protocol. The adapter never becomes a business authority, never fabricates or upgrades an outcome, and `ACCEPTED` never means sent/delivered/executed. The Conversation Operations Center is a separate, later, mandatory phase.
