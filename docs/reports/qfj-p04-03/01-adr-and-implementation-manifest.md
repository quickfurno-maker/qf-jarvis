# Report 01 — ADR and Implementation Manifest

**Slice:** QFJ-P04.03 — Governed Knowledge System. **ADR:** [ADR-0051](../../decisions/ADR-0051-qfj-p04-03-governed-knowledge-system.md).

## What this slice adds

One dedicated, provider-neutral package — **`@qf-jarvis/governed-knowledge`** — implementing an immutable governed-knowledge **lifecycle + registry + deterministic bounded retrieval** that a future agent may consult to retrieve and **cite approved knowledge as evidence**. Knowledge is **evidence, never business authority**; QuickFurno Core remains the authoritative system of record. ADR-0051 was committed **first**, before any implementation.

## Boundary (what it does NOT do)

No database/persistence, no schema, **no migration (0008 absent)**; no document upload/scanning runtime; **no vector database, embeddings, semantic search, or RAG**; no live model call, no real key/token; no provider activation; no agent runtime, memory, WhatsApp, dashboard, or n8n. The package depends only on `zod`. The `@qf-jarvis/event-backbone` root API remains **39**; migrations 0001–0007 are byte-exact.

## Package layout

```
packages/governed-knowledge/
  package.json            (@qf-jarvis/governed-knowledge; exports "." and "./testing"; dep: zod)
  tsconfig.build.json     (emitting build; EXCLUDES src/tests → production-only dist)
  tsconfig.json           (noEmit typecheck incl. tests)
  src/
    contracts/
      vocabularies.ts        closed lifecycle/authority/source/data-class/scope/purpose/status/reason sets
      errors.ts              GovernedKnowledgeError + closed construction codes
      instant.ts             pure canonical-instant parse/compare (no wall-clock read)
      permissions.ts         RetrievalPermissions + GLOBAL_TENANT
      knowledge-record.ts    immutable KnowledgeRecord + createKnowledgeRecord (full validation)
      citation.ts            frozen KnowledgeCitation + buildCitation
      retrieval-request.ts   bounded exact request + createRetrievalRequest
      retrieval-result.ts    KnowledgeRetrievalResult (ok+records | fail-closed reason)
      privacy-gate.ts        injected KnowledgePrivacyGate interface
      observability.ts       content-free KnowledgeEvent + hook + NOOP
    registry/
      supersession.ts        existence / cycle / newer validation
      governed-knowledge-registry.ts  immutable registry (dedup, order, lookup, snapshot)
    retrieval/
      authorization.ts       per-record eligibility (fail-closed, privacy last)
      conflict-resolution.ts deterministic per-topic authority resolution
      retrieve-governed-knowledge.ts  the retrieval authority
      audit.ts               separate retired-history citation lookup (no content)
    testing/
      deterministic-privacy-gate.ts  the ONLY shipped gate impl (./testing)
      index.ts               ./testing barrel
    index.ts                 public root barrel
    tests/                   deterministic specs (excluded from dist)
```

## Commits (ADR-first, small, auditable)

1. `docs(adr): define QFJ-P04.03 governed knowledge system` — ADR-0051 (committed first).
2. `feat(governed-knowledge): add lifecycle and registry`.
3. `feat(governed-knowledge): enforce private bounded retrieval`.
4. `test(governed-knowledge): prove freshness privacy and authority`.
5. `docs(reports): record QFJ-P04.03 implementation evidence` (this report set + roadmap).

## Base

Branch `qfj-p04-03-governed-knowledge-system`, created from the exact post-hygiene main
`bb9f95c2362e029fbd46fe58d4cff39fd0125546` (event-ingestion rejection-key hygiene merged). DRAFT PR only — **do not merge** until owner acceptance.
