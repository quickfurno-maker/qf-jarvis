# Report 05 — Live Core Transport / Auth / Persistence Deferral and Next Slice

**Slice:** QFJ-M3. **ADR:** [ADR-0056](../../decisions/ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) (§ Non-goals, § Consequences).

## What is deliberately deferred

This slice is a **PROPOSED integration contract**. It implements the adapter shape, the versioned command, the strict response validation, the double state gate, and the idempotency/retry/observability semantics **against deterministic fakes only**. Explicitly **out of scope** and awaiting separate, owner-authorized slices:

1. **Core-side adoption of the protocol.** `DEFAULT_CORE_DECISION_PROTOCOL` (`qfj.core.decision` v1) is provider-neutral and **proposed**. QuickFurno Core must adopt and confirm the exact command/response protocol (name/version/contract-digest, field set, and canonicalization) before any live use. Until then the contract digest and version are placeholders subject to negotiation.
2. **A live transport.** No network, HTTP, socket, or webhook implementation exists. `CoreDecisionTransport` is an injected seam with fakes only; a real implementation (and its timeout/backpressure policy) is a later slice.
3. **Authentication and secrets.** No auth, token, key, signature, or secret handling. Request signing / mTLS / bearer credentials are deferred with the live transport.
4. **Persistence.** No DB, schema, or **migration 0008**; no idempotency-key store, no decision journal, no delivery-state. The idempotency key is computed deterministically but **not persisted** — deduplication of a real resubmission requires a Core-side or store-backed ledger, which is a later slice.
5. **Delivery / execution.** `ACCEPTED` is an approved proposal only. Sending, delivering, executing, n8n orchestration, and WhatsApp transport remain **out of scope** and are Core/n8n responsibilities, never Jarvis's.
6. **Live model, RAG, dashboard, deployment.** Unchanged from M1/M2 — none are touched.

## Why this ordering is safe

The adapter **cannot** fabricate or upgrade an outcome, **cannot** accept against a stale conversation, and **exposes no send/execute/persist surface** — so shipping the contract foundation before Core adoption introduces **no** live authority, transport, or data risk. Every acceptance path terminates in "approved proposal", never in an action.

## Suggested next launch slice

**QFJ-M4 — Core proposal-validation submission seam (still no live network).** Wire the M2 orchestrator's `CoreDecisionPort` injection point to `createCoreDecisionAdapter` behind a still-injected transport, and add an **idempotency-ledger port** (injected, in-memory fake) so a resubmission at the same identity is proven deduplicated — keeping live Core, auth, and persistence deferred. This advances the QFJ-P05 Jarvis→Core boundary one composed step without crossing any not-authorized line.

## Standing constraints (unchanged)

Riya client-only; Anisha vendor-only; Jarvis coordinator; **QuickFurno Core** is the final business authority and system of record; n8n is transport/execution only and decides no business rule; models/providers/evaluators/retrievers authorize and execute nothing; Kimi / Kimi K3 excluded. The **Conversation Operations Center** remains mandatory for a later slice and is **not** implemented here (no dashboard, WhatsApp, persistence, or n8n). Managed database/live lanes remain paused.
