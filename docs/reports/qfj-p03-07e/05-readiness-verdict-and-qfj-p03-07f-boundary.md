# Report 05 — Readiness Verdict and QFJ-P03.07F Boundary

**Date:** 2026-07-22.

## What QFJ-P03.07E delivered

A safe, bounded, operator-facing internal operations surface over the QFJ-P03.07C/D failure state:

1. **List** projection failures (authorized, keyset-paginated, closed filters, bounded page size).
2. **Inspect** one failure (bounded immutable detail with checkpoint/attempt correlation and divergence
   codes; no payload/message/stack/SQL/secret; fail-closed on missing/diverged).
3. **Inspect action history** (append-only, failure-scoped, closed vocabularies).
4. **Inspect divergence** (closed seven-code detector; fail-closed; no repair).
5. **Acknowledge** (`open → acknowledged`) and **quarantine** (`open`/`acknowledged → quarantined`) —
   authorized, generation-guarded, idempotent, atomic (transition + one append-only action), and — for
   quarantine — divergence-gated.

Every operator mutation records append-only evidence, preserves the blocked checkpoint and all ordering
invariants, and is safe under concurrency and an ambiguous COMMIT.

## Scope containment (what this slice did NOT do)

- **No replay:** no replay authorization created or consumed, no replay attempt started, no replay
  execution, and **no replay worker / scheduler / timer / poller / lease renewal**.
- **No resolve / supersede / retire; no checkpoint advance / reset; no event skip; no automatic repair.**
- **No generic operator mutation endpoint, no arbitrary status setter, no raw operator SQL, no
  unrestricted repository client, no direct checkpoint modification.**
- **No dashboard or frontend; no sensitive event payloads or raw exception text exposed.**
- **No migration change, no migration 0007, no SQL file, no managed deployment, no managed-PostgreSQL or
  Supabase access.**
- **No projection-runner or worker behavior change; no package-root API expansion (39 symbols).**
- **No MVP (M1) runtime work.**

## Readiness posture

- Local: `format:check`, `lint`, `typecheck`, `git diff --check` pass; unit **2518/2518** (58 files),
  including the unchanged 39-symbol public-API test and the migration-conformance/checksum tests.
- Integration (inspection, acknowledge/quarantine atomicity, checkpoint immutability, idempotency,
  optimistic concurrency, divergence gate, authorization, append-only protection) runs in **CI** against
  real PostgreSQL 17; local PostgreSQL is not provisioned and was not accessed.
- Migration 0006 checksum unchanged; 0007 absent; managed PostgreSQL untouched.

## QFJ-P03.07F boundary (next)

QFJ-P03.07F — **Authorized Replay Execution** — is next: the explicit, generation-bound replay
authorization workflow (already-persisted `projection_replay_authorization`), single-consume semantics,
the leased `projection_replay_attempt` execution, the atomic replay-success resolution
(read-model mutation + checkpoint advancement + attempt success + failure resolution + authorization
consumption + audit), and the lease worker — all behind the ADR-0040 role model (a replay approver ≠ the
requester; the system runner cannot self-authorize). Until then, replay is unavailable; a blocked
projection can be inspected, acknowledged, and quarantined, and anything beyond that escalates to
engineering.

## Verdict

**PASS / QFJ_P03_07E_READY_FOR_OWNER_REVIEW** (pending green CI on the exact PR head).
