# ADR-0033 — Stage 3.3.5 Concurrency, Duplicate-Key Decision and Managed Readiness

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Keshav Sharma — Founder and business owner, QuickFurno

**Relates to:** [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (ingestion order, idempotency, the conflict rule) · [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) (dedicated managed PostgreSQL) · [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) (verify-before-parse) · [ADR-0030](./ADR-0030-stage-3-3-validated-event-preparation.md) (validated-event preparation) · [ADR-0031](./ADR-0031-stage-3-3-3-rejection-and-conflict-storage.md) (rejection/conflict storage) · [ADR-0032](./ADR-0032-stage-3-3-4-full-ingest-composition.md) (the ingest composition)

> **Stage 3.3.5 hardens and proves the ingest boundary; it ships one behavioural change (duplicate object keys are rejected) and one test-lifecycle fix. It adds no migration, no public runtime export, no new database reason code, no HTTP endpoint, no worker, and no managed-database access.** It documents — but does not perform — the managed application of the already-authored migrations `0002` and `0003`.

---

## Context

Stage 3.3.4 composed verification → preparation → persistence into `createEventIngestor` (ADR-0032). Before Stage 3.3 can close, the boundary's behaviour under **real concurrency**, **restarts**, and **partial/ambiguous failures** must be proven against PostgreSQL, one security ambiguity in JSON parsing must be closed, and the managed database's readiness for the existing runtime-grant and audit-table migrations must be recorded — without any managed action. This ADR records those decisions.

## Decision

### 1. Duplicate JSON object member names are rejected

`JSON.parse` resolves a duplicate object member **last-wins**, silently: `{"a":1,"a":2}` becomes `{ a: 2 }`. For an authenticated event that is a security-relevant ambiguity — a signer, a verifier, and a reader could disagree about which value is authoritative. **QF Jarvis rejects any JSON object that contains the same member name twice, at every nesting depth.**

- Equality is by **decoded** name, so escaped-equivalent names collide: `{"a":1,"a":2}` is a duplicate because both names decode to `a`. Surrogate-pair escapes decode to the same UTF-16 sequence as the literal character.
- The **same** name in **different** object scopes is valid: `{"left":{"a":1},"right":{"a":2}}` is accepted.
- Detection is a small, deterministic, **iterative** internal scanner (`duplicate-object-key-scan.ts`) — **not** a regex (a regex cannot track object scope or string context) and **not** recursive (the 256 KiB body bound permits ~131 072 levels of nesting, which would overflow the call stack). It correctly handles escaped property names, `\u` escapes, nested objects and arrays, whitespace, and strings that contain structural punctuation.

### 2. Ordering: verification first, then duplicate detection, then parsing

1. **Signature and freshness verification run first** (Stage 3.2). Duplicate-key detection runs **only** on an already-authenticated body — an unauthenticated or oversized body is refused (`signature-*`, `body-too-large`) before any parsing.
2. **Duplicate detection runs before `JSON.parse`-based preparation** can accept last-wins semantics. The scanner is authoritative only for _duplicates_; on any non-duplicate body it defers, and `JSON.parse` remains the single authority for validity.

### 3. Duplicate rejection reuses the existing vocabulary — no new code, no migration

A duplicate maps through the **already-approved** preparation vocabulary (ADR-0030, ADR-0031):

- `reason_code` = **`contract-validation-failed`** (an existing reason);
- one safe issue with code **`invalid-format`**; `issue_count` = **1**; `issues_truncated` = **false**;
- **no** duplicated key name, field path, raw body, payload, parser message, or other sender-controlled text is persisted — the rejection issue carries an empty path and a fixed repository-owned message.

No new reason code, **no new public runtime export**, and **no migration** are introduced. The detector is internal and is not exported from the package barrel.

### 4. Correctness target: PostgreSQL READ COMMITTED

The persistence contract is correct at **READ COMMITTED** (the level `storeValidatedEvent` pins as its transaction's first statement). Correctness rests on three existing mechanisms, proven under concurrency here:

- **`UNIQUE (event_id)`** (migration `0001`) arbitrates concurrent insertion of the same eventId — exactly one INSERT wins.
- **`INSERT ... ON CONFLICT DO NOTHING`** makes the losing insert a no-op; the subsequent **separate** classifying `SELECT` takes a fresh READ COMMITTED snapshot that sees the committed winner and compares semantic digests.
- **Transactional conflict recording** appends one `event_conflict` row in the same transaction that classifies a conflict, commits, then throws.

**SERIALIZABLE isolation and advisory locks are not required and are not used.** SERIALIZABLE would add serialization-failure retries for no correctness gain; an advisory lock would serialize a race the unique index already arbitrates. There is exactly **one** transaction for classification and conflict recording; rejection recording is a separate single-statement append (its own autocommit), never wrapped in the event transaction; and there is no `UPDATE`, `DELETE`, or replacement UPSERT.

This isolation level is **directly observed inside `storeValidatedEvent`'s own transaction**, not inferred from a separate transaction: a test-only forwarding client records the store's statement order and, immediately before the store's event INSERT, runs `SELECT current_setting('transaction_isolation')` on the **same** underlying connection (calling the real client directly, with no wrapper recursion). The observed first-delivery order is `BEGIN` → `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` (the first statement after `BEGIN`) → observer `SELECT` (`read committed`) → `INSERT INTO qf_jarvis.event` → `COMMIT`, and the concurrency race tests above pass at exactly this observed level.

### 5. Concurrency invariants (proven against PostgreSQL 17)

- **Same-digest races** produce exactly **one** stored result; every other concurrent delivery is a benign **duplicate** referencing the one accepted row. No conflict rows, no rejection rows, nothing updated or replaced.
- **Different-digest races** preserve **exactly one** original accepted event and append **one** `event_conflict` row **per refused conflicting delivery**; the losing deliveries each throw `ConflictingEventDigestError`. Either variant may win; all invariants hold regardless of the winner.
- **Independent eventIds** never interfere: each stores once, with unique sequences and no false duplicate/conflict.
- The least-privileged **runtime role** races identically, with no broadened privilege and no read access to audit-table content.

### 6. Restart and fault semantics — two DISTINCT failure classes

- **Pool restart.** Re-ingesting the same signed event through a fresh pool returns `duplicate` (eventId idempotency), never a second accepted row; a conflicting redelivery after a restart records one conflict and throws.

- **Class A — pre-COMMIT callback failure.** The event INSERT may already have executed inside the open transaction when the failure occurs. If the transaction **callback** fails **before COMMIT**, **production `withTransaction` issues the `ROLLBACK`** (its callback-error path), the client is released, and the original error propagates. No partial accepted event or conflict state becomes visible, no `ingestion_rejection` row is added (this is infrastructure, not a domain rejection), and a healthy retry stores exactly once. Proven with a test-only client wrapper that forwards the event INSERT to PostgreSQL, awaits its real result, and only then throws — so the failure surfaces from the store's own callback and `withTransaction`'s ROLLBACK runs. The observed statement sequence is exactly `BEGIN → SET → INSERT → ROLLBACK`, and **COMMIT is never attempted**. The injector issues **no** statements of its own; the ROLLBACK is the production helper's, not the test's.

- **Class B — unknown COMMIT result (acknowledgement loss).** `COMMIT` may have completed at the server even when the client receives an error, so a COMMIT error **must not** be treated as proof of rollback — the row may already be durable. The recovery mechanism is an **eventId-idempotent retry**, which returns `duplicate` for the same event (or a conflict for a different digest) and **never creates a second accepted event**. Proven with a test-only wrapper that lets the server COMMIT and then throws a connection-lost error to the caller; the row is durable and a retry returns `duplicate` with exactly one accepted row.

Both paths are proven using **test-only client wrappers and real local PostgreSQL 17**; the pre-COMMIT rollback is the production helper's, not manufactured by the injector.

### 7. The pg client-lifecycle deprecation warning

The suite emitted `Calling client.query() when the client is already executing a query is deprecated`. It had **two** independent **test-code lifecycle** causes, both now removed:

1. **Concurrent queries on a single pooled client** — test-only code issued several `client.query()` calls in parallel via `Promise.all(columns.map(() => client.query(…)))`. A single `pg` connection cannot run queries in parallel; the fix **sequences** those queries on the one borrowed client.
2. **An unawaited `SET SESSION` in a pool `connect` listener** — an isolation test set the session default via `pool.on('connect', (c) => void c.query('SET SESSION CHARACTERISTICS …'))`. Because the listener is fire-and-forget, the pool could return the client while the unawaited `SET` was still in flight, and the first real query could overlap it. The fix replaces the listener with a **test-only awaited initializer**: `connect()` obtains the real client, **awaits** the `SET` to completion, and returns the client only on success; on failure it releases the client exactly once and propagates the original error. No async or fire-and-forget connect listener remains.

**Both were test-code errors. The production helpers `withClient`/`withTransaction` were already correct** — each `await`s the callback, and the COMMIT/ROLLBACK, before releasing in `finally` — so **no production lifecycle change was made**. New focused tests pin the guarantees: the transaction-helper lifecycle (callback settles before release; COMMIT after the callback; ROLLBACK after a rejection; release after COMMIT/ROLLBACK; the original error preserved even if ROLLBACK fails; exactly one release), and the awaited initialized-pool wrapper (never returns a client before the `SET` settles; releases once and propagates on init failure). The warning is not suppressed; it is eliminated, and final unit and integration runs — including a `--trace-deprecation` run — contain zero pg concurrent-query warnings.

### 8. Managed migration readiness — documented, not performed

Migrations **`0002`** (runtime grants) and **`0003`** (audit tables) remain **unapplied** to the managed database, which still carries **only `0001`**. Their managed application requires a **separate, owner-authorized run** governed by [`stage-3.3.5-managed-readiness-report.md`](../engineering/stage-3.3.5-managed-readiness-report.md): a preflight, checksum verification, backup/recovery posture, role and grant verification, `PUBLIC`/`anon`/`authenticated`/`service_role` denial verification, append-only trigger verification, and explicit abort conditions. The synthetic-fixture **smoke test runs entirely inside one transaction that ends with `ROLLBACK`** — the audit tables are append-only, so a smoke-test row cannot be removed with `DELETE`, and the current hardcoded migrations provide no disposable namespace; rollback is a transaction abort (not row deletion), and an admin verification proves zero synthetic rows persist afterward. **Any runtime database credential that has been exposed must be rotated before a managed application run.** This stage introduces no live endpoint, emitter, or external access.

## Consequences

**Positive.** The boundary is proven safe under real concurrency, restarts, and ambiguous commits at READ COMMITTED; a silent duplicate-key ambiguity is closed with the existing vocabulary; the pg lifecycle warning is gone; and managed readiness is captured without touching the managed database.

**Negative — accepted.** The duplicate-key scanner is a hand-written JSON parser (justified: a regex cannot track scope, and recursion is unsafe at 256 KiB); it is covered by focused unit tests and defers all non-duplicate validity to `JSON.parse`.

## Explicit exclusions

This stage does **not** add: any migration (`0001`–`0003` are byte-for-byte unchanged; there is no `0004`); a new public runtime export or a new database reason code; an HTTP endpoint, `apps/api`, or `apps/worker` change; projections, checkpoints, retries, dead letters, replay, quarantine, metrics, or read models; SERIALIZABLE isolation, advisory locks, or any `UPDATE`/`DELETE`/replacement UPSERT; a production failpoint or debug hook; and any Supabase, managed-database, Core, n8n, WhatsApp, or provider access. Managed PostgreSQL still carries only migration `0001`. **Stage 3.3 does not close until Stage 3.3.5 is independently accepted and merged; Stage 3.4 remains blocked.**
