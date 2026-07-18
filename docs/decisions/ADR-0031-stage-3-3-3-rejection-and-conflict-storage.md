# ADR-0031 — Stage 3.3.3 Append-Only Rejection and Conflict Storage

**Status:** Accepted
**Date:** 2026-07-18
**Accepted:** 2026-07-18
**Deciders:** Keshav Sharma — Founder and business owner, QuickFurno

**Relates to:** [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) (persistence, and the §7 retention gate) · [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (ingestion, idempotency, the conflict rule — **§8 narrowed here**) · [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) (the managed provider, deployment role obligations) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) (the payload privacy boundary) · [ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md) / [ADR-0030](./ADR-0030-stage-3-3-validated-event-preparation.md) (the database-free preparatory slices, whose migration-numbering follow-up is corrected here)

> **This ADR authorizes the two boundary audit tables of Stage 3.3, against local/CI PostgreSQL 17.** It adds migration `0003`, two append-only tables (`qf_jarvis.ingestion_rejection`, `qf_jarvis.event_conflict`), their repositories, and the in-transaction conflict recording inside `storeValidatedEvent`. It adds **no** `ingest` function, **no** HTTP endpoint, **no** worker, **no** projections/retries/dead-letters/replay, and **no** managed-database access. The complete `ingest()` composition that decides WHEN to record a rejection or a conflict is **Stage 3.3.4**, and is not built here.

---

## Context

[ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §8/§9 require two boundary audit facts the store did not yet have: a record that a delivery was **rejected** (signature/freshness/contract failure — it never enters the event log), and a record that a delivery **conflicted** (same `eventId`, different semantic content — the original acceptance stands, the refusal is recorded). PR #15 (Stage 3.3 slice 3) built the atomic idempotent write and threw `ConflictingEventDigestError` on a conflict, but **discarded** the conflict rather than recording it, and had no rejection table at all.

This slice adds exactly those two tables and the repositories for them, and makes `storeValidatedEvent` record a conflict in the same transaction it classifies it. It is the last persistence-schema slice before the ingest composition.

## Decision

**Two append-only, PAYLOAD-FREE audit tables in `qf_jarvis`, migration `0003`, with column-level runtime least privilege — and a conflict is recorded in the same transaction that classifies it, then the typed error is thrown.**

### 1. Payload-free storage — and why ADR-0020 §8 is narrowed

[ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §8 said, of a conflicting duplicate: _"Conflicting payloads are stored. They passed contract validation, so they are bounded and governed by construction … and forensics needs to see what arrived."_ **This ADR narrows that clause: no conflicting payload is stored, and no rejected payload is stored.**

The reasons, in order of weight:

- **The retention gate is still closed.** [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7 and [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) §10 keep the legal classification and retention of a canonical event log an **owner-approved hard gate on Phase 11**. A canonical payload carries **pseudonymous Core identifiers, which are personal data when linkable**. Keeping a second copy of a **refused** payload — one the boundary declined — is exactly the retention question the gate exists to answer, made worse by being about content we chose not to accept.
- **Digests are sufficient for forensics.** The refused delivery's `semantic_event_digest` and `body_digest` are one-way hashes that identify precisely _what_ arrived without keeping it. The **original** accepted event is unchanged in `qf_jarvis.event` (with its payload), reachable by joining `event_conflict.event_id → event.event_id`. A conflict record therefore says "these two differ, here are the fingerprints, here is who signed the refused one" — which is what an incident needs.
- **Consistency with [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md).** The payload privacy boundary hardened after ADR-0020; the conservative choice is not to retain refused content.

So neither table has a payload, raw-body, signature-bytes, subject-id, subject-type, free-text, validator-message, or field-path column. `ingestion_rejection` stores a **bounded reason code** and **safe repository-owned issue codes** (ADR-0030's closed vocabulary), never the validator's words; its `body_digest` is Jarvis's own `sha256(rawBody)` (computed, not copied). **The one field derived from the sender is the optional `key_id`** — the _claimed_ signing-key id from the sender-controlled envelope. It is **sender-controlled**, kept only because a rejection must record which key was claimed, and accepted **only** in the strict 1..128-character machine-token format enforced by the table `CHECK` — so it is bounded, not unbounded sender content. `event_conflict` stores digests, the validated correlation id, and bounded signature **evidence** (algorithm, key id, signed-at) — never the signature bytes.

**Issue-count / issue-codes / truncation semantics (corrected).** `issue_codes` is the **distinct** set of safe codes carried by the issues the upstream layer retained; `issue_count` is the **number of retained issues** (0..16); `issues_truncated` is an **independent** flag meaning the bounded upstream source reported more issues than it retained. Several retained issues at different paths may legitimately share one code, so `issue_count` may exceed `cardinality(issue_codes)` **with no truncation** — for example `issue_codes = {required}`, `issue_count = 2`, `issues_truncated = false` is valid. The durable schema therefore **does not** infer truncation from code compression: it enforces `issue_count BETWEEN 0 AND 16`, `cardinality(issue_codes) <= 16`, the closed safe-code set, distinct codes, and `issue_count >= cardinality(issue_codes)` — and it enforces **no** relationship between `issues_truncated` and the counts. (An earlier draft's `ingestion_rejection_truncation_consistent` CHECK was removed as incorrect while the migration was still unapplied.)

**This narrowing is recorded, not hidden.** ADR-0020 §8 gains a dated additive note pointing here; its original wording is preserved.

### 2. Migration `0003`, and the numbering correction

The two tables land in **`0003_ingestion_rejection_and_event_conflict.sql`** — a single migration (tables, append-only triggers, PUBLIC revokes, and the column-level runtime grants). `0001` (event log) and `0002` (runtime grants) are **not modified**. There is no `0004`.

[ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md) and [ADR-0030](./ADR-0030-stage-3-3-validated-event-preparation.md) each said, in _Follow-up work_, that a later slice would add these tables **"with … migration `0002`"** — written before PR #15 used `0002` for the runtime grants. Those forward references are now stale. They are corrected by **dated errata** appended to those ADRs' follow-up sections — the historical text is left intact and the erratum states the actual numbering — never by editing the original wording to pretend it always said `0003`.

### 3. Atomic conflict recording, and the throw contract is kept

`storeValidatedEvent` (event transaction, explicit `READ COMMITTED`):

1. `INSERT … ON CONFLICT DO NOTHING`.
2. If a row was inserted → `stored`.
3. If not, `SELECT` the committed original row (a fresh READ COMMITTED snapshot, so a concurrent winner is seen).
4. **Same** semantic digest → `duplicate`. **No conflict is recorded.**
5. **Different** semantic digest → append an `event_conflict` row **in this same transaction** via the internal `recordEventConflict(client, …)`, return a private sentinel so the transaction **commits the record**, and — only **after** `withTransaction` resolves — throw `ConflictingEventDigestError`.

This keeps the existing **throw-on-conflict** contract (the error surfaces to callers) while making the record atomic with the classification. The sentinel-then-throw pattern is what avoids the trap that a `throw` inside the transaction would roll the record back. Consequences that follow and are tested:

- **The original accepted event is never touched** — the transaction only ever `INSERT`s (the `ON CONFLICT DO NOTHING` is a no-op on the original; the conflict row is a separate row). No `UPDATE`/`DELETE`/replacement UPSERT exists in this path.
- **If the conflict INSERT fails**, the whole transaction rolls back and `storeValidatedEvent` throws the database error — no partial record, original intact, fail closed.
- **A COMMIT failure propagates as a database error**, never as a successfully-recorded conflict, because the typed error is thrown only after the transaction has resolved.

### 4. Every verified conflicting redelivery is a separate record

`event_conflict` has **no uniqueness constraint on `event_id`** (or on any combination that would deduplicate attempts). Each verified conflicting delivery — even a repeat of the same conflicting digest — is its own audit fact and gets its own row. A conflict is never routine (a Core bug, corruption, or an attack), and collapsing repeats would hide how often it is happening.

### 5. No read/count API in this slice

The tables are append-only audit records. **No production read or count repository API is added here.** Counting for metrics is a Stage 3.8 concern; tests read via direct SQL. Adding a read surface now would be a public promise with no consumer.

### 6. Repositories: one public trusted primitive, one internal

- **`recordIngestionRejection(pool, record)`** is exported from the `@qf-jarvis/event-backbone` root — the approved trusted low-level append primitive. It issues one parameterized INSERT, deterministically **sorts and deduplicates** `issueCodes`, never accepts `sequence` or `recordedAt`, and returns only the database-generated `sequence` and `recordedAt` (frozen). Its record type carries only `reasonCode`, optional `keyId`, optional `bodyDigest`, `issueCodes`, `issueCount`, `issuesTruncated`.
- **`recordEventConflict(client, record)`** is **INTERNAL** — deliberately **not** exported from the package root. It takes a transaction `client` and is called only by `storeValidatedEvent`. A conflict record must only ever be written by the store that just detected the conflict, in the same transaction; there is no external "append a conflict" path, and there must not be one.

Both are trusted low-level primitives that verify nothing; the future ingest composition (Stage 3.3.4) owns the verify → prepare → reject/store pipeline.

### 7. Column-level runtime least privilege

The runtime role receives, on each audit table, **column-level** grants and nothing wider:

- `INSERT` on **only** the caller-supplied columns (never the database-generated `sequence` or `recorded_at`);
- `SELECT` on **only** `sequence` and `recorded_at`, so `INSERT … RETURNING sequence, recorded_at` works — and **no** general `SELECT`, so the runtime cannot read what was rejected or what conflicted;
- **no** sequence privilege (the `IDENTITY` column needs none), **no** `UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`, **no** `CREATE`, **no** `schema_migration` access, **no** ownership.

The grant block is a comprehensive clean-slate reassertion (revoke-all-then-grant), as `0002` established, extended to the two new tables. `PUBLIC`, `anon`, `authenticated`, and `service_role` receive nothing — enforced by the schema-USAGE revoke and the bootstrap's per-migration managed-role revoke.

### 8. Append-only, exactly as the event log

Both tables get a `BEFORE UPDATE OR DELETE` mutation-rejection trigger (fires for every role, including the owner) plus REVOKEs — the same two controls that protect `event` and `schema_migration`. There are now **four** append-only triggers, and all four are proven enabled.

### 9. The reason-code and issue-code vocabularies are derived, not guessed

The persistence vocabulary is the **exact union** of `@qf-jarvis/event-ingestion`'s `SIGNATURE_VERIFICATION_REASONS` (ADR-0027 — including `unsupported-algorithm` and `key-expired`) and its validated-event-preparation reasons (`contract-validation-failed`, `unknown-event-type`, `unknown-event-version`); `duplicate-conflict` is excluded (a conflict is not a rejection). The safe issue codes are ADR-0030's closed set. Because `event-ingestion` already depends on `event-backbone`, the persistence layer **re-declares** these (importing the reverse would cycle), and a **database-free conformance test in `event-ingestion`** proves the two stay aligned. The migration's `CHECK` constraints enumerate the same sets, proven in step by integration tests.

## Consequences

**Positive.**

- The boundary's refusals and conflicts are now **durable, bounded, and countable**, without keeping a copy of anything refused.
- The privacy posture is **stronger** than ADR-0020 §8 originally described, and consistent with the still-closed retention gate.
- The conflict record is **atomic** with the classification, and the throw contract callers already rely on is unchanged.

**Negative — accepted.**

- **ADR-0020 §8 is narrowed**, so a reader of that ADR must follow the dated note here. Accepted: the note is additive and the rationale is recorded.
- **Forensics sees fingerprints, not the refused payload.** Accepted: the digests plus the unchanged original are sufficient to diagnose, and retaining refused personal-data-bearing content is exactly what the gate forbids for now.
- **Adding a future reason code needs a new forward migration** (the `CHECK` enumerates the set). Accepted: it matches the forward-only discipline, and the conformance test makes drift a failing build rather than a silent gap.

## Explicit exclusions

This slice does **not** add, and this ADR does **not** authorize: an `ingest()` composition; any HTTP endpoint, worker loop, projection, retry, dead letter, or replay; any `apps/api` or `apps/worker` change; a read or count repository API for either audit table; a uniqueness constraint that deduplicates conflicts; storage of any payload, raw body, signature bytes, subject reference, or free text; migration `0004` or any change to `0001`/`0002`; any managed-database access, `db:preflight`, or `db:migrate`; and any Core, n8n, WhatsApp, provider, or live-data integration.

## Follow-up work

- **Stage 3.3.4** composes verification + preparation + this persistence into the `ingest` write path, and owns the decision of when to call `recordIngestionRejection` and how the ingest surface reports a conflict — against local/CI PostgreSQL first, with its own review.
- **Managed application remains gated.** Migrations `0002` and `0003` are **not** applied to the managed database; it carries `0001` alone. Applying them is a separate, owner-authorized runbook step, and the Phase 11 privacy/retention gate is untouched.
