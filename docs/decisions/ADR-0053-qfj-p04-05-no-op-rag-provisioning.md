# ADR-0053 — QFJ-P04.05 No-Op RAG Provisioning

**Status:** Accepted (2026-07-25) — QFJ-P04.05
**Deciders:** Owner
**Phase:** QFJ-P04.05 — No-Op RAG Provisioning (planned RAG provisioning, disabled by default)

**Relates to:** [ADR-0052](./ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md) (evaluation evidence) · [ADR-0051](./ADR-0051-qfj-p04-03-governed-knowledge-system.md) (governed knowledge) · [ADR-0050](./ADR-0050-qfj-p04-02-model-capability-registry.md) · [ADR-0049](./ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · design docs [governed-knowledge-and-capabilities.md](../architecture/governed-knowledge-and-capabilities.md), [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)

**Design documents introduced:** [docs/reports/qfj-p04-05/](../reports/qfj-p04-05/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds one new provider-neutral package `@qf-jarvis/rag-provisioning`: a **RAG provisioning boundary that does NOT enable RAG**. There are exactly two modes — `DISABLED` and `PROVISIONED_NO_OP` — and **no** `ENABLED`/`ACTIVE` mode and **no** `enabled=true`. Every invocation returns an immutable, content-free **NO_OP** result with **zero** retrieval/embedding/vector/augmentation counters. **No embeddings, vector database, semantic search, chunking, indexing, retrieval, augmentation, external service, network, or side effect; no database/schema/migration (0008 absent); no live model call, key, token, or provider activation.** QuickFurno Core remains authority; governed knowledge (QFJ-P04.03) remains exact, deterministic evidence. The `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

The roadmap holds RAG **disabled/no-op until evaluation evidence justifies it** ([governed-knowledge-and-capabilities.md](../architecture/governed-knowledge-and-capabilities.md): "Do not commit to a vector database because retrieval exists"). QFJ-P04.03 delivered deterministic bounded retrieval; QFJ-P04.04 owns the evaluation evidence that would justify semantic retrieval. QFJ-P04.05 provides the **provisioning boundary** for a future RAG capability **without turning any of it on**: a place where a future-facing profile is validated and an explicit no-op is returned, so the shape exists and is testable and observable while remaining inert and safe.

## Decision

### A. Purpose

Provide a provider-neutral **RAG provisioning boundary without enabling RAG**. The disabled state is explicit, testable, observable, and safe. Any future extension happens **only** after evaluation evidence and explicit owner approval, under a superseding ADR. Core remains the authority; governed knowledge remains exact deterministic evidence.

### B. Modes

Closed modes only: `DISABLED`, `PROVISIONED_NO_OP`. There is **no** `ENABLED` or `ACTIVE` mode and **no** boolean `enabled=true`.

- **DISABLED** — no retriever, retrieval, embedding, vector query, prompt augmentation, chunking, indexing, network, or side effect.
- **PROVISIONED_NO_OP** — validates future-facing metadata and returns an explicit no-op; still **no** retriever, retrieval, embedding, vector query, augmentation, chunking, indexing, network, or side effect.

### C. Default

Absent config = `DISABLED`. Malformed/unknown config = disabled / **fails closed**. There is **no** environment-only hidden enablement, **no** auto-activation, **no** provider self-enablement, and **no** dynamic optimizer.

### D. Exact profile identity

A provisioning profile binds exact: profile id/version, mode, backend kind, governed-knowledge revision, capability reference, evaluation evidence reference, policy revision, config digest, and a canonical created-at instant. **No wildcard/`latest`, no endpoint, no secret/key/token, no provider SDK object, and no arbitrary metadata.**

### E. Backend kind

Closed placeholders only: `NONE`, `FUTURE_LOCAL_VECTOR`, `FUTURE_MANAGED_VECTOR`. There is **no** backend adapter. `NONE` is the **only** runtime-eligible value; the future values remain no-op / refused and contact nothing.

### F. Future enablement preconditions — DOCUMENT ONLY

Enabling RAG later requires (documented, none performed here): a superseding ADR; explicit owner approval; QFJ-P04.04 semantic-retrieval **research** evidence; exact model/prompt/capability/knowledge binding; privacy/tombstone proof; citation/freshness/conflict evaluation; tenant/data-class isolation; cost/latency/availability evaluation; a rollback/kill switch; and separate DB/migration/deployment authorization where applicable.

### G. Result

Every invocation returns an immutable, **content-free** `NO_OP` result with profile id/version, mode, a safe reason, and exact zero counters: `retrievalCount = 0`, `embeddingCount = 0`, `vectorQueryCount = 0`, `augmentedCharacterCount = 0`. It carries **no** content, citation, prompt, or provider output.

### H. Safe reasons

Closed: `rag-disabled`, `rag-provisioned-no-op`, `rag-profile-invalid`, `rag-profile-missing`, `rag-evaluation-reference-missing`, `rag-capability-reference-missing`, `rag-knowledge-revision-missing`, `rag-backend-not-runtime-eligible`, `rag-invariant`.

### I. Approval boundary

QFJ-P04.02 capability, QFJ-P04.03 knowledge, QFJ-P04.04 evidence, and QFJ-P04.01E rollout approval **never** enable RAG. Synthetic evaluation evidence is **not** production approval. There is no rollout/provider mutation.

### J. Privacy

**No** content, subject identifier, tenant content, PII, secret, prompt, or message enters the package. Future enablement must preserve `HOSTED_ALLOWED`/`LOCAL_ONLY`/`HUMAN_ONLY`.

### K. Authority

Provisioning authorizes and executes nothing; there is no retrieval tool and no provider/n8n call. Core is final authority; Riya client-only; Anisha vendor-only; Jarvis coordinates. The Jarvis Conversation Operations Center remains a mandatory later phase, absent here. Kimi is excluded.

### L. Non-goals

No embeddings, vector DB, semantic search, chunking, indexing, retrieval, augmentation, external service, DB/schema/migration 0008, live model, agents, memory, WhatsApp, dashboard, n8n, tools, or deployment.

## Rejected alternatives

- **An `ENABLED`/`ACTIVE` mode or `enabled=true` flag now.** Rejected — RAG stays off until evaluation evidence and owner approval justify it under a superseding ADR; only `DISABLED`/`PROVISIONED_NO_OP` exist.
- **Ship a stub retriever / vector-client seam.** Rejected — no retriever, embedding, vector, or network seam exists; every path is a content-free no-op with zero counters.
- **Treat a capability/knowledge/evaluation/rollout reference as enablement.** Rejected — a reference is future-facing metadata only; it never enables RAG, and synthetic evidence is not production approval.
- **Default-on or environment-driven enablement.** Rejected — absent/malformed config is `DISABLED`/fails closed; there is no hidden or auto enablement.

## Consequences

**Positive.** The provisioning shape exists, is validated, testable, and observable, and is provably inert — a future RAG capability has a safe, documented boundary to grow from, with every enablement precondition written down, and nothing is turned on.

**Negative — accepted.** The package does no retrieval and provides no value at runtime by design; it is a disabled boundary. Real RAG (embeddings/vector/semantic retrieval) is a later, separately authorized decision gated on QFJ-P04.04 evidence and a superseding ADR.

## Change-control rule

Adding a mode, a backend kind, a reason, or a result counter, changing the default, or introducing any retriever/embedding/vector/network/augmentation behaviour requires a superseding ADR plus the §F preconditions. No capability/knowledge/evaluation/rollout reference ever enables RAG on its own. The Conversation Operations Center is a separate, later, mandatory phase.
