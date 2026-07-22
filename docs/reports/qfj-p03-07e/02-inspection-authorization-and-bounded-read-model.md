# Report 02 — Inspection, Authorization and the Bounded Read Model

**Date:** 2026-07-22.

## The operations boundary

`projections/projection-failure-operations.ts` (internal; not root-exported) composes the QFJ-P03.07C
repository into six intent-specific operations — no generic update, no arbitrary status mutation, no raw
SQL, no unrestricted repository client, no checkpoint modification, no resolve, no replay:

| Operation                               | Kind    | Capability                       |
| --------------------------------------- | ------- | -------------------------------- |
| `listProjectionFailuresForInspection`   | inspect | `projection-failure:inspect`     |
| `inspectProjectionFailure`              | inspect | `projection-failure:inspect`     |
| `inspectProjectionFailureHistory`       | inspect | `projection-failure:inspect`     |
| `inspectProjectionFailureDivergence`    | inspect | `projection-failure:inspect`     |
| `acknowledgeProjectionFailureOperation` | mutate  | `projection-failure:acknowledge` |
| `quarantineProjectionFailureOperation`  | mutate  | `projection-failure:quarantine`  |

## Authorization

An **injected authorizer** (`ProjectionFailureAuthorizer.authorize(request) → boolean | Promise<boolean>`)
receives the closed capability, actor type, actor id, target failure id, current status, and correlation
id. Capabilities are a closed vocabulary; **quarantine requires a strictly stronger capability than
inspect** (a caller who can inspect cannot quarantine). A denial (false or a thrown authorizer) becomes a
stable `authorization-denied` — it performs no write, appends no misleading action, reveals no sensitive
detail. For mutations the failure row is read (locked) first so the authorizer sees the real current
status, and authorization runs even when the failure is absent, so an unauthorized caller cannot probe
existence. No secret or token is ever stored in the failure tables. The authorizer is a small injected
contract with test doubles; this slice builds no user-authentication system.

## Bounded list inspection

Keyset pagination, ordered **`created_at DESC, failure_id DESC`** (no OFFSET scan). Filters are all
closed and validated: projection name (must match the projection-name grammar), version (positive int),
status and category (closed vocabularies), created-before / created-after, and active-only. **Default
page size 50; maximum 200** — an oversized or non-positive page size is rejected `invalid-page-size`; an
invalid filter is `invalid-filter`; a malformed cursor is `invalid-cursor`. The cursor is an **opaque
base64url `(created_at.toISOString()|failure_id)`** decoded and re-validated only inside the service; a
next-page cursor is returned only when more rows exist (one extra row is fetched to detect it). No
arbitrary order-by, no raw SQL fragment, no wildcard, no payload/stack/exception text.

## Bounded detail inspection

`inspectProjectionFailure` returns a **frozen** model over a single read transaction with only
operator-safe fields: failure identity, projection name/version/position, event storage sequence, closed
category and safe code, bounded `detailDigest`, lifecycle status, generation, automatic/replay attempt
counts, created/updated/first-failed/last-failed timestamps, a **blocked-checkpoint correlation summary**
(status, blocked position, last position, failed-attempt count, last safe code), a **final-attempt
summary** (attempt count + final attempt number/outcome/safe code), the **relevant divergence codes**, an
**action count + bounded recent-action summary**, and — only when already present in storage — an active
replay-authorization summary and a live replay-attempt summary.

**Excluded (never returned):** event payload, raw handler input, read-model row contents, stack traces,
SQL, connection information, secrets, unrestricted metadata, or a raw event id. The detail **fails
closed**: `failure-not-found` for a missing failure, and `divergence-detected` when an _active_ failure's
checkpoint/attempt/authorization correlation diverges (it never presents a diverged active failure as
healthy and never auto-repairs) — the operator enumerates the codes with `inspectProjectionFailureDivergence`.

## Action-history inspection

`inspectProjectionFailureHistory` returns the append-only ledger strictly filtered by failure id, in
deterministic `sequence` order, as immutable records carrying only the closed action/actor vocabularies,
the bounded actor id, the bounded reason, and the occurrence time — never raw metadata. It never updates,
deletes, or inserts, and never exposes a generic ledger repository.

## Divergence inspection

`inspectProjectionFailureDivergence` reports the closed seven-code divergences (fail-closed, never
repairs); with a `failureId` it returns only those concerning that failure or its projection.

## Read consistency

Every inspection runs inside one repository-standard `withTransaction` (implicit READ COMMITTED) so the
composed reads share a coherent transaction, and the detail model embeds the divergence codes computed in
the same transaction — an inconsistency is surfaced (or fails closed for an active failure), never
labelled healthy. No higher isolation level was introduced.
