# Governed hybrid knowledge index production runbook

**Status:** Production-hardening runbook for RAG V2. It does not authorize production activation.

## Invariants

- The WhatsApp serving worker has two explicit knowledge postures: `DISABLED` and `HYBRID`.
- `DISABLED` has no knowledge revision, database or embedding dependency and executes no retrieval.
- `HYBRID` binds one exact Git SHA, one exact JF-5C seal, one exact SEALED knowledge revision and one exact embedding model.
- Wildcard or `latest` knowledge revisions are forbidden in HYBRID.
- Production database TLS is `verify-full` only.
- Subject-linked records are refused before normalization, chunking, embedding or persistence.
- `HUMAN_ONLY` data is never embedded. `LOCAL_ONLY` data may use only LOCAL embedding and LOCAL reranking.
- Runtime reads only. The knowledge ingestor publishes releases. A separate maintainer role retires old releases.
- Retrieved content is untrusted reference data. It never becomes authority, permission or an instruction.
- A grounded `REPLY` must cite at least one record that was actually supplied to the model.
- QuickFurno Core remains business and communication authority.

## Database prerequisites

Use PostgreSQL 17 with pgvector 0.8.6 or newer. CI and local Compose use the pinned pgvector image declared in the repository.

Required roles are intentionally separate:

- `qf_jarvis_runtime`: SELECT-only serving access.
- `qf_jarvis_knowledge_ingestor`: staging/sealing/activation access.
- `qf_jarvis_knowledge_maintainer`: execute-only access to controlled inactive-release pruning.

Do not grant DELETE or TRUNCATE on knowledge tables to runtime or ingestion roles.

## Release construction

1. Normalize source material outside the serving process.
2. Refuse any source carrying `subjectRef`.
3. Build a new immutable STAGING release.
4. Embed under the exact configured model.
5. Add release-document references.
6. Seal the release.
7. Run retrieval/evaluation checks against the sealed revision.
8. Atomically activate the revision only after approval.
9. Keep the previous releases available for rollback.

A partially staged release is not visible to serving retrieval.

## Production worker binding

The WhatsApp worker configuration must contain:

- exact `knowledge.revision`;
- exact embedding `modelRef`;
- embedding execution class and endpoint;
- separate credential-file reference for hosted embeddings;
- bounded per-agent candidate pool, result count and context-character limits.

Worker startup checks the active knowledge revision and embedding-model identity before reaching READY. Failure is fatal and no turn is claimed.

The Jarvis->QuickFurno Ed25519 private key is stored in a dedicated secret file and not inline in the worker JSON.

## Corpus maintenance

Inactive sealed releases may be retired only through `qf_jarvis_knowledge.prune_inactive_release` and only by a role that is a member of `qf_jarvis_knowledge_maintainer`.

The pruning function:

- refuses the active release;
- refuses STAGING releases;
- captures the exact document identities belonging to the target release;
- deletes only data that belonged to that target and is referenced by no other release;
- cannot sweep unrelated staging data.

Operational policy should retain the active release plus enough previous sealed releases for the agreed rollback window. The exact number is an owner/operator policy, not a runtime default.

## Embedding reuse

Embedding reuse is keyed by `embeddingModelRef + contentDigest`. Governance is checked before cache use; cached vectors never bypass data-class rules.

Changing embedding model identity deliberately causes a cache miss and requires a new knowledge release.

## Embedding model migration

Never mutate vectors in place.

1. Select and evaluate the new exact embedding model.
2. Build a completely new STAGING knowledge release under that model.
3. Run the capacity/quality benchmark and grounded-agent evaluation.
4. Seal the release.
5. Update the worker configuration to the new exact revision and model together.
6. Deploy disabled.
7. Prove startup binding and run canary retrieval.
8. Activate the knowledge revision/worker only after approval.
9. Keep the previous sealed release for rollback.

Changing vector dimension requires a new schema/index version rather than silently reusing the V1 `vector(1536)` contract.

## Capacity benchmark

The package exposes:

```text
pnpm --filter @qf-jarvis/postgres-knowledge-index run build
pnpm --filter @qf-jarvis/postgres-knowledge-index run benchmark:rag
```

The benchmark requires a loopback-only `DATABASE_URL`; it refuses managed/non-loopback targets.

Optional controls:

- `QFJ_KNOWLEDGE_BENCHMARK_DOCUMENTS` — default 10,000; max 1,000,000.
- `QFJ_KNOWLEDGE_BENCHMARK_QUERIES` — default 200; max 10,000.

It reports document/chunk count, ingestion throughput, recall@8, p50/p95/p99 retrieval latency, index bytes and embedding-model identity.

Release capacity evidence should record the machine/database shape beside the benchmark output. A benchmark number without hardware and corpus shape is not portable evidence.

## Source adapters

PDF, DOCX, HTML, CMS, Drive, Notion or database connectors belong before the governed ingestion boundary. They must output bounded `KnowledgeSourceDocumentInput` values.

A source adapter must own:

- MIME/type validation;
- file-size limits;
- malware scanning where files are uploaded;
- text extraction and normalization;
- extraction provenance and source revision;
- rejection of hidden/unsupported payloads.

Do not add document parser SDKs to the serving runtime or the core knowledge-index packages.

## Horizontal scale

The current WhatsApp gateway/worker deployment is intentionally single-owner and conservative.

Before multiple ingress or worker replicas are introduced, replace process-local replay assumptions and the host filesystem spool with a reviewed shared durable claim/queue authority. Do not scale replicas first and retrofit idempotency later.

## Observability

The production WhatsApp worker emits the strict `qfj.quickfurno-worker-observation.v1` snapshot to its configured `operationalSnapshotFile`. The schema is content-free and contains only worker state, exact release/model references, aggregate durable-spool counts/oldest age, bounded aggregate processor outcomes, bounded model-latency samples, and bounded hybrid-RAG outcome/latency aggregates. It contains no query text, retrieved content, tenant/subject identifier, provider credential, database credential or Core payload.

Jarvis OS may adopt that source only when `QFJ_WORKER_OBSERVATION_FILE` points at a read-only mounted snapshot. It rejects files larger than 64 KiB, malformed snapshots, future timestamps and snapshots older than 30 seconds. The adapter owns only headline metrics, worker/model/knowledge health and model latency. It receives no database connection, QuickFurno credential, provider credential or write method.

Repository baselines and fixtures remain labeled as such; an unavailable/stale live file becomes NOT_CONNECTED rather than an empty live result.

The adopted worker observation now covers RAG served/no-candidate/governance-refusal/provider-store-reranker failure counts and a bounded retrieval-latency sample ring. Additional future read protocols may cover database health and richer Core proposal aggregates. Each must remain a separate read-only adoption and not an authority change.

## Separate Riya persistence gate

This runbook does not authorize migrations 0011/0012 for live managed persistence and does not supersede ADR-0095 or ADR-0104.

Riya continuity/idempotency production persistence remains fail-closed until the owner explicitly approves data classification, purpose, retention and erasure behavior and the repository records a superseding decision.
