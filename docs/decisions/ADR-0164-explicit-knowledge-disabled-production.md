# ADR-0164 — Explicit knowledge-disabled production posture

**Status:** Accepted
**Date:** 2026-09-24
**Relates to:** ADR-0148, ADR-0158, ADR-0159, ADR-0163

## Decision

The QuickFurno WhatsApp production worker may run with governed knowledge explicitly
`DISABLED`.

This is a capability posture, not an empty RAG release. A disabled deployment has:

- no production knowledge revision;
- no knowledge database configuration or connection;
- no embedding endpoint, model or credential;
- no retrieval or embedding execution;
- no claim in operational telemetry that an active knowledge revision exists.

The worker configuration uses exactly:

```json
{ "knowledge": { "mode": "DISABLED" } }
```

HYBRID remains the only production mode that composes the PostgreSQL/pgvector retrieval plane.
HYBRID requires an exact SEALED revision, exact embedding model, database policy and per-agent search
bounds.

## Certification binding

Knowledge posture is part of the production evidence boundary.

For DISABLED:

- exact-head JF-5B evidence must have no `knowledgeRevision`;
- the JF-5C seal therefore carries knowledge-unbound evaluation bindings;
- the production binder explicitly requires the absence of a knowledge revision.

For HYBRID:

- exact-head JF-5B evidence must bind the exact configured knowledge revision;
- the JF-5C seal and serving config must agree on that revision.

A knowledge-bound seal may not activate a DISABLED deployment, and an unbound seal may not activate a
HYBRID deployment. Moving between the two postures creates a new certification lineage.

## Answering behavior while disabled

DISABLED does not authorize the model to use training knowledge as QuickFurno truth. The production
prompts already reserve QuickFurno business facts to governed turn context / Core and require the
agent to say that it does not have a fact in front of it rather than inventing one.

The worker may still:

- understand and respond conversationally to the current user turn;
- clarify needs;
- use current signed QuickFurno authority supplied to the ordinary runtime;
- produce a proposal that still requires QuickFurno final communication authorization.

It may not represent unsupplied prices, policies, availability, timelines, guarantees, vendor state
or other QuickFurno business facts as known.

## Deployment

The base production container mounts no PostgreSQL CA and no embedding credential. Deployment defaults
to `QFJ_WORKER_KNOWLEDGE_MODE=DISABLED`.

HYBRID is added through a separate compose override and explicit
`QFJ_WORKER_KNOWLEDGE_MODE=HYBRID`. The override mounts only the knowledge-specific credential and
CA.

The obsolete managed-Riya persistence-decision file is not part of either deployment posture.

## Observability

Worker observation protocol v3 reports knowledge as either:

- `{ "mode": "DISABLED" }`; or
- `{ "mode": "HYBRID", "revision": "...", "embeddingModelRef": "..." }`.

Jarvis OS renders DISABLED as disabled, not healthy or missing. A disabled snapshot carries zero
retrieval/embedding activity unless the process violates its own containment tests.

## Future activation

DISABLED is the safe launch posture while no approved production business corpus exists. Enabling
HYBRID later requires a separately approved corpus, immutable release construction, retrieval quality
evidence, exact-head certification and controlled rollout. This ADR approves no business content.
