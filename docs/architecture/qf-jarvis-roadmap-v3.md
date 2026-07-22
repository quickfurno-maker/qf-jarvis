# QF Jarvis — Canonical Roadmap v3.0

**Document status:** Canonical and authoritative for the QF Jarvis major-phase taxonomy, agent authority, and migration-allocation policy. Adopted 2026-07-21 under [ADR-0039](../decisions/ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md). This document supersedes, **for naming and taxonomy**, the major-phase numbering of [phased-roadmap.md](./phased-roadmap.md) and the phase-renumbering of [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md); their content, controls, and sequencing rationale remain valid and are re-expressed here under canonical QFJ-P** IDs.

> **This is architecture, not implementation status.** A phase appearing here is *planned*, not *built*. Current build status is in [§ Current repository status](#current-repository-status). Approval of the taxonomy is not authorization to implement any phase.

> **⚑ Delivery overlay (2026-07-22, [ADR-0042](../decisions/ADR-0042-mvp-and-post-mvp-delivery-overlay-and-controlled-launch-sequencing.md)).** A **product-delivery overlay** divides the complete product into **PHASE 1 — MVP LAUNCH** and **PHASE 2 — POST-MVP EXPANSION**. These are delivery phases, **not** QFJ phases: they add **no** major phase and renumber **nothing**; every capability keeps its canonical QFJ owner. See [qf-jarvis-mvp-post-mvp-delivery-overlay.md](./qf-jarvis-mvp-post-mvp-delivery-overlay.md), [mvp-capability-activation-matrix.md](../governance/mvp-capability-activation-matrix.md), [mvp-launch-readiness-runbook.md](../operations/mvp-launch-readiness-runbook.md). MVP has business priority; advanced marketing/automation and local/hybrid activation are Post-MVP (deferred, not cancelled). **Migration 0006 remains absent and owned only by QFJ-P03.07C; the overlay authorizes no migration.** QFJ-P03.07 remains the active technical priority.

---

## Canonical authority (permanent)

- **QuickFurno Core** owns authoritative business data — customers, leads, vendors, packages, pricing, payments, consent, assignments, and business outcomes. It authorizes sensitive and commercial actions and remains the **final business authority**. Jarvis must never replace, duplicate, or bypass it.
- **Jarvis** analyzes, recommends, classifies, routes, coordinates, evaluates, monitors, manages complex cases, requests approvals, and preserves conflicts. It does **not** independently authorize sensitive business actions, directly mutate QuickFurno marketplace tables, or directly call providers.
- **Riya — Customer Conversation and Qualification Agent** owns the complete routine customer side.
- **Anisha — Vendor Sales, Relationship and Success Agent** owns the complete routine vendor side.
- **n8n** executes only approved intents; it authorizes nothing and is never the source of truth.
- **Providers** deliver approved external actions, decide nothing, and return outcomes for reconciliation.

**Permanent flow:** QuickFurno Core → signed events/contracts → Jarvis → recommendation / task / approval request → QuickFurno Core or human authorization → n8n execution → provider delivery → result returned to QuickFurno Core → result event returned to Jarvis.

Full agent definitions: [agent-constitution.md](../governance/agent-constitution.md). Authority per action: [authority-routing-data-access-matrix.md](../governance/authority-routing-data-access-matrix.md).

## Architectural principles

1. **A control appears in the phase that first depends on it, never later.** (Inherited from ADR-0028.)
2. **Fail closed.** No capability → no action. No consent → no outbound. No approval → no sensitive execution. Ambiguity → escalate. (See [§ Fail-closed rules](#fail-closed-rules).)
3. **Recommend / authorize / execute stays separated** ([ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md)). A request carries no authority.
4. **Roadmap prose cannot allocate a migration number.** (See [§ Migration decision](#migration-decision).)
5. **Retrieved content is untrusted reference material** — never authority.

---

## The canonical major-phase spine

```
QFJ-P00  Governance and Delivery Control
QFJ-P01  Contracts, Identity and Trust Boundary
QFJ-P02  Event Ingestion and Durable Storage
QFJ-P03  Projections, Recovery and Operational Integrity   ← current
QFJ-P04  Model Gateway, Knowledge and Evaluation Foundation
QFJ-P05  Jarvis Orchestration, Tasks and Cases
QFJ-P06  Riya Customer Journey
QFJ-P07  Anisha Vendor Journey
QFJ-P08  Consent, Approval and Human Control
QFJ-P09  Execution Gateway and Communication Lifecycle
QFJ-P10  QuickFurno Core Integration and Reconciliation
QFJ-P11  Pilot, Resilience and Scale
QFJ-P12  Advanced Intelligence and Future Agents
```

---

## QFJ-P00 — Governance and Delivery Control

**Purpose.** The permanent boundary, agent model, governance rules, change control, ADR discipline, and this roadmap. This phase is where the canonical taxonomy, the Agent Constitution, the authority matrix, and the migration ledger live.
**Historical aliases.** Historical Phase 0 (Charter and Architecture) and all governance ADRs.
**Dependencies.** None.
**Entry gate.** A repository baseline.
**Exit gate.** Canonical taxonomy, agent authority, and migration policy are documented, internally consistent, and owner-approved.
**Major exclusions.** No runtime capability.
**Status.** Active — reconciled and locked by ADR-0039.

## QFJ-P01 — Contracts, Identity and Trust Boundary

**Purpose.** Versioned canonical contracts (events, recommendation, approval request/decision, execution intent/result, communication lifecycle, assignment/reassignment, memory/learning, erasure, policy-version), the contract registry, fixtures, compatibility rules, identity, and the trust boundary.
**Historical aliases.** Historical Phase 2 (Contracts and Canonical Events); trust-boundary architecture.
**Dependencies.** QFJ-P00.
**Entry gate.** Governance locked.
**Exit gate.** Every contract versioned, registered, fixtured, and contract-tested; personal data minimized; erasure representable.
**Major exclusions.** No transport, no agents, no behaviour — shape, fixtures, tests only.
**Status.** Historically complete (Phase 2, 2026-07-12).

## QFJ-P02 — Event Ingestion and Durable Storage

**Purpose.** Signature verification, semantic-digest validation, atomic idempotent persistence, the immutable canonical event log, boundary audit tables, and the `createEventIngestor` composition.
**Historical aliases.** Historical Stage 3.0–3.3.5.
**Dependencies.** QFJ-P01.
**Entry gate.** Contracts complete and merged.
**Exit gate.** Idempotent ingestion proven by redelivery; conflicting duplicate fails closed and never overwrites; boundary audit tables append-only.
**Major exclusions.** No live endpoint, no live emitter, no external access.
**Status.** Historically complete (Stage 3.3, PR #18). Migrations 0002/0003 unapplied to managed PostgreSQL.

## QFJ-P03 — Projections, Recovery and Operational Integrity

**Purpose.** Durable, ordered, rebuildable read models with fail-closed recovery.

| Subphase | Name | Historical alias |
| --- | --- | --- |
| **QFJ-P03.01** | Projection Contracts | Stage 3.4.1 (foundation) |
| **QFJ-P03.02** | Projection Persistence Foundation | Stage 3.4.1 (foundation, migration 0004) |
| **QFJ-P03.03** | Commit-Ordered Positions | Stage 3.4.3 (ordering repair, migration 0005) |
| **QFJ-P03.04** | Projection Registry | Stage 3.4.2 |
| **QFJ-P03.05** | Projection Runner | Stage 3.4.4 (+ 3.4.5A worker) |
| **QFJ-P03.06** | Production Projection Activation | Stage 3.4.5B |
| **QFJ-P03.07** | Projection Failure Operations | Stage 3.5 (dead letters / replay / quarantine) |
| **QFJ-P03.08** | Rebuild Determinism and Erasure | Stage 3.4.5C rebuild proposal + Stage 3.6 |
| **QFJ-P03.09** | Subject Activity Projection | deferred `rm_subject_activity` |
| **QFJ-P03.10** | Operational Readiness and Exit Audit | Stage 3.7–3.9 |

**Dependencies.** QFJ-P02.
**Entry gate.** Durable storage complete.
**Exit gate.** Read models rebuildable to identical results; failure operations (dead-letter, replay, quarantine) visible and proven; managed-readiness and exit audit complete.
**Major exclusions.** No agent/domain-intelligence/authoritative-business projection during the metadata-proof subphases; `rm_subject_activity` deferred to QFJ-P03.09.
**Status.** QFJ-P03.06 merged via PR #24. QFJ-P03.07 **design (QFJ-P03.07A)** is merged — [ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md), [projection-failure-operations.md](./projection-failure-operations.md), [runbook](../operations/projection-failure-operations-runbook.md) — with schema verdict **SCHEMA_REQUIRED**. **QFJ-P03.07B (Failure Contracts and Error Taxonomy)** is merged: the closed five-category taxonomy, the explicit deterministic-handler-failure contract, and the absent-SQLSTATE → `UNKNOWN_UNCLASSIFIED_FAILURE` correction, with all runner invariants preserved and the package-root API at 39 symbols. **QFJ-P03.07C (Failure Persistence Foundation)** is implemented on its branch: **migration 0006** (`0006_projection_failure_operations.sql`) creates the failure aggregate, the append-only action/audit ledger, replay authorizations, and replay-attempt/lease evidence, with repository contracts and the fail-closed divergence detector; the production runner is **not** wired to the new persistence and replay is **not** implemented (QFJ-P03.07D–F). **Migration 0006 is created but not applied to managed PostgreSQL and not deployed; migration 0007 remains absent.** **QFJ-P03.07D** (retry-exhaustion integration) is next.

## QFJ-P04 — Model Gateway, Knowledge and Evaluation Foundation

**Purpose.** The single governed model gateway, the capability registry, governed knowledge (incl. future RAG), and the evaluation / red-team framework — before any agent exists to call a model.

| Subphase | Name | Historical alias |
| --- | --- | --- |
| **QFJ-P04.01** | Model Gateway | Stage 4.0 |
| **QFJ-P04.01A** | Provider-Neutral Contracts | (new, [ADR-0041](../decisions/ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md)) |
| **QFJ-P04.01B** | Groq Cloud Adapter | (new) |
| **QFJ-P04.01C** | Local OpenAI-Compatible Adapter | (new) |
| **QFJ-P04.01D** | Hybrid Routing and Failover | (new) |
| **QFJ-P04.01E** | Provider Operations and Governance | (new) |
| **QFJ-P04.02** | Capability Registry | Stage 4.1 (capabilities) |
| **QFJ-P04.03** | Governed Knowledge System | Stage 4.1 (knowledge) |
| **QFJ-P04.04** | Evaluation and Red-Team Framework (per-provider/per-model parity) | Stage 4.2 |
| **QFJ-P04.05** | No-Op RAG Provisioning | (new) planned RAG provisioning, disabled by default |

**Provider independence (QFJ-P04.01A–E).** The model gateway is **provider-neutral**: the conversation runtime depends only on a repository-owned `ModelProvider` interface, and a selected adapter (`GroqProvider`, `LocalOpenAICompatibleProvider`, `FakeModelProvider`, or a future approved adapter) implements it. Provider SDK objects never cross the adapter boundary; Riya, Anisha, the WhatsApp webhook, memory, queues, RAG, human handoff, and QuickFurno integration never import provider-specific types. Changing provider requires only configuration, adapter activation, a model identifier, and compatibility + evaluation approval — never an agent/transport rewrite. **Model providers perform bounded inference only; communication providers deliver approved messages only; neither provider class has QuickFurno business authority.** Hybrid fallback is **sequential, bounded, and idempotent** (one primary per turn, no model voting, at most one accepted response); routing enforces a request's data class (`HOSTED_ALLOWED` / `LOCAL_ONLY` / `HUMAN_ONLY`) and required capabilities before availability/cost/latency — a `LOCAL_ONLY` request never silently falls back to Groq. Full design: [model-provider-independence.md](./model-provider-independence.md).

**Evaluation parity (QFJ-P04.04).** Every provider **and** every model must pass the **same** evaluation, language (multilingual/Indian-market), authority, security, and failure tests before production use; one that has not passed cannot be activated.

**Dependencies.** QFJ-P03.
**Entry gate.** Projection integrity complete.
**Exit gate.** Every model call passes the gateway; budgets/kill-switch enforced; structured-output validation refuses malformed output; knowledge served only through its lifecycle; evaluation harness can fail an agent version **or a provider/model**; a provider swap requires only configuration + evaluation approval.
**Major exclusions.** No specialist agent; no consumer AI subscription as backend; no raw output auto-becoming training data; RAG remains disabled/no-op until evaluation evidence justifies it. **RAG migration remains unallocated. No provider adapter, SDK, key, or model call is implemented by the roadmap; provider selection never alters agent authority.**
**Status.** Planned (approved architecture, not implemented — ADR-0028, ADR-0041).

## QFJ-P05 — Jarvis Orchestration, Tasks and Cases

**Purpose.** The coordinator, the universal task contract, durable case management, routing/coordination, the recommendation runtime, and human escalation/SLA — built before specialists.

| Subphase | Name |
| --- | --- |
| **QFJ-P05.01** | Agent Registry |
| **QFJ-P05.02** | Universal Task Contract |
| **QFJ-P05.03** | Durable Case Management |
| **QFJ-P05.04** | Routing and Coordination |
| **QFJ-P05.05** | Recommendation Runtime |
| **QFJ-P05.06** | Human Escalation and SLA Runtime |

**Historical aliases.** Jarvis Coordinator Stage 4.3.
**Dependencies.** QFJ-P04.
**Entry gate.** Model/knowledge/evaluation foundation complete.
**Exit gate.** Events route to a placeholder-free registry with zero agents registered; task and case contracts durable; consolidation/prioritization/expiry tested.
**Major exclusions.** No specialist domain logic in Jarvis ([ADR-0006](../decisions/ADR-0006-agent-responsibility-boundaries.md)); no execution; no message sent.
**Status.** Planned.

## QFJ-P06 — Riya Customer Journey

**Purpose.** The complete routine customer side (see [agent-constitution.md](../governance/agent-constitution.md)): first contact, education, need analysis, requirement collection, qualification, follow-ups, appointment assistance, routine queries, complaint intake, satisfaction checks, human handoff — in shadow first.
**Historical aliases.** Historical Phase 6 (Riya, complete client journey).
**Dependencies.** QFJ-P05.
**Entry gate.** Orchestration complete.
**Exit gate.** Evidence-backed customer recommendations in shadow; a reassignment request without explicit client confirmation is impossible to construct.
**Major exclusions.** Riya never owns vendor work; never sends directly; never changes consent.
**Status.** Planned.

## QFJ-P07 — Anisha Vendor Journey

**Purpose.** The complete routine vendor side for first-time, existing, active, expired and dormant vendors.

| Subphase | Name |
| --- | --- |
| **QFJ-P07.01** | First-Time Vendor Acquisition |
| **QFJ-P07.02** | Vendor Onboarding and Activation |
| **QFJ-P07.03** | Existing-Vendor Sales |
| **QFJ-P07.04** | Vendor Query Resolution |
| **QFJ-P07.05** | Vendor Relationship and Satisfaction |

**Anisha owns** first contact, qualification, business understanding, personalized approved-package pitch and recommendation, new sales, follow-ups (incl. no-response), objection handling, conversion, payment follow-up, onboarding, profile/portfolio/verification guidance, routine query resolution, vendor education, lead-response guidance, relationship management, satisfaction, renewal, resale, upsell, cross-sell, retention, expired-vendor recovery, dormant-vendor reactivation, complaint intake, and communicating final resolutions. **Objective:** honest conversion + complete onboarding + routine query resolution + satisfaction + renewal + resale + retention + long-term QuickFurno relationship. Complex/disputed/sensitive/financial/legal/fraud/high-risk/policy-exception matters escalate to Jarvis; after resolution Anisha remains the relationship owner and communicates the outcome.
**Historical aliases.** Historical Phase 7 (Anisha, vendor intelligence) — **broadened** here to the full vendor lifecycle.
**Dependencies.** QFJ-P06.
**Entry gate.** Customer journey complete.
**Exit gate.** Evidence-backed vendor-lifecycle recommendations in shadow; every money-adjacent recommendation declares its required approval level; sales-ethics prohibitions enforced.
**Major exclusions.** No wallet/package/payment/entitlement mutation by any path; no binding commitments; no refund approval; no Core bypass.
**Status.** Planned.

## QFJ-P08 — Consent, Approval and Human Control

**Purpose.** Consent state, approval request/decision runtime, human control, opt-out enforcement, and the founder approval interface.
**Historical aliases.** Historical Phase 8 / 8.5 / 9 (identity, access, approval and policy).
**Dependencies.** QFJ-P05 (and specialists as they arrive).
**Entry/exit gates.** No outbound without valid consent; no sensitive execution without required approval; human control observable and auditable.
**Status.** Planned.

## QFJ-P09 — Execution Gateway and Communication Lifecycle

**Purpose.** The n8n bridge (test-only first), the 18-state communication lifecycle, and provider dispatch — proven against fixtures before anything is sent.
**Historical aliases.** Historical Phase 10 (n8n bridge, test-only) / 10.5 (production readiness).
**Dependencies.** QFJ-P08.
**Entry/exit gates.** Approved intents only; nothing reaches a real recipient until QFJ-P11; fail-closed on tool/provider failure; never claim success without a verified outcome.
**Status.** Planned.

## QFJ-P10 — QuickFurno Core Integration and Reconciliation

**Purpose.** The first live Core integration and the reconciliation of provider/Core outcomes back into the event stream.
**Historical aliases.** Historical Phase 11 (live Core integration).
**Dependencies.** QFJ-P09; the QuickFurno-side remediation track (historical Stage 3.1.3).
**Entry/exit gates.** Live Core emitter and authorization interface verified; outcomes reconciled to Core and Jarvis.
**Status.** Planned.

## QFJ-P11 — Pilot, Resilience and Scale

**Purpose.** The gated controlled-communication pilot (incl. multilingual safety gate), resilience, and scale.

| Subphase | Name |
| --- | --- |
| **QFJ-P11.06** | Inference Deployment Profiles ([ADR-0041](../decisions/ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md)) |

**Inference deployment profiles (QFJ-P11.06).** Owner-selected, configuration-only deployment profiles for the conversation runtime — no code rewrite to switch:

- `PROFILE_GROQ_CLOUD` — Groq only.
- `PROFILE_LOCAL_PC` — local-PC inference only.
- `PROFILE_HYBRID_LOCAL_PRIMARY` — local primary, explicit Groq fallback.
- `PROFILE_HYBRID_GROQ_PRIMARY` — Groq primary, explicit local fallback.
- `PROFILE_HUMAN_ONLY` — emergency human-only mode, always available.

Fallback is explicit; no unexpected provider fallback; the runtime never calls both providers per message; no fallback creates a duplicate outbound reply. Per-profile primary/fallback/failure/privacy/health/timeout/cost/capacity/handoff/rollback: [model-provider-independence.md](./model-provider-independence.md).
**Historical aliases.** Historical Phase 11A / 12–15.
**Dependencies.** QFJ-P10; QFJ-P04.01A–E and QFJ-P04.04 for provider readiness.
**Status.** Planned.

## QFJ-P12 — Advanced Intelligence and Future Agents

**Purpose.** Future specialist agents and advanced intelligence beyond the three governed agents; **advanced local-inference scaling** — multiple local inference nodes, multi-GPU operation, model optimization, local specialist models, future LoRA or fine-tuning, and Groq as a controlled fallback.
**Historical aliases.** Kabir (lead intelligence), Jitin (marketing), and any future specialist — all **PLANNED or DISABLED** unless explicitly activated by a later ADR.
**Dependencies.** QFJ-P05–P11 as applicable.
**Status.** Planned / disabled.

---

## Current repository status

- **QFJ-P03.06 (Production Projection Activation, historical Stage 3.4.5B) is merged and closed through PR #24**; merge commit `01b164b40d9d34d32b9233e97c4d75ce946121ee` (parents `9d271bb…`, `a4fa500…`).
- `main` is synchronized (local == `origin/main`).
- **QFJ-P03.07 (Projection Failure Operations, historical Stage 3.5) is in progress.** QFJ-P03.07A (design, [ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md), SCHEMA_REQUIRED), QFJ-P03.07B (failure contracts and taxonomy), **QFJ-P03.07C (Failure Persistence Foundation)**, **QFJ-P03.07D (Atomic Retry-Exhaustion Integration)**, and **QFJ-P03.07E (Failure Inspection and Quarantine Operations)** are merged and locked (QFJ-P03.07C via PR #30, merge commit `43137a551c70a09311fcd1815a7a1ce2718a12ba`; QFJ-P03.07D via PR #31, merge commit `8c040a9c82268af54665740985782cad9b2e0fef`; QFJ-P03.07E via PR #32, merge commit `ff70245ebfab9d0977f1dac8e7eed2c39693ba52`). **QFJ-P03.07F (Authorized Projection Replay Execution) is implemented on its branch:** an internal replay service adds the explicit, human-authorized, lease-protected, idempotent, one-shot replay path (authorize → execute → atomic success/failure, plus expired-lease takeover and reconciliation); replay success atomically applies the read model, resumes the checkpoint exactly one position, resolves the failure, and consumes the authorization; a replay failure never advances the checkpoint; there is no automatic scheduler or bulk replay. **QFJ-P03.07G (observability, runbook, exit audit) remains next.**
- **Migration 0006 exists** (`0006_projection_failure_operations.sql`), created by QFJ-P03.07C: the failure aggregate, append-only action ledger, replay authorizations, and replay-attempt/lease evidence. QFJ-P03.07D adds **no** new migration and does **not** modify 0006. It is **applied local/CI only**; managed PostgreSQL remains **migration 0001 only**; migrations **0002–0006 remain unapplied** to managed PostgreSQL and are **not deployed**. **Migration 0007 does not exist.**
- **QFJ-P03.08 (Rebuild Determinism and Erasure) has not begun.**
- **No RAG, agent, task runtime, model gateway, n8n, WhatsApp, or live QuickFurno Core integration is active.** The feature branch `stage-3.4.5b-projection-handlers` is absent locally and remotely.
- Package-root runtime surface of `@qf-jarvis/event-backbone` remains exactly **39** symbols.

**Immediate next slice:** QFJ-P03.07G — Observability, Runbook and Exit Audit (following the merged QFJ-P03.07A–E and the QFJ-P03.07F authorized-replay execution implemented on-branch). No MVP runtime (M1) has begun.

---

## Migration decision

Existing migrations **0001–0005** are immutable and unchanged byte-for-byte. Exact filenames and SHA-256 checksums: [migration-ledger.md](../governance/migration-ledger.md).

- Managed PostgreSQL carries **0001 only**; **0002–0005 are unapplied** managed unless a separately authorized managed-readiness task applies them.
- **Migration 0006 does not exist and is not created by any documentation task.** It is *conditionally reserved* for **QFJ-P03.07** and only if the approved QFJ-P03.07 design proves schema is required. If ever created it must not contain RAG, agents, task runtime, model gateway, WhatsApp, n8n, Core integration, or `rm_subject_activity` (absent a later explicit ownership decision).
- **The RAG migration is unallocated.** No migration after 0006 is pre-reserved.

**Permanent rule.** Roadmap text alone cannot authorize or allocate a migration number. A number may be used only when the owning phase design is approved, the schema change is proven necessary, the exact scope is reviewed, the prior inventory is confirmed, the managed rollout impact is documented, and creation is separately authorized.

## Agent ownership (summary)

- **Riya** — complete routine customer side. No vendor work.
- **Anisha** — complete routine vendor side (acquisition → onboarding → query resolution → renewal/resale → retention/reactivation). Escalates complex/sensitive/financial/legal/fraud matters to Jarvis; remains relationship owner afterward.
- **Jarvis** — coordination of complex and cross-agent cases; no business authority.
- Full detail and routing: [agent-constitution.md](../governance/agent-constitution.md), [authority-routing-data-access-matrix.md](../governance/authority-routing-data-access-matrix.md).

## RAG boundaries (summary)

RAG lives only in the Jarvis monorepo, uses Supabase pgvector (no separate vector DB), namespaces `JARVIS`/`RIYA`/`ANISHA`, keeps structured operational data outside RAG, follows the source-priority order (live structured data → business rules → agent RAG → general model knowledge), never overrides live operational facts or consent, and treats retrieved content as untrusted. Controlled structured vendor data given to Anisha never automatically becomes RAG knowledge, training data, long-term memory, or evaluation data.

## Core integration boundary (summary)

QuickFurno Core is the business authority. Jarvis never mutates marketplace tables, never calls providers directly, and never becomes a source of truth. Live Core integration is QFJ-P10; no live Core connection exists today.

## Change-control rule

Future requirements extend this roadmap by default. Existing roles and authority do not change silently. Changing a major phase ID, an authority boundary, migration ownership, or agent ownership requires an explicit superseding ADR. Operational status may advance (a stage completing, a migration applied) without replacing the architecture.

## Fail-closed rules

- No registered capability → no action.
- No valid consent → no outbound communication.
- No required approval → no sensitive execution.
- Ambiguous policy → escalate. System disagreement → escalate.
- Tool failure → fail closed. Provider failure → do not claim success.
- RAG text → never grants authority.
- Model confidence below threshold → escalate or use deterministic fallback.
- No verified outcome → do not mark a task successful.
