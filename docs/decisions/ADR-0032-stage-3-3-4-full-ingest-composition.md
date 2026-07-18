# ADR-0032 — Stage 3.3.4 Full Transactional Ingest Composition

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Keshav Sharma — Founder and business owner, QuickFurno

**Relates to:** [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (ingestion order, idempotency, the conflict rule) · [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) (Stage 3.2 protocol and the 3.2/3.3 boundary) · [ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md) (semantic digest) · [ADR-0030](./ADR-0030-stage-3-3-validated-event-preparation.md) (validated event preparation) · [ADR-0031](./ADR-0031-stage-3-3-3-rejection-and-conflict-storage.md) (rejection/conflict storage)

> **This ADR composes the four existing Stage 3.2/3.3 primitives into one public ingest function.** It adds **no** migration, **no** HTTP endpoint, **no** worker, **no** projections/retries/dead-letters/replay/quarantine/metrics/read-models, and **no** managed-database access. It changes **no** existing contract: signature verification, validated-event preparation, the persistence bridge, `storeValidatedEvent`, and `recordIngestionRejection` are used exactly as they are.

---

## Context

Stages 3.2 → 3.3.3 shipped every piece the boundary needs, each as a separately reviewed unit: pure Ed25519 verification (ADR-0027), validated-event preparation (ADR-0030), the atomic idempotent write with in-transaction conflict recording (ADR-0031 / slice 3), and the append-only `ingestion_rejection` store (ADR-0031). What did not exist was the **composition** — the single function that runs them in the one correct order and turns their outcomes into one bounded result. This ADR adds exactly that, and only that.

## Decision

**A dependency-injected `createEventIngestor` factory returning `ingest(rawBody, envelope, now): Promise<IngestResult>`, composing verify → prepare → persist in the fixed boundary order, recording rejections in `ingestion_rejection`, and letting a conflict throw after its audit row commits.**

### 1. Exact public API

Added to the `@qf-jarvis/event-ingestion` package root:

```ts
function createEventIngestor(deps: EventIngestorDependencies): EventIngestor;

interface EventIngestorDependencies {
  readonly pool: DatabasePool; // from @qf-jarvis/event-backbone
  readonly keyRegistry: PublicKeyRegistry;
  readonly verificationOptions?: VerifySignatureOptions;
}

interface EventIngestor {
  ingest(rawBody: Uint8Array, envelope: unknown, now: Date): Promise<IngestResult>;
}
```

`envelope` is typed `unknown` — the same adversarial-safe type `verifySignature` takes; the verifier validates its shape. `createEventIngestor` and the result types are the only new public symbols; the composed primitives stay internal.

### 2. Injected dependencies; no globals

No module-level pool, no global registry, no ambient clock, no mutable singleton. The `pool`, `keyRegistry`, and `verificationOptions` are supplied at construction; `now` is supplied on every call, so freshness is deterministic and testable at any simulated instant (ADR-0020 §3, ADR-0027).

### 3. Verify-before-parse ordering

The steps run in exactly this order, and unauthenticated content is never parsed:

1. Receive the exact raw bytes and the untrusted envelope.
2. Verify signature + freshness against the exact raw bytes (`verifySignatureWithEvidence`) — before any decode or `JSON.parse`.
3. Only on success, decode + `JSON.parse` + contract-validate (inside `prepareValidatedEventFromVerifiedRawBody`).
4. Persist through the existing bridge (`persistPreparedEvent` → `storeValidatedEvent`).
5. Return a bounded `IngestResult`.

Preparation (which owns all JSON parsing) is called **only** on the branch where verification already succeeded — proven by a test that spies on `JSON.parse` and asserts it is never called after a signature failure, and by an altered-body test.

### 4. Signature-rejection evidence mapping

The **evidence-bearing** verifier (`verifySignatureWithEvidence`) is used so the accepted path has the signature evidence persistence needs, produced from the one verification. On a signature/freshness failure it returns only `{ ok: false, reason }` — **the Stage 3.2 verification contract is preserved unchanged (ADR-0027); this stage does not modify `verify.ts`.** Therefore a signature rejection records:

- `reason_code` = the exact existing `SignatureVerificationReason`;
- `key_id` = **null** and `body_digest` = **null** — the verification failure result exposes neither, and re-parsing the envelope or re-hashing the body (which for `body-too-large` must not happen) is deliberately not done;
- `issue_codes` = `[]`, `issue_count` = `0`, `issues_truncated` = `false`;
- **no** event row.

The `ingestion_rejection.key_id` / `body_digest` columns remain nullable and available for a future enhancement that surfaces safe failure evidence via an additive change to the verification contract; that is out of scope here.

### 5. Malformed JSON / preparation rejection — no new migration

Malformed UTF-8, a BOM, non-JSON, contract-validation failure, unknown type, and unknown version are all mapped through the **already-approved** preparation vocabulary (ADR-0030) — a malformed body is `reason_code: contract-validation-failed` with safe issue code `malformed-body`. **No new reason code and no migration `0004` is introduced.** A preparation rejection records:

- `reason_code` = the existing `ValidatedEventRejectionReason`;
- `issue_codes` = the **distinct** safe codes of the retained issues (the store deduplicates and sorts);
- `issue_count` = the number of retained issues;
- `issues_truncated` = the independent flag from preparation;
- **never** an issue path or message, a payload, a raw body, signature bytes, an event id, or a correlation id;
- **no** event row.

### 6. Accepted path and the result union

The existing bridge `persistPreparedEvent` (→ `storeValidatedEvent`) is used unchanged. Outcomes preserved:

- first delivery → `stored`;
- same eventId + same semantic digest → `duplicate`;
- same eventId + different semantic digest → the conflict audit row commits inside `storeValidatedEvent`'s transaction, then `ConflictingEventDigestError` is thrown.

`IngestResult` is closed and discriminated: `stored | duplicate | rejected`. `stored`/`duplicate` preserve the database-generated `sequence` and `acceptedAt`; `rejected` exposes only `reason`, `rejectionSequence`, `recordedAt`. **A conflict is not a rejection** — ingest does not convert it to a `rejected` result, does not append an `ingestion_rejection` row for it, and does not re-record the conflict (the store owns that). All returned result objects are frozen.

### 7. Conflict remains commit-then-throw

`ConflictingEventDigestError` propagates out of `ingest` **after** its audit row has committed — the behaviour `storeValidatedEvent` already implements. Ingest neither catches nor relabels it.

### 8. Rejection-recording failure propagates

A `rejected` result is returned **only after** the `ingestion_rejection` row commits (`recordIngestionRejection` resolves only on a committed INSERT). If recording the rejection fails, the database error **propagates** — ingest never returns a successful `rejected` result for an audit row that was not recorded.

### 9. No shared transaction between rejection and event persistence

A rejected delivery never reaches the event store; `recordIngestionRejection` is its own single-statement append (its own autocommit), deliberately **not** wrapped in the event transaction. For accepted/conflicting deliveries, the only transaction is the one `storeValidatedEvent` opens internally — ingest opens no second transaction around it, and introduces no `UPDATE`, `DELETE`, or replacement UPSERT.

### 10. Error semantics

Domain outcomes are returned as `IngestResult`. Infrastructure and consistency failures **throw** and are never swallowed or relabelled as domain rejections: database connection/query/commit failure, rejection-audit persistence failure, `EventPersistenceConsistencyError`, `ConflictingEventDigestError`, and the existing `ValidatedEventPreparationError` / `EvidencePreparationMismatchError` wiring errors.

## Consequences

**Positive.** The boundary is now one auditable function with the ADR-0020 §10 shape; verify-before-parse and the rejection/conflict rules are enforced in one place; nothing ambient is introduced; and no existing contract or migration changes.

**Negative — accepted.** `key_id`/`body_digest` are not populated on rejections in this stage (§4), leaving those nullable columns unused for now; surfacing safe failure evidence is deferred to preserve the Stage 3.2 contract.

## Roadmap position (scope boundary)

Stage 3.3.4 implements **`createEventIngestor` only**. It does **not** close Stage 3.3. The locked roadmap is **3.3.4 → 3.3.5 → 3.4**:

- **Stage 3.3.5 — Concurrency, Duplicate-Key Decision and Managed Readiness — remains outstanding**, and Stage 3.3 cannot close until Stage 3.3.5 is owner-accepted.
- **Stage 3.4** (projections and bounded retries) **remains blocked by Stage 3.3.5**, and **Stage 3.5** (dead letters and replay) **is not being skipped**.
- **HTTP endpoints and worker loops remain absent, and are _not_ the remainder or exit requirement of Stage 3.3.** Stage 3.3.4 and Stage 3.3.5 both explicitly exclude live HTTP endpoints, live emitters, and any external access; wiring the boundary to a live transport or worker belongs to a later phase.
- **Managed PostgreSQL still carries only migration `0001`; migrations `0002` and `0003` remain unapplied.**

## Explicit exclusions

This stage does **not** add: any migration (0001–0003 are byte-for-byte unchanged; there is no 0004); an HTTP endpoint or `apps/api` change; a worker loop or `apps/worker` change; projections, checkpoints, retries, dead letters, replay, quarantine, metrics, or read models; any new reason code or vocabulary; a `duplicate-conflict` rejection outcome; a second transaction around `storeValidatedEvent`; any broadening of `recordEventConflict` (it stays internal) or any deep export path or migration-runner bypass; and any Supabase, managed-database, Core, n8n, WhatsApp, or provider access. Managed PostgreSQL still carries only migration `0001`; migrations `0002` and `0003` remain unapplied.
