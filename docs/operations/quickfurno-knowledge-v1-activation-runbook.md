# QuickFurno Knowledge V1 Activation Runbook

**Purpose:** move production from `knowledge.mode=DISABLED` to the first exact `HYBRID` release
without weakening the current fail-closed deployment boundary.

## 1. Review and approve the curated corpus

Review `apps/api/src/knowledge-production/quickfurno-production-corpus.ts`.

The release contains only seven approved-reference topics and intentionally excludes current prices,
payments, credits, lead/vendor state, assignment state and live availability.

Create an owner-local config file outside the repository with:

```json
{
  "approval": {
    "approvedBy": "quickfurno.owner",
    "approvedAt": "2026-10-01T00:00:00Z",
    "approvalRef": "owner.approval.quickfurno.knowledge.v1"
  },
  "database": {
    "connectionString": "postgresql://qf_jarvis_knowledge_ingestor@DB_HOST:5432/qf_jarvis",
    "tls": {
      "mode": "verify-full",
      "caFile": "/srv/qf-jarvis/secrets/postgres-ca.pem"
    }
  },
  "embedding": {
    "executionClass": "HOSTED",
    "endpoint": "https://api.openai.com/v1/embeddings",
    "modelRef": "text-embedding-3-small",
    "credentialFile": "/srv/qf-jarvis/secrets/embedding-production.key",
    "timeoutMs": 20000,
    "maxBatchItems": 64,
    "maxInputChars": 64000
  }
}
```

Do not store this file in Git.

## 2. Database prerequisite

Apply the already-reviewed `qf_jarvis_knowledge` pgvector migration and use the existing role split:

- `qf_jarvis_knowledge_ingestor` for staging/sealing;
- `qf_jarvis_runtime` for SELECT-only serving;
- `qf_jarvis_knowledge_maintainer` only for controlled retirement.

Production TLS remains `verify-full`.

## 3. Build the immutable candidate

After building `@qf-jarvis/api`:

```text
qfj-knowledge-build-candidate --config /absolute/path/knowledge-v1.json
```

Expected shape:

```text
qfj-knowledge-candidate SEALED_INACTIVE revision=qfkb.sha256.<64-hex> ...
```

The command **cannot activate** the release.

Record the exact revision and embedding model in the certification evidence.

## 4. Certify the exact knowledge revision

Run the current exact-head JF-5B live certification in `HYBRID` mode and bind the exact
`qfkb.sha256.<digest>` revision. Complete the normal blinded human review and mint a fresh JF-5C
production seal for that same repository SHA, prompt set, provider release set and knowledge revision.

Do not reuse the current knowledge-unbound production seal.

## 5. Activate the already-sealed release

Only after certification/approval:

```text
qfj-knowledge-activate --config /absolute/path/knowledge-v1.json
```

The command derives the expected revision from the approved corpus, refuses an unsealed release, then
proves that the exact revision + embedding model became the active PostgreSQL knowledge release.

## 6. Bind the worker to HYBRID

Keep the current OpenAI Luna/Sol model configuration unchanged and add the knowledge database plus the
knowledge compose override. Recommended first production search policy:

```json
{
  "knowledge": {
    "mode": "HYBRID",
    "revision": "qfkb.sha256.REPLACE_WITH_EXACT_REVISION",
    "embedding": {
      "executionClass": "HOSTED",
      "endpoint": "https://api.openai.com/v1/embeddings",
      "modelRef": "text-embedding-3-small",
      "credentialFile": "/run/secrets/embedding-production.key",
      "timeoutMs": 20000,
      "maxBatchItems": 64,
      "maxInputChars": 64000
    },
    "semanticCache": { "mode": "DISABLED" },
    "agents": {
      "RIYA": {
        "topicFilters": [
          "quickfurno-overview",
          "matching-process",
          "vendor-listing-policy",
          "lead-sharing-privacy",
          "service-categories",
          "pune-service-areas"
        ],
        "candidatePool": 24,
        "maxResults": 4,
        "maxContentChars": 3000
      },
      "ANISHA": {
        "topicFilters": [
          "quickfurno-overview",
          "matching-process",
          "vendor-listing-policy",
          "lead-sharing-privacy",
          "service-categories",
          "pune-service-areas"
        ],
        "candidatePool": 24,
        "maxResults": 4,
        "maxContentChars": 3000
      },
      "AAROHI": {
        "topicFilters": [
          "quickfurno-overview",
          "vendor-listing-policy",
          "service-categories",
          "pune-service-areas",
          "vendor-join-overview"
        ],
        "candidatePool": 24,
        "maxResults": 4,
        "maxContentChars": 3000
      }
    }
  }
}
```

Use `deploy/quickfurno-worker/compose.knowledge.yml` so the knowledge-specific embedding credential
and PostgreSQL CA remain absent from a DISABLED deployment.

## 7. Canary and rollback

Before broad use, verify:

- worker observation reports `knowledge.mode=HYBRID` with the exact revision/model;
- RAG served/no-candidate/governance-refusal counters behave as expected;
- grounded answers cite only supplied records;
- live Core truth still wins for price/state/availability questions;
- Riya, Anisha and Aarohi remain inside their closed CLIENT/VENDOR/PROSPECT scopes;
- QuickFurno Core remains final business and send authority.

Rollback is two-part: return the worker to the previously sealed knowledge-unbound production
configuration and, if required, reactivate the prior sealed knowledge release. Never relabel a
different corpus under the same revision.
