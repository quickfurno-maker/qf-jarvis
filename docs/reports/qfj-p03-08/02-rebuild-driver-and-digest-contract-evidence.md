# Report 02 — Rebuild Driver and Digest Contract Evidence

**Date:** 2026-07-24. **Slice:** QFJ-P03.08. **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

## The rebuild driver (`projection-rebuild.ts`)

- **Input:** a frozen `ProjectionDefinition`, a captured `horizon: bigint`, and an already-borrowed `DatabaseClient` pointed at an isolated target. The caller owns the transaction and the target.
- **Horizon:** `captureRebuildHorizon(client)` reads `COALESCE(MAX(position), 0)` from `qf_jarvis.projection_event_position` **once**; it takes no lock and does not block ingestion. `0n` when no event has been ingested.
- **Traversal:** strictly ascending `[1..horizon]`, one position at a time, single-threaded. For each position it reads the metadata-only `ProjectionEvent` via `readEventAtPosition` (position, eventType, eventVersion, acceptedAt — **never** `event.sequence`, never a payload/subject) and calls `definition.apply(client, event)` exactly once.
- **Fail-closed aborts** (bounded codes, original cause discarded): a missing position within the horizon → `projection-rebuild-position-missing`; a read error → `projection-rebuild-read-failed`; a reducer rejection → `projection-rebuild-handler-failed`; a malformed request → `projection-rebuild-invalid-request`. There is **no** retry/backoff — a re-application that fails signals non-determinism, not a transient fault.
- **Isolation:** the driver issues no checkpoint/attempt/failure/ledger/quarantine/replay SQL; it never calls `runProjectionOnce`. It mutates only what the reducer writes to the borrowed target. The QFJ-P03.07 lifecycle remains authoritative for the LIVE runtime and is never invoked.
- **Result:** `{ horizon, appliedPositions }` — bounded, non-identifying summary counts only; never row content.

### Locking (engineering choice, recorded per ADR-0043 §F)

The bounded local/CI proof relies on **test/transaction isolation** rather than an advisory lock: each proof runs against a quiescent fixture database inside a caller-owned transaction, so same-target concurrency cannot arise. No new advisory key was introduced and the **live** name+version lock derivation (`projection-lock-key.ts`) is untouched. A future rebuild-scoped key remains available (a distinct domain prefix) but is unnecessary here and was deliberately not added.

## The digest utility (`projection-rebuild-digest.ts`)

- **Contract:** `live result == rebuilt result` ⇔ identical SHA-256 over a canonical serialization of all authoritative rows, ordered by the complete primary key ascending. It is an **intra-run `A === B`** proof — one canonicaliser produces both digests — not a persisted/portable format; nothing is stored.
- **Driver-quirk independence:** the two `node-postgres` locale/timezone-prone types are rendered to canonical TEXT server-side — `TIMESTAMPTZ` via `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` and `DATE` via `to_char(..., 'YYYY-MM-DD')` — so the JS driver never parses them into a locale-dependent `Date`.
- **Explicit value encoding (`encodeCanonicalValue`):** BIGINT → base-10 string; integer number → decimal string; `Date` → intrinsic UTC ISO-8601; canonical string → passthrough; `null` → a fixed sentinel distinct from `''` and the text `"NULL"`. A non-integer number, a boolean, an object, `undefined`, an invalid `Date`, or a value containing a framing control character all **fail closed** with `projection-rebuild-uncanonical-value`. Row content is never logged.
- **Framing:** ASCII control separators (US/RS/GS) built via `String.fromCharCode` (no raw control bytes in source, no `no-control-regex` needed); a header domain-separates the derivation. The exact framing is deterministic and tested; because the digest is intra-run, cross-implementation portability is explicitly out of scope (ADR-0043 §G).
- **Specs:** `EVENT_TYPE_ACTIVITY_DIGEST_SPEC` and `DAILY_EVENT_ACCEPTANCE_DIGEST_SPEC` enumerate every authoritative column of the two production read models with PK ordering; no current column is excluded.

## Unit evidence (no database)

- `projection-rebuild.test.ts` (scripted fake client): ascending exactly-once traversal; the reducer sees exactly `{position,eventType,eventVersion,acceptedAt}`; `horizon 0n` no-op; positions beyond the horizon excluded; gap/read/handler/invalid-request aborts with the right bounded code; a hostile reducer error's text never reaches `message`/`cause`.
- `projection-rebuild-digest.test.ts`: bigint/integer/Date/date-string/null encodings; unsupported values fail closed; byte-stability across runs; sensitivity to value changes and to row order; NULL distinct from `''` and `"NULL"`; 64-hex SHA-256; the canonical SQL projections.

All 33 unit tests pass (`test:unit` total 2692/70, up from 2659/67).
