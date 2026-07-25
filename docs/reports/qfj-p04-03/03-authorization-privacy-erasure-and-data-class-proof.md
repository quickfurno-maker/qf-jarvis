# Report 03 — Authorization, Privacy, Erasure, and Data-Class Proof

**Slice:** QFJ-P04.03 — Governed Knowledge System. **ADR:** [ADR-0051](../../decisions/ADR-0051-qfj-p04-03-governed-knowledge-system.md).

## Request carries no content

A retrieval request carries only safe bounded metadata — tenant, agent scope, purpose, data class, an as-of instant, exact id/topic selectors, `maxRecords`, a content-size bound, and a required-citation flag. It has **no** free-text/query field: an unknown field or a request with no selector is rejected (`invalid-request`, proven). Prompts and messages are never copied into it.

## Tenant, agent scope, purpose

Proven, each failing closed with a precise reason:

- **Tenant** — a record scoped to a specific tenant is denied to another tenant (`knowledge-tenant-denied`); a `GLOBAL` record is served to any tenant.
- **Agent scope** — a CLIENT-only record is denied to a VENDOR request and vice-versa; a COORDINATION-only record is served only to COORDINATION (`knowledge-permission-denied` on mismatch). Riya=CLIENT, Anisha=VENDOR, Jarvis=COORDINATION remain distinct.
- **Purpose** — a record answering only `POLICY_LOOKUP` is denied a `CLIENT_RESPONSE` request (`knowledge-permission-denied`).

## Data-class isolation

The lattice is enforced before any content is returned (proven):

| Record class \\ Request class | HOSTED_ALLOWED | LOCAL_ONLY | HUMAN_ONLY |
| ----------------------------- | -------------- | ---------- | ---------- |
| HOSTED_ALLOWED                | served         | served     | served     |
| LOCAL_ONLY                    | **denied**     | served     | served     |
| HUMAN_ONLY                    | **denied**     | **denied** | **denied** |

`HOSTED_ALLOWED` never receives `LOCAL_ONLY` or `HUMAN_ONLY` knowledge; `LOCAL_ONLY` never enters a hosted context; `HUMAN_ONLY` is **never** returned to a model (`knowledge-data-class-denied` on any violation).

## Privacy / erasure / tombstone gate (before content)

A subject-linked record is gated by an injected `KnowledgePrivacyGate`, consulted **after** every other check and **before** content is exposed. Proven:

- a subject-linked record with **no** gate configured fails closed (`knowledge-privacy-gate-missing`);
- a subject whose status is `erased`, `anonymised`, `tombstoned`, or `in-progress` is blocked (`knowledge-subject-erased`);
- a `clear` subject passes;
- the emitted observability event carries **no** subject reference (proven by serialisation).

No Core erasure is implemented here — the gate is a provider-neutral boundary with a single deterministic testing implementation under `./testing`.
