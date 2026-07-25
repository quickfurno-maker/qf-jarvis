# ADR-0055 — QFJ-M2 Core Decision and Reply Orchestration Foundation

**Status:** Accepted (2026-07-25) — QFJ-M2 (Core proposal validation + model reply composition, within [QFJ-P05 Jarvis Orchestration](../architecture/qf-jarvis-roadmap-v3.md))
**Deciders:** Owner
**Phase:** QFJ-M2 / MVP Runtime — Core Decision and Reply Orchestration Foundation

**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) (M1 runtime) · [ADR-0051](./ADR-0051-qfj-p04-03-governed-knowledge-system.md) (governed knowledge) · [ADR-0052](./ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md) (evaluation evidence) · [ADR-0053](./ADR-0053-qfj-p04-05-no-op-rag-provisioning.md) (RAG disabled) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (model gateway) · [ADR-0025](./ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Core boundary) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · design docs [agent-model.md](../architecture/agent-model.md), [communication-model.md](../architecture/communication-model.md), [system-boundary.md](../architecture/system-boundary.md)

**Design documents introduced:** [docs/reports/qfj-m2-core-decision-orchestration/](../reports/qfj-m2-core-decision-orchestration/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It extends `@qf-jarvis/agent-runtime` with an **orchestration** module that composes the M1 authority-first runtime with an **injected model reply port** and an **injected QuickFurno Core decision port**: it turns an inbound request into a bounded model **reply plan**, a validated structured **draft**, a `PENDING_CORE_VALIDATION` **proposal**, and a Core **decision** — and it **sends nothing**. Core is the only business authority; `ACCEPTED` means Core-approved, **never** sent/delivered/executed/persisted. **No real Core/WhatsApp/n8n/provider integration, no transport, no persistence, no database/migration 0008, no live model call, no semantic retrieval/RAG.** The `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-M1 gave the coordinator a deterministic, authority-first spine — assignment, conversation state, human takeover / AI pause, a privacy gate, and proposal-only decisions. The next narrow launch-critical slice (QFJ-P05 Jarvis Orchestration — Core proposal validation and model reply composition) composes that spine with **model planning** and **QuickFurno Core decision validation**, still **pre-transport and pre-persistence**. It converts model output into a bounded proposal (never an executable command) and produces a Core **decision record** that is still **not a delivery action**. Everything real — the Core adapter, the model provider, WhatsApp/n8n transport, persistence — is an injected port with a deterministic testing fake only.

## Decision

### A. Purpose

Compose the M1 runtime with model planning and QuickFurno Core decision validation **without sending messages**. Core remains the only business authority. Model output becomes a bounded **proposal**, never an executable command. The result is a Core **decision** that is still not a delivery action.

### B. Package ownership

Extend `@qf-jarvis/agent-runtime` with a dedicated `src/orchestration/` module (no new package needed — the M1 contracts are reused, not duplicated). No global mutable singleton; **no persistence/database**.

### C. Processing order

For every inbound request, in order — any failure prevents every later stage: (1) validate envelope; (2) read immutable context; (3) enforce human takeover / AI pause; (4) enforce assignment and agent scope; (5) enforce cancellation/revision freshness; (6) enforce privacy/erasure/tombstone; (7) determine data class and provider eligibility; (8) retrieve exact governed knowledge only when explicitly requested and permitted; (9) create a provider-neutral model request plan; (10) invoke the injected model reply port; (11) validate the structured reply draft; (12) create the `PENDING_CORE_VALIDATION` proposal; (13) invoke the injected Core decision port; (14) return an immutable orchestration result; (15) perform **no** transport or side effect.

### D. QuickFurno Core decision port

An **injected** interface owned by the integration boundary — **not** a fake business authority inside Jarvis. Input: proposal id/version, conversation id, expected conversation revision, assigned actor, party type, proposal kind, structured intent, safe policy/knowledge/evaluation references, and a bounded proposed reply body **only** when Core needs to validate it — **no raw provider object**. Closed outcomes: `ACCEPTED`, `REJECTED`, `HUMAN_REVIEW_REQUIRED`, `RETRY_LATER`, `STALE_REVISION`, `CORE_UNAVAILABLE`. Rules: **default/no port → `CORE_UNAVAILABLE`, fail closed**; the decision is immutable and revision-bound; `ACCEPTED` means Core-approved proposal **only** (not sent/delivered/executed/persisted); **agent-runtime cannot fabricate `ACCEPTED`**; the deterministic testing fake exists only under `./testing`.

### E. Model reply port

A **provider-neutral injected** interface compatible with model-gateway concepts. The plan carries: run id, assigned actor, party/data class, task class, a structured-output requirement, bounded normalized context references, optional exact knowledge citations — **no business authority, no transport callback**. The output is a structured reply draft with provider/release/model/prompt compatibility references and safe usage/trace ids — **no raw provider headers/body, no chain-of-thought**. **No real Groq/local call** in this slice; testing fake only.

### F. Knowledge boundary

Exact bounded QFJ-P04.03 retrieval only; **no free-text/semantic retrieval; RAG remains `DISABLED`/`NO_OP`**. Citations remain exact id/version/source/digest. Stale, expired, superseded, unauthorized, erased, or conflicting knowledge prevents use. A model draft cannot fabricate unverified citations.

### G. Evaluation boundary

A model release/prompt/capability may carry an exact QFJ-P04.04 `evaluationRef`; an absence/mismatch is handled per explicit policy. **Synthetic evaluation is not production approval**; evaluation never authorizes a business action; no rollout activation.

### H. Proposal contract

Closed proposal kinds: `REPLY`, `ESCALATE_TO_HUMAN`, `REQUEST_CLARIFICATION`, `NO_ACTION`. No business-mutation/tool-execution proposal (no execution path exists). Every proposal carries an exact id/version; conversation id and expected revision; assigned actor and party type; proposal kind; a bounded structured intent; an optional bounded reply draft; exact citations/references; a `PENDING_CORE_VALIDATION` status before Core; and **no** `send`/`execute`/`authorize`/`callN8n` method.

### I. Double gate

Immediately **before model invocation** and again **before the Core decision**, re-check: human takeover, AI pause, cancellation, conversation revision, privacy/erasure/tombstone, and assignment/scope. A state change after model drafting **invalidates** the proposal and prevents Core acceptance in this orchestration run.

### J. Content / privacy

Normalized inbound text may be passed **only** to the injected model port per data class and minimization policy. Message text, subject reference, prompt, and reply body are **never** placed in observability. `HUMAN_ONLY` never reaches a model; `LOCAL_ONLY` never reaches a hosted interface; subject-linked context needs the privacy gate **before** knowledge/model; there is no chain-of-thought storage or interface.

### K. Operations Center contract

Extend the content-free snapshot contract only as needed: proposal status, Core decision status, proposal created-at, decision created-at, last safe failure reason, awaiting-human-review, a retry-due placeholder — **no message body/prompt/subject/content**. The dashboard itself remains unimplemented.

### L. Observability

Closed safe events: `orchestration-started`, `model-plan-created`, `model-invocation-skipped`, `proposal-created`, `core-decision-requested`, `core-decision-received`, `orchestration-refused`, `orchestration-completed`. Allowed fields: run/conversation/proposal ids; actor/party/data class; proposal kind/status; Core decision outcome; a safe reason; release/prompt/evaluation/knowledge reference ids; counts/timestamps. **Never** inbound/reply content, a prompt, a subject reference, PII, a key/token, a raw provider/Core error, or chain-of-thought.

### M. Authority / transport

The Core decision is the final business decision in this slice; **no message is sent; no n8n call; no provider transport; no delivery-state mutation.** n8n later executes only a separately authorized delivery command. Models/agents/Jarvis authorize and execute nothing. The Conversation Operations Center remains a mandatory later phase. Kimi is excluded.

### N. Non-goals

No WhatsApp/provider webhook; no n8n; no sending; no persistence/DB/schema/migration 0008; no live model/provider/key/token; no semantic retrieval/RAG; no dashboard; no production Core adapter; no deployment.

## Rejected alternatives

- **Treat model output as the final answer / let the agent send.** Rejected — model output is a bounded proposal; only the injected QuickFurno Core decision port may `ACCEPT` it, and even `ACCEPTED` is not sent/delivered/executed.
- **Fake the Core decision inside Jarvis.** Rejected — the decision port is injected and owned by the integration boundary; a missing port fails closed to `CORE_UNAVAILABLE`, and agent-runtime cannot construct `ACCEPTED`.
- **Skip the second gate after drafting.** Rejected — a takeover/pause/cancellation/revision/privacy/scope change between drafting and Core invalidates the proposal (the double gate).
- **Call a real model / integrate transport now.** Rejected — the model and Core ports are injected with deterministic fakes; no live call, no n8n, no WhatsApp, no persistence in this slice.

## Consequences

**Positive.** The coordinator can plan a model reply, hold it as a revision-bound proposal, and obtain a Core decision — with Core as the only authority, the double gate protecting against stale state, and no message ever sent — giving a safe, testable seam for the later transport/persistence/Core-adapter slices.

**Negative — accepted.** Nothing is sent, delivered, executed, or persisted; the model and Core ports are deterministic fakes. Real Core validation, a real model call via the gateway, transport (WhatsApp via n8n), and persistence are later, separately authorized slices.

## Change-control rule

Adding a proposal kind, a Core outcome, a processing stage, or a port field, or changing the double-gate or the fail-closed defaults, requires a superseding ADR. Model output never becomes authority; `ACCEPTED` never means sent/delivered/executed; agent-runtime never fabricates a Core decision; Riya stays client-only and Anisha vendor-only; RAG stays disabled. The Conversation Operations Center is a separate, later, mandatory phase.
