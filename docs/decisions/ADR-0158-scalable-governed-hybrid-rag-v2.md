# ADR-0158 — Scalable governed hybrid RAG V2

**Status:** Accepted for implementation; production activation requires a fresh certified SHA and prompt evidence.

## Context

Jarvis already had an exact governed-knowledge authority and citation path, but exact topic lookup is not a scalable search plane for a large mixed corpus. The required architecture must ingest business documents, policy/FAQ material, and structured data; normalize and deduplicate them; chunk them deterministically; index them lexically and semantically; and still preserve the existing authority boundary before any retrieved material reaches Riya, Anisha, or Aarohi.

The index must not become a second business-authority system. Search relevance may nominate candidates, but classification, tenant, agent, purpose, validity, privacy, and lifecycle rules remain authoritative outside the ranking algorithm.

## Decision

Jarvis adds one shared hybrid knowledge plane with this flow:

```text
source documents / policy-FAQ / structured data
  -> normalize + validate + deduplicate
  -> deterministic smart chunking
  -> governed metadata envelope
  -> PostgreSQL immutable document/chunk store
     -> GIN full-text index
     -> pgvector HNSW cosine index
  -> reciprocal-rank hybrid fusion
  -> governance-aware candidate filtering
  -> bounded reranker
  -> final governed-knowledge gate
  -> citations + minimized grounded content
  -> RIYA / ANISHA / AAROHI
```

### Ingestion and indexing

`@qf-jarvis/knowledge-ingestion` owns normalization, source-version conflict detection, deterministic chunking, content digests, governance metadata, and embedding-reuse groups. A source version is immutable: the same knowledge id/version with different content or governance is refused.

`@qf-jarvis/knowledge-index` owns bounded embedding, hybrid requests, rank fusion, reranking, and the adapter-independent retrieval contract. Embedding calls are bounded by both item count and aggregate text size. HUMAN_ONLY material is never embedded; LOCAL_ONLY material may be embedded only by a LOCAL execution-class port.

`@qf-jarvis/postgres-knowledge-index` persists the corpus in a dedicated `qf_jarvis_knowledge` schema. It uses PostgreSQL full-text search plus pgvector `vector(1536)` with HNSW cosine search. Document versions and chunks are immutable. Search uses one repeatable-read snapshot so lexical and vector candidates come from the same corpus revision.

Large corpora use a streaming release publisher. Source documents are prepared, embedded, and staged in bounded batches. A partially staged corpus is never query-visible.

### Release model

A knowledge corpus is addressed by an exact immutable revision, never `latest` or a wildcard. Releases move through STAGING then SEALED. One `active_release` pointer controls visibility. Activation and rollback are therefore a single atomic pointer switch after a complete release has been verified.

The runtime candidate store refuses a configured revision when it is not the active SEALED release or when its embedding model does not match index metadata.

### Governance

Metadata filtering happens in PostgreSQL before candidate bodies leave the store: lifecycle, supersession, subject linkage, effective/expiry time, tenant, agent scope, purpose, classification, topic, release, and embedding-model constraints are all bounded there.

That database filter is defense in depth, not final authority. Every fused candidate is passed through the existing governed-knowledge authority before reranking, and again before release to the model context. A reranker may reorder and score only canonical pre-authorized candidates; it cannot substitute content under a known id.

### Three-agent runtime

The actor-to-authority mapping remains closed in code:

- RIYA -> CLIENT / CLIENT_RESPONSE
- ANISHA -> VENDOR / VENDOR_RESPONSE
- AAROHI -> PROSPECT / PROSPECT_RESPONSE

Deployment configuration may choose bounded topic filters and search limits, but cannot choose another agent scope or purpose. The semantic query is the normalized text from the authenticated inbound envelope; callers cannot inject a separate search query.

A per-turn bridge permits one retrieval attempt. Citations travel through the existing orchestration plan. Retrieved content is held separately and is serialized into the model-only user payload after M2 retrieval succeeds; it is not copied into generic orchestration metadata, Core proposals, observability events, or state projections.

Hybrid grounding is optional and absent by default. Exact legacy grounding and hybrid grounding are mutually exclusive. Enabling a hybrid agent requires an evaluated prompt binding. Riya's dedicated grounded evolution/reply surfaces additionally require their own evaluated grounded prompt bindings.

### Embedding adapter

`@qf-jarvis/openai-compatible-embedding-adapter` provides the production-capable embedding port without owning policy. HOSTED execution requires HTTPS, a bounded bearer credential, no loopback endpoint, no redirects, bounded request size, bounded response size, a fixed 1536-dimensional model contract, and strict indexed response validation. LOCAL execution is loopback-only and may omit a credential.

There are no retries, no fallback embedding model, no environment-variable reads, and no logging of source text, credentials, or provider bodies in this adapter.

## Consequences

The search plane can scale independently from agent behavior while one governed authority remains decisive. Large releases can be built without holding the whole corpus or sending an unbounded embedding request, and can be rolled back without rewriting document rows.

The schema requires PostgreSQL with pgvector. Production provisioning must apply the knowledge-index migration and stage a sealed exact revision before hybrid retrieval can be activated.

This ADR does not authorize production activation. The previously certified Jarvis SHA remains the only certified release until a new JF-5B live run, prompt review, JF-5C seal, deployment evidence, and the normal QuickFurno governed canary are completed for the new code SHA. In particular, the prior production seal cannot be reused to claim evaluation of Riya's dedicated grounded prompt paths.
