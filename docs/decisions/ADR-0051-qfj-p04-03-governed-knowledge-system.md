# ADR-0051 — QFJ-P04.03 Governed Knowledge System

**Status:** Accepted (2026-07-25) — QFJ-P04.03
**Deciders:** Owner
**Phase:** QFJ-P04.03 — Governed Knowledge System (Stage 4.1, knowledge)

**Relates to:** [ADR-0050](./ADR-0050-qfj-p04-02-model-capability-registry.md) (capability registry) · [ADR-0049](./ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (data-class routing) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) (knowledge sequencing) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) (knowledge ≠ memory) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) · design docs [governed-knowledge-and-capabilities.md](../architecture/governed-knowledge-and-capabilities.md), [data-ownership.md](../architecture/data-ownership.md), [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)

**Design documents introduced:** [docs/reports/qfj-p04-03/](../reports/qfj-p04-03/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds one new provider-neutral package `@qf-jarvis/governed-knowledge`: an **immutable, deterministic governed-knowledge lifecycle + registry + bounded exact retrieval** that a future agent may consult to retrieve and **cite approved knowledge as evidence**. Knowledge is **evidence, never business authority**; QuickFurno Core remains the authoritative system of record. **No database/persistence, no schema, no migration (0008 absent); no document upload/scanning; no vector database, embeddings, semantic search, or RAG; no live model call, no real key/token; no agent runtime, memory, WhatsApp, dashboard, or n8n.** Retrieval is exact and bounded, permission/privacy/data-class gated, and **fails closed**. The `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

The roadmap (QFJ-P04.03) and [governed-knowledge-and-capabilities.md](../architecture/governed-knowledge-and-capabilities.md) approve a **governed knowledge** foundation: reviewed, approved reference material an agent may retrieve and cite as **evidence** — kept strictly distinct from agent memory ([ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md)) and never a second operational truth ([data-ownership.md](../architecture/data-ownership.md)). The canonical guidance is explicit: retrieval is a capability, **not** a mandate for a vector database — the valid first implementation is **deterministic lookup and metadata filtering**; semantic/vector retrieval must be justified later by QFJ-P04.04 evaluation evidence, and disabled-by-default RAG provisioning is QFJ-P04.05. This slice builds that deterministic foundation only.

## Decision

### A. Purpose

Provide a governed, reviewable, **deterministic** knowledge lifecycle so future agents may **retrieve and cite** approved knowledge as evidence. Knowledge never becomes business authority or a second operational truth. **QuickFurno Core remains authoritative** for current leads, vendors, wallets, subscriptions, packages, consent, assignments, and policies. This slice ships no agent that consumes it.

### B. Package ownership

A **dedicated, provider-neutral** package/module, separate from `@qf-jarvis/model-gateway`, `@qf-jarvis/event-backbone`, agent memory, Core data, and n8n:

- `packages/governed-knowledge/` — `@qf-jarvis/governed-knowledge`.

There is **no global mutable singleton** and **no database or persistence** in this slice. The package depends only on `zod` (validation) and pure logic — no network, provider SDK, database, `process.env`, or filesystem I/O in production source.

### C. Knowledge lifecycle

A closed lifecycle:

```
UPLOADED → SCANNED → REVIEWED → APPROVED → ACTIVE → RETIRED
```

Rules: retrieval serves **ACTIVE only**; an ACTIVE record must also be **currently effective** (as-of `effectiveFrom`, before any `expiresAt`); **RETIRED** remains explainable/citable by exact ID/version through a separate audit lookup but is **never** returned as current knowledge; an invalid transition **fails closed**; there is **no silent deletion**, **no automatic approval or activation**. The lifecycle model is immutable/deterministic in this slice.

### D. Exact record identity

Each record is bound to: knowledge/document ID; a **positive integer version**; a logical **topic** key; a **content digest**; a **source reference** and **source revision**; a **source type**; an **owner**; **approvedBy**; **approvedAt**; **effectiveFrom**; optional **expiresAt**; **classification/data class**; **retrieval permissions**; optional **supersededBy** (exact ID/version); and provenance/citation metadata. **No wildcard or `latest`** authoritative identity; **no arbitrary metadata bag**; **no provider SDK object**; **no secret**.

### E. Source authority

A small **closed evidence hierarchy** (highest trust first): `CORE_PUBLISHED_REFERENCE`, `APPROVED_BUSINESS_RULE`, `APPROVED_INTERNAL_DOCUMENT`, `APPROVED_WEBSITE_CONTENT`, `APPROVED_EXTERNAL_REFERENCE`. Live structured Core state remains **above and outside** this package; even `CORE_PUBLISHED_REFERENCE` is a **governed snapshot/evidence** record, not live operational truth. General model knowledge is outside the governed registry and is the lowest-trust fallback — never a silent substitute for a governed record.

### F. Source types

A closed launch-focused set: `POLICY`, `PACKAGE_REFERENCE`, `PRODUCT_REFERENCE`, `WEBSITE_CONTENT`, `FAQ`, `PROCESS_GUIDE`, `TRAINING_REFERENCE`, `EXTERNAL_REFERENCE`.

### G. Freshness / supersession

`effectiveFrom` is required; `expiresAt` is **required for volatile source types** (`PACKAGE_REFERENCE`, `PRODUCT_REFERENCE`, `WEBSITE_CONTENT`). As-of retrieval excludes not-yet-effective, expired, retired, or superseded records. Overlapping **active** versions of the same logical topic at the same authority tier are **rejected / fail closed**. `supersededBy` must resolve to an **exact newer** record and must not form a cycle. Rollback is an **explicit** activation of a prior approved version through a new immutable registry revision — never a silent mutation.

### H. Deterministic retrieval only

The first slice supports **bounded exact retrieval**: by exact knowledge ID/version; by exact logical topic; by a bounded list of exact topics/IDs; and deterministic metadata filtering. There is **no free-text search, no semantic search, no embeddings, no vector database, no RAG, and no unrestricted "return any document."**

### I. Retrieval authorization

A request carries only **safe bounded metadata**: tenant scope; agent scope (`CLIENT`, `VENDOR`, `COORDINATION`, `SYSTEM`); task/purpose class; requested exact topics/IDs; request data class; as-of instant; maximum records; a maximum content characters/tokens estimate; and a required-citation flag. **Prompts/messages are never copied into the request.** Permissions enforce tenant/global scope, allowed agent scopes, allowed purpose/task classes, record classification, request data class, and the minimum-necessary result count/content. **Riya remains CLIENT-only, Anisha VENDOR-only, Jarvis COORDINATION** — no scope blurring.

### J. Privacy / erasure / tombstone

Record subject references are optional and exact. A **subject-linked** record requires an injected **privacy gate**; a missing gate for subject-linked content **fails closed**. Erased/anonymised/tombstoned/in-progress subjects are **not returned**; the privacy gate runs **before** content is exposed. A `HOSTED_ALLOWED` request can never receive `LOCAL_ONLY` or `HUMAN_ONLY` knowledge; `LOCAL_ONLY` never enters a hosted model context; `HUMAN_ONLY` is never returned to a model. **No Core erasure is implemented** in this slice — the gate is a provider-neutral boundary with a deterministic test implementation only.

### K. Conflict resolution

For a logical topic: (1) filter by lifecycle/effective/expiry/supersession; (2) filter by tenant/permission/privacy/data-class; (3) choose the highest permitted source-authority tier; (4) require exactly **one** unambiguous current record; (5) same-tier ambiguity/conflict **fails closed**; (6) absence **fails closed**; (7) never silently fall back to general model knowledge.

### L. Citation / provenance

Every returned record includes a **frozen citation**: knowledge/document ID; exact version; source reference; source revision; authority tier; `effectiveFrom`; optional `expiresAt`; content digest. **No result without a citation.** A retired historical lookup, exposed only through a separate audit API, still cites exact ID/version and never masquerades as current retrieval.

### M. Observability

A **content-free** injected hook emitting closed-reason events: `knowledge-served`, `knowledge-not-found`, `knowledge-not-active`, `knowledge-not-effective`, `knowledge-expired`, `knowledge-superseded`, `knowledge-permission-denied`, `knowledge-tenant-denied`, `knowledge-data-class-denied`, `knowledge-subject-erased`, `knowledge-privacy-gate-missing`, `knowledge-conflict`, `knowledge-limit-exceeded`, `knowledge-invariant`. Allowed fields: run/request ID, knowledge ID/version, topic, authority tier, classification, agent scope, safe reason, counts. It **never** emits document content, a prompt/message, a subject reference, PII, a secret/token, a raw error body, or chain-of-thought.

### N. Capability / evaluation boundary

The QFJ-P04.02 capability registry governs **model** technical eligibility; governed-knowledge retrieval is a **future bounded capability**, not model authority. QFJ-P04.04 owns evaluation/red-team evidence; QFJ-P04.05 owns disabled-by-default RAG provisioning. Registry presence or knowledge retrieval **never** activates a model or a rollout.

### O. Authority

Knowledge is **evidence only**; models/providers authorize and execute nothing; **QuickFurno Core is the final business authority**; n8n is execution-only. The **Jarvis Conversation Operations Center** remains a mandatory later phase (live/history visibility, assignment, delivery, escalation, follow-up, AI pause, human takeover; Core owns the authoritative conversation record; n8n transport-only) but is **absent here**. Kimi is excluded.

### P. Non-goals

No persistence/database/schema/migration 0008; no document upload/scanning runtime; no vector DB/embedding/semantic search/RAG; no live model integration; no agents/memory/WhatsApp/dashboard/n8n; no provider activation; no deployment.

## Rejected alternatives

- **Commit to a vector database / RAG because "retrieval" exists.** Rejected — canonical guidance requires deterministic lookup + metadata filtering first; vector retrieval must be justified by QFJ-P04.04 evidence, and RAG provisioning is the disabled-by-default QFJ-P04.05.
- **Treat retrieved knowledge as current business truth.** Rejected — knowledge is evidence; QuickFurno Core remains authoritative for live state.
- **Persist knowledge to managed Postgres in this slice (migration 0008).** Rejected — the foundation is immutable/in-memory and deterministic; any persistence is a later, separately authorized decision within the paused managed lane.
- **A single mutable, permission-free knowledge store / "return any document."** Rejected — open-ended retrieval is indistinguishable from a lack of a boundary; retrieval is scoped by classification and permissions and fails closed.
- **Fold knowledge into `@qf-jarvis/model-gateway` or agent memory.** Rejected — governed knowledge is a distinct concern with its own lifecycle and owner; it gets its own package.

## Consequences

**Positive.** A future agent can retrieve exact, version-bound, currently-effective, permitted knowledge and cite it as evidence, with privacy/data-class gates enforced before content is exposed and every failure closing safely — without a database, a vector store, or any live model call.

**Negative — accepted.** The registry is populated from configured/declared records validated only against deterministic tests here; real evaluation evidence and approval come from QFJ-P04.04, no agent consumes it yet, and persistence is deferred. Retrieval is intentionally exact/bounded (no free-text or semantic search) until evaluation evidence justifies more.

## Change-control rule

Adding a lifecycle state, a source type or authority tier, a record field, a retrieval mode (in particular any free-text/semantic/vector retrieval), or changing the reason vocabulary or the authorization/privacy model requires a superseding ADR. Governed knowledge never becomes business authority, never substitutes for QuickFurno Core's live state, and never fabricates QFJ-P04.04 evaluation approval. The Conversation Operations Center is a separate, later, mandatory phase.
