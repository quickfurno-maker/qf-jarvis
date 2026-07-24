# Report 02 — Correctness, Security and Privacy Exit

**Date:** 2026-07-24. **Slice:** QFJ-P03.10.

## Correctness

- **Append-only storage** — the event log, boundary audit tables, projection-attempt log, and action ledger all reject `UPDATE`/`DELETE` by trigger.
- **Deterministic ordering** — projections traverse the dense, commit-ordered `projection_event_position`, never `event.sequence`; a projection advances exactly one position at a time and can never skip (checkpoint invariants fail closed).
- **Atomic checkpoint/read-model** — the read-model write and the checkpoint advance occur in one transaction, converting at-least-once delivery into exactly-once effect.
- **Retry/failure** — bounded equal-jitter retries; the fifth deterministic failure atomically blocks the checkpoint and establishes exactly one durable failure aggregate.
- **Block/quarantine/replay safety** — authorized, generation-guarded, idempotent operator lifecycle; lease-protected one-shot replay; a replay failure never advances the checkpoint; no automatic scheduler or bulk replay.
- **Deterministic rebuild** — destroy-and-rebuild reproduces a byte-identical canonical SHA-256 digest of the read models (proven against real PostgreSQL).
- **Subject erasure** — a permanent tombstone on `qf.privacy.erasure-recorded`; a from-scratch rebuild replays the erasure in position order and re-reaches the identical erased state; pre-erasure activity does not resurrect.

## Security / privacy

- **Payload isolation** — projections receive metadata-only events; the projection DB role is never granted `payload`. QFJ-P03.09 additionally grants only the opaque subject columns (`subject_type`, `subject_id`) — proven: as the projection role, `SELECT payload` raises `permission denied`.
- **Safe errors / redaction** — durable failure records carry only closed repository-owned safe codes; the observability redaction test asserts on full serialized output; operator free-text reasons and raw subject values are never emitted.
- **Subject boundary** — the subject is an opaque Phase-2 EntityReference (charset guardrail forbids free text; reference-never-reproduce). It is resolved only by a narrow internal reader that only the `subject-activity` handler may import (restricted-import ESLint rule); the metadata reducers stay subject-blind.
- **Least-privilege grants** — the projection role holds `SELECT` on metadata + subject columns and `SELECT/INSERT/UPDATE` on read models; no `DELETE`/`TRUNCATE`, no mutation of the immutable log, no audit-table content, no migration history, no schema `CREATE`.
- **No secret/log leakage** — no secret handling anywhere in the projection subsystem; diagnostics carry no payload/subject.
- **Erased-subject retrieval-gate foundation** — `rm_subject_activity.erased` + the tombstone give future retrieval a deterministic "has this subject been forgotten?" gate; **no erased subject context may be provided to a model** (a P04 obligation, foundation now in place).

All dimensions are implemented and CI-proven; none is outstanding for repository completion.
