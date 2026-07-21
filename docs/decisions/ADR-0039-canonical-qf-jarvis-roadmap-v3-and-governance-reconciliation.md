# ADR-0039 — Canonical QF Jarvis Roadmap v3.0 and Governance Reconciliation

**Status:** Accepted (2026-07-21, under the owner's standing governance authorization)
**Deciders:** Owner
**Phase:** QFJ-P00 — Governance and Delivery Control (documentation and governance only; no runtime capability)

**Relates to / reconciles:** [phased-roadmap.md](../architecture/phased-roadmap.md) (historical Phase 0–15 taxonomy, retained for traceability) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) (AI-runtime roadmap sequencing) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) (agent responsibility boundaries) · [ADR-0001](./ADR-0001-source-of-truth-boundary.md) (source-of-truth boundary) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) (recommend/authorize/execute) · [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md) (rebuild determinism) · [ADR-0034](./ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md)–[ADR-0038](./ADR-0038-stage-3-4-5a-projection-worker.md) (Stage 3.4 projection slices)

**New canonical documents introduced by this decision:**

- [docs/architecture/qf-jarvis-roadmap-v3.md](../architecture/qf-jarvis-roadmap-v3.md) — the canonical Roadmap v3.0 (QFJ-P00 … QFJ-P12).
- [docs/governance/agent-constitution.md](../governance/agent-constitution.md) — the Agent Constitution (Jarvis, Riya, Anisha).
- [docs/governance/authority-routing-data-access-matrix.md](../governance/authority-routing-data-access-matrix.md) — the authority, routing and data-access matrix.
- [docs/governance/migration-ledger.md](../governance/migration-ledger.md) — the authoritative migration ledger.

---

## Context

QF Jarvis has grown a long, correct, but _linearly numbered_ delivery history: Phases 0–15 with deep decimal stages (e.g. Stage 3.4.5B). That numbering is faithful to how the work happened, but it no longer reads as a stable **architecture**: the same identifier space is used for "which slice merged when" and for "what the permanent system is." Two problems follow.

1. **Taxonomy drift.** ADR-0028 already renumbered the former Phase 4 into 4.0/4.1/4.2/4.3 and inserted 8.5, 10.5 and 11A "without renumbering 5–15." Every future insertion risks another local renumber, and no single document states the permanent major-phase spine.
2. **Role ambiguity.** The historical roadmap splits vendor-side and customer-side work across several agents (Kabir, Riya, Anisha, Jitin) defined at different times. The owner has since fixed the **final** agent taxonomy: three governed agents — **Jarvis** (coordination), **Riya** (customer), **Anisha** (vendor) — with all other/future specialists deferred. In particular, Anisha's vendor ownership is the **complete** routine vendor lifecycle (acquisition → onboarding → query resolution → renewal/resale → retention/reactivation), not merely promotion or onboarding.

At the same time, the projection backbone reached a real milestone: historical **Stage 3.4.5B — Production Projection Activation** merged to `main` via **PR #24** (merge commit `01b164b40d9d34d32b9233e97c4d75ce946121ee`, parents `9d271bb…` and `a4fa500…`). The next unit of work — historical **Stage 3.5 → canonical QFJ-P03.07 Projection Failure Operations** — has **not** begun.

This ADR does not implement anything. It **locks the canonical taxonomy, the agent authority model, and the migration-allocation rule** so that all future work extends a stable spine instead of renumbering a moving one.

## Problems being resolved

- No single canonical major-phase taxonomy; ADR-0028's local renumber left the spine implicit.
- Historical stage identifiers (Stage 3.4.x, 3.5, 3.6, 4.0–4.3) are used as both history and architecture.
- Agent ownership was defined incrementally and could be read as narrowing Anisha to promotion/onboarding, or as leaking vendor work to Riya or business authority to Jarvis.
- Migration numbering was at risk of being _reserved by roadmap prose_ (e.g. "RAG migration 0006"), which no roadmap is allowed to do.
- No authoritative, checksum-backed migration ledger existed.
- No consolidated fail-closed / sales-ethics statement bound all three agents.

## Decision

### 1. Canonical architecture boundary (permanent)

- **QuickFurno Core** owns authoritative business data (customers, leads, vendors, packages, pricing, payments, consent, assignments, outcomes), authorizes sensitive and commercial actions, and remains the final business authority. Jarvis must never replace, duplicate, or bypass it.
- **Jarvis** analyzes, recommends, classifies, routes, coordinates, evaluates, monitors, manages complex cases, requests approvals, and preserves conflicts. Jarvis does **not** independently authorize sensitive business actions, directly mutate QuickFurno marketplace tables, or directly call providers.
- **Riya — Customer Conversation and Qualification Agent** owns the complete routine customer side. **Anisha — Vendor Sales, Relationship and Success Agent** owns the complete routine vendor side (see §4).
- **n8n** executes only approved intents; it decides no business policy, authorizes nothing, and is never the source of truth. **Providers** deliver approved external actions, decide nothing, and return outcomes for reconciliation.
- **Permanent flow:** QuickFurno Core → signed events/contracts → Jarvis → recommendation/task/approval request → QuickFurno Core or human authorization → n8n execution → provider delivery → result to QuickFurno Core → result event to Jarvis.

### 2. Canonical QFJ-P00 … QFJ-P12 taxonomy

The permanent major-phase spine is:

| ID          | Name                                               |
| ----------- | -------------------------------------------------- |
| **QFJ-P00** | Governance and Delivery Control                    |
| **QFJ-P01** | Contracts, Identity and Trust Boundary             |
| **QFJ-P02** | Event Ingestion and Durable Storage                |
| **QFJ-P03** | Projections, Recovery and Operational Integrity    |
| **QFJ-P04** | Model Gateway, Knowledge and Evaluation Foundation |
| **QFJ-P05** | Jarvis Orchestration, Tasks and Cases              |
| **QFJ-P06** | Riya Customer Journey                              |
| **QFJ-P07** | Anisha Vendor Journey                              |
| **QFJ-P08** | Consent, Approval and Human Control                |
| **QFJ-P09** | Execution Gateway and Communication Lifecycle      |
| **QFJ-P10** | QuickFurno Core Integration and Reconciliation     |
| **QFJ-P11** | Pilot, Resilience and Scale                        |
| **QFJ-P12** | Advanced Intelligence and Future Agents            |

Canonical subphases are enumerated in [qf-jarvis-roadmap-v3.md](../architecture/qf-jarvis-roadmap-v3.md) (QFJ-P03.01–.10, QFJ-P04.01–.05, QFJ-P05.01–.06, QFJ-P07.01–.05).

### 3. Historical-stage mapping (traceability preserved)

| Historical                                    | Canonical                                                    |
| --------------------------------------------- | ------------------------------------------------------------ |
| Stage 3.4.1 projection foundation             | QFJ-P03.01 / QFJ-P03.02                                      |
| Stage 3.4.2 projection registry               | QFJ-P03.04                                                   |
| Stage 3.4.3 projection ordering repair        | QFJ-P03.03                                                   |
| Stage 3.4.4 projection runner                 | QFJ-P03.05                                                   |
| Stage 3.4.5A projection worker                | supporting work within QFJ-P03.05 / QFJ-P03.06               |
| Stage 3.4.5B production projection activation | **QFJ-P03.06 Production Projection Activation**              |
| Stage 3.4.5C (broad rebuild proposal)         | absorbed into QFJ-P03.08                                     |
| Stage 3.5                                     | QFJ-P03.07 Projection Failure Operations                     |
| Stage 3.6 rebuild and erasure                 | QFJ-P03.08                                                   |
| deferred `rm_subject_activity`                | QFJ-P03.09                                                   |
| Model Gateway Stage 4.0                       | QFJ-P04.01                                                   |
| Knowledge System Stage 4.1                    | QFJ-P04.03                                                   |
| Evaluation Stage 4.2                          | QFJ-P04.04                                                   |
| Jarvis Coordinator Stage 4.3                  | QFJ-P05                                                      |
| Riya phase                                    | QFJ-P06                                                      |
| Anisha phase                                  | QFJ-P07                                                      |
| future specialist agents (Kabir, Jitin, …)    | QFJ-P12 (PLANNED/DISABLED unless explicitly activated later) |

Git history, historical commits/PRs, and historical ADR bodies are **not** rewritten. Historical terminology may remain where needed for traceability, but every **current active** roadmap document must identify the canonical QFJ replacement.

### 4. Agent Constitution authority (final)

- **Riya** owns the complete routine customer side (first contact, education, need analysis, requirement collection, qualification, follow-ups, appointment assistance, routine queries, complaint intake, satisfaction checks, human handoff). Riya does **not** own any vendor work.
- **Anisha** owns the complete routine vendor side for first-time prospects and existing/active/expired/dormant vendors: first contact, qualification, business understanding, approved-package pitch and recommendation, new sales, follow-ups (including no-response), objection handling, conversion, payment follow-up, onboarding, profile/portfolio/verification guidance, routine query resolution, vendor education, lead-response guidance, relationship management, satisfaction, renewal, resale, upsell, cross-sell, retention, expired-vendor recovery, dormant-vendor reactivation, complaint intake, and communicating final resolutions. Anisha's business objective is honest conversion + complete onboarding + routine query resolution + satisfaction + renewal + resale + retention + long-term QuickFurno relationship. Anisha handles routine, approved matters herself; complex/disputed/sensitive/financial/legal/fraud/high-risk/policy-exception matters escalate to Jarvis, which coordinates with Core or an authorized human — and after resolution Anisha remains the vendor relationship owner and communicates the outcome.
- **Jarvis** coordinates complex and cross-agent cases; it does not conclude business authority.
- The full role definitions, allowed/forbidden actions, sales ethics, fail-closed behaviour, and universal task/case field reservations live in [agent-constitution.md](../governance/agent-constitution.md).

### 5. Migration-allocation rule (permanent)

**Roadmap text alone cannot authorize or allocate a migration number.** The next migration number may be used only when (1) the owning phase design is approved, (2) schema change is proven necessary, (3) exact scope is reviewed, (4) prior migration inventory is confirmed, (5) managed rollout impact is documented, and (6) migration creation is separately authorized.

- Migrations **0001–0005** exist and are **immutable** (see [migration-ledger.md](../governance/migration-ledger.md) for exact filenames and SHA-256 checksums).
- Managed PostgreSQL currently carries **0001 only**; **0002–0005 remain unapplied** to managed PostgreSQL unless a separately authorized managed-readiness task applies them.
- **Migration 0006 does not exist and is not created here.** It is _conditionally reserved_ for **QFJ-P03.07 Projection Failure Operations** — and only if the approved QFJ-P03.07 design proves schema is required. It must not contain RAG, agents, task runtime, model gateway, WhatsApp, n8n, QuickFurno Core integration, or `rm_subject_activity` (unless a later explicit architectural decision changes ownership).
- **The RAG migration is unallocated.** No migration number is pre-reserved for RAG. No migration after 0006 is pre-reserved.

### 6. RAG and structured-data boundary

RAG remains future work, lives only inside the Jarvis monorepo (never merged into the QuickFurno marketplace codebase), and obtains QuickFurno data only through defined contracts. Planned vector store: Supabase PostgreSQL with pgvector (no separate vector database). Planned agent namespaces: `JARVIS`, `RIYA`, `ANISHA`. Structured operational data stays outside RAG. Source priority: (1) live structured QuickFurno data, (2) approved business rules/policies, (3) agent-specific RAG, (4) general model knowledge. RAG never overrides consent, opt-out, price, entitlement, payment state, verification state, booking state, availability, allocation, active offers, or any live operational fact, and retrieved content is untrusted reference material that can never modify authority, authorize a tool, bypass consent, change a price, cross namespaces, request secrets, or approve payment/refund.

### 7. Superseded and retained decisions

- **Superseded (taxonomy only):** the _major-phase numbering_ view of [phased-roadmap.md](../architecture/phased-roadmap.md) and the _phase-renumbering_ decision of [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) are superseded, for **naming**, by the QFJ-P00…P12 taxonomy. Their **content, sequencing rationale, and controls remain valid** and are re-expressed under canonical IDs.
- **Retained historical:** all historical ADR bodies (ADR-0001…ADR-0038), the historical stage tables, and prior PR/stage references remain unchanged for traceability. This ADR does **not** alter any prior ADR body.

## Consequences

**Positive.** One canonical taxonomy; a stable spine that future work extends rather than renumbers; an unambiguous, final agent authority model; a checksum-backed migration ledger; and a single fail-closed / sales-ethics statement. Historical traceability is preserved end-to-end.

**Migration consequences.** No migration is created, modified, or applied. Managed PostgreSQL remains 0001-only. 0006 stays absent and only conditionally reserved. RAG stays unallocated.

**Delivery consequences.** This is documentation and governance only. No runtime capability, no source/test/package/lockfile change, no deployment, no external-system access. QFJ-P03.07 is **next** and is **not started** by this decision.

## Change-control rule

- **Future requirements extend this roadmap by default.** New work is added under the existing canonical IDs.
- **Existing roles and authority do not change silently.** Riya stays customer-side, Anisha stays the complete vendor-side owner, Jarvis stays coordination-only, Core stays the business authority.
- **Changing a major phase ID, an authority boundary, migration ownership, or agent ownership requires an explicit superseding ADR** — it cannot be done by editing a roadmap paragraph.
- **Operational status may advance without replacing the architecture** — a stage completing or a migration being applied updates status documents; it does not require a new superseding ADR.
