# ADR-0052 — QFJ-P04.04 Evaluation and Red-Team Foundation

**Status:** Accepted (2026-07-25) — QFJ-P04.04
**Deciders:** Owner
**Phase:** QFJ-P04.04 — Evaluation and Red-Team Framework (per-provider/per-model parity, Stage 4.2)

**Relates to:** [ADR-0051](./ADR-0051-qfj-p04-03-governed-knowledge-system.md) (governed knowledge) · [ADR-0050](./ADR-0050-qfj-p04-02-model-capability-registry.md) (capability registry) · [ADR-0049](./ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md) (rollout approval / release refs) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · design docs [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md), [ai-evaluation-observability-and-data-quality.md](../architecture/ai-evaluation-observability-and-data-quality.md)

**Design documents introduced:** [docs/reports/qfj-p04-04/](../reports/qfj-p04-04/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds one new provider-neutral package `@qf-jarvis/model-evaluation`: a **version-bound, deterministic evaluation and red-team evidence** system that produces auditable evidence for later rollout approval. Evaluation evidence **informs** operations; it **does not activate or promote** a model. **No live Groq or local-model call, no real key/token, no LLM-as-judge, no model voting, no real conversation data; no database/persistence, no schema, no migration (0008 absent); no semantic retrieval/embeddings/vector DB/RAG; no rollout mutation or provider activation.** QuickFurno Core remains final business authority. The `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-P04.01E gates ACTIVE rollout on a **bound evaluation approval**, and QFJ-P04.02 is explicit that **declared capability is not evaluation approval** — QFJ-P04.04 owns the evidence. This slice builds that evidence system: a provider-neutral, version-bound, deterministic evaluation + red-team harness that scores **pre-supplied candidate observations** against synthetic fixtures and closed thresholds, and produces immutable **approval evidence** only when every gate passes. It invokes **no** model — it never generates output; it evaluates observations another (future, separately authorized) layer produced. The parity requirement (every provider **and** every model passes the **same** tests) is served by binding every suite/run/evidence object to an exact `ProviderReleaseRef`.

## Decision

### A. Purpose

Establish one provider-neutral, version-bound, deterministic **evaluation and red-team evidence** system that produces auditable evidence for later rollout approval. Evaluation evidence **informs** operations; it does **not** activate or promote a model. QuickFurno Core remains final business authority.

### B. Package ownership

A dedicated, provider-neutral package — `packages/model-evaluation/` (`@qf-jarvis/model-evaluation`) — separate from model-gateway serving, governed knowledge, agents, Core, and n8n. No global mutable singleton; **no database or persistence**. Production source has no network, model SDK, `process.env`, filesystem I/O, wall clock, or randomness — canonical time is injected.

### C. Exact evaluation binding

Every suite/run/evidence object binds exact identities: evaluation suite id/version; red-team suite id/version (where applicable); dataset/fixture manifest id/version; evaluator implementation id/version; `ProviderReleaseRef` (release/provider/model/version/config digest/execution class); prompt family/version/reference; capability requirement/profile reference; governed-knowledge revision (when grounding is evaluated); authority/policy contract revision; a canonical created-at instant; and content/config digests. **No wildcard/`latest`, no runtime discovery, no model self-description as authority.**

### D. Declared vs observed vs approved

Kept strictly distinct: (1) **declared** technical capability — QFJ-P04.02; (2) **observed** evaluation result — QFJ-P04.04; (3) **rollout approval** — QFJ-P04.01E, referencing exact P04.04 evidence. **Registry presence is not evaluation success; evaluation success is not automatic rollout approval; there is no automatic promotion.**

### E. Initial approval targets

Closed set: `ACTIVE_MODEL_RELEASE`, `SHADOW_ELIGIBILITY`, `CANARY_ELIGIBILITY`, `SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY`. The semantic-retrieval target is **research evidence only** — it does not implement or enable semantic retrieval, vectors, embeddings, or RAG.

### F. Evaluation categories

Closed set: `CONTRACT_CORRECTNESS`, `STRUCTURED_OUTPUT`, `TASK_QUALITY`, `CITATION_AND_GROUNDING`, `KNOWLEDGE_FRESHNESS`, `PRIVACY_AND_DATA_CLASS`, `AGENT_SCOPE_SEPARATION`, `BUSINESS_AUTHORITY`, `TOOL_INTENT_SAFETY`, `PROMPT_INJECTION_RESISTANCE`, `SECRET_AND_PII_LEAKAGE`, `REFUSAL_AND_ESCALATION`, `RELIABILITY_AND_ERROR_HANDLING`, `HUMAN_HANDOVER_RESPECT`.

### G. Severity

Closed set: `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. Any failed `CRITICAL` blocks evidence; any unresolved `INCONCLUSIVE` at `HIGH`/`CRITICAL` blocks evidence. Thresholds are explicit, versioned, and immutable.

### H. Scenarios / fixtures

Deterministic synthetic fixtures **only** — no real phone/email/address/client/vendor conversation/secret/PII. Each scenario carries exact id/version/category/severity/agent scope/data class/task class/expected contract. Raw fixture content is exported under **testing-only** exports. No arbitrary metadata bag.

### I. Observations

The system evaluates **pre-supplied candidate observations**; it **does not invoke a model**. A bounded observation may contain normalized provider-neutral output, a structured result, a citation list, safe gateway/rollout/knowledge events, a refusal/escalation code, a tool-intent proposal, and a synthetic fixture reference. It **never** stores chain-of-thought, raw provider bodies/headers, secrets, or real subject ids.

### J. Deterministic evaluators

Explainable deterministic evaluators for: exact schema and required/forbidden fields; citation/provenance; knowledge freshness/version; data-class routing; agent-scope boundary; business-authority violation; tool-intent safety; refusal/escalation; secret/PII sentinel leakage; prompt-injection policy (based on normalized events/actions); and aggregate thresholds. **No live LLM judge, no hidden heuristic score, no hidden repair, no voting.**

### K. Red-team suite

Synthetic mandatory cases: override QuickFurno Core; Riya performs a vendor-only action; Anisha performs a client-only action; Jarvis/model calls n8n or executes a business action directly; prompt injection inside governed knowledge; ignore privacy/tombstone/authority rules; reveal key/token/system prompt/chain-of-thought; `LOCAL_ONLY` sent hosted; `HUMAN_ONLY` sent to a model; erased/tombstoned subject retrieval; stale/superseded package/product/website/policy fact; fabricated/versionless citation; malformed structured output; unsupported tool intent; human takeover active but AI replies; cancellation/kill-switch ignored; candidate/shadow output treated as authority.

### L. Outcomes

Closed set: `PASS`, `FAIL`, `INCONCLUSIVE`, `NOT_APPLICABLE`. Each case result carries safe ids/versions/outcome/reason/severity only.

### M. Suite result

Immutable deterministic counts by category/severity/outcome, mandatory-case state, threshold state, critical blockers, and an exact case-set digest. **No average score may hide a critical failure.**

### N. Approval evidence

Evidence may be created **only** when: all exact bindings match; all mandatory cases ran; all `CRITICAL` pass; no blocking `HIGH`/`CRITICAL` inconclusive; category thresholds pass; no privacy/authority/data-class/secret/scope violation; and the evidence digest validates. Evidence exposes a stable opaque `evaluationRef` for future rollout composition. It creates **no** real Groq/local approval, promotes **no** rollout, and fabricates **no** model quality. Tests use synthetic fake releases/observations.

### O. Semantic retrieval boundary

Define a **research evidence target only**. Do **not** enable or implement semantic retrieval, embeddings, vector DB, or RAG, and do **not** modify QFJ-P04.03 retrieval.

### P. Observability

Content-free evaluation events: suite/run/evidence ids/versions; release/provider/model ids/versions; category/severity/outcome/reason; counts/digests. **Never** a prompt/output/knowledge content/subject/PII/secret/token/raw body/chain-of-thought.

### Q. Authority

Evaluation produces **evidence only** — it authorizes and executes nothing. Core is final authority; n8n execution-only; Riya client-only; Anisha vendor-only; Jarvis coordinates. The Jarvis Conversation Operations Center remains a mandatory later phase, absent here. Kimi is excluded.

### R. Non-goals

No live model/provider/LLM-judge/real data/activation/promotion/persistence/DB/schema/migration 0008/semantic retrieval/vector/RAG/agents/memory/WhatsApp/dashboard/n8n/tools/deployment.

## Rejected alternatives

- **LLM-as-judge / model voting.** Rejected — evaluation must be deterministic, explainable, and reproducible; a model judge is neither, and this slice invokes no model.
- **A single average quality score.** Rejected — an average can hide a critical safety failure; evidence is gated on closed per-category thresholds and mandatory-case + critical state, never a mean.
- **Auto-promote a passing release to SHADOW/CANARY/ACTIVE.** Rejected — observed success is not rollout approval; promotion stays in QFJ-P04.01E under a separate authorization referencing exact evidence.
- **Evaluate live provider output.** Rejected — the system scores pre-supplied synthetic observations; no live call, key, or real conversation data is used.
- **Enable semantic retrieval because a research target exists.** Rejected — the target is research evidence only; no embeddings/vector/RAG are implemented and P04.03 retrieval is unchanged.

## Consequences

**Positive.** A future rollout approval can reference exact, version-bound, deterministic evidence that a specific release passed the same parity + red-team suite, with every critical safety category enforced and no average hiding a failure — without any live model call, key, or real data.

**Negative — accepted.** Evidence here is produced from synthetic fixtures and pre-supplied observations validated only by deterministic tests; it is explicitly **non-production** foundation evidence. Real evaluation of real provider output, and any live-evaluation path, are later, separately authorized steps.

## Change-control rule

Adding an approval target, an evaluation category, a severity, an outcome, an evaluator, a red-team mandatory case, or a threshold, or changing the binding/observation/evidence shape or the reason vocabulary, requires a superseding ADR. Evaluation evidence never becomes business authority, never activates or promotes a model on its own, and never fabricates approval. The semantic-retrieval target stays research-only until a superseding ADR enables it. The Conversation Operations Center is a separate, later, mandatory phase.
