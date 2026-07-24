# Report 04 — Implementation Boundary and Readiness

**Date:** 2026-07-24. **Slice:** QFJ-P03.08. **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

> This report scopes a **future, separately authorized** implementation. It is not an implementation, and nothing here is built by this documentation task.

## Likely future source files (ADDED)

- `packages/event-backbone/src/projections/projection-rebuild.ts` — the internal, library-only rebuild driver (position-ordered, single-threaded, isolated target, reuses the pure `apply`).
- `packages/event-backbone/src/projections/projection-rebuild-digest.ts` — the canonical serialization + SHA-256 digest utility.
- A synthetic domain-neutral erasure/tombstone projection fixture (test scope).

## Likely future source/config files (MODIFIED)

- `eslint.config.mjs` — add a projections-scoped purity block closing the ADR-0022 §4 gap.
- Possibly a small internal reuse of `projection-lock-key` for a distinct **rebuild-scoped** advisory key, without changing the live name+version derivation.

## Likely future tests (ADDED)

- Unit: canonicalization/digest determinism, ordering, hostile-handler normalization, no-`sequence` assertion, root-API-still-39, migration-conformance/no-0007.
- Integration (real PostgreSQL, fail-not-skip): live-vs-rebuild digest equality, synthetic erasure-survives-rebuild, version-bump rebuild, late/after-horizon behaviour, isolation from checkpoint/failure rows, repeated-rebuild idempotence.

## Allowed future modifications (implementation slice only)

Projections subsystem of `@qf-jarvis/event-backbone` (driver + digest + fixtures + tests), the projections purity lint, and the QFJ-P03.08 implementation reports. **No** `apps/worker` wiring, **no** root export, **no** package-manifest/lockfile change, **no** schema/migration, **no** CI workflow change, **no** managed access.

## Non-goals (unchanged from ADR-0043 §M)

No `rm_subject_activity`; no subject/payload widening; no new business/domain projection; no production rebuild/cutover; no shadow/version schema; no restartable durable jobs; no scheduler/daemon/queue; no worker mode; no mutating production CLI; no QFJ-P03.07 correctness change; no managed access/deployment; no migration; no root-API expansion; no retention decision; no performance/parallelism project.

## Acceptance criteria (future implementation exit gate)

1. Live/rebuild digest equality for both metadata read models.
2. Synthetic erasure effect survives full rebuild.
3. Ordering uses projection positions only.
4. Horizon excludes later positions.
5. Rebuild does not mutate live checkpoint/failure/ledger state.
6. Single-threaded deterministic application.
7. Repeat rebuild → identical digest.
8. Mid-rebuild abort leaves live state untouched.
9. Hostile handler errors normalize to safe bounded diagnostics.
10. Projection purity mechanically enforced.
11. Real PostgreSQL integration evidence exists and fails-not-skips.
12. Migrations 0001–0006 exact; 13. migration 0007 absent; 14. package-root API remains 39.
15. No managed access/deployment. 16. CI green. 17. Implementation reports and owner review pass before merge.

## Risks

- Determinism is subtle (impure reducer / non-canonical serialization → false green/red) — mitigated by the purity lint + canonical digest + an injected-impurity red test.
- Temptation to add `subject` for a "real" erasure proof — mitigated by keeping subject in QFJ-P03.09; structural proof with synthetic data here.
- Temptation to choose schema for shadow/cutover convenience — mitigated by the bounded in-place/ephemeral model; production shadow deferred.

## Rollback / containment

Library-only + test-only; no runtime wiring, no schema, no managed access — trivially revertible; the live projection path is untouched.

## Managed-lane separation

Repository implementation proceeds on local/CI PostgreSQL only (against 0004–0006). It needs no managed access and is not blocked by the managed lane, which remains paused.

## Readiness

After this design ADR + reports are accepted and reviewed, the slice is **ready for a separately authorized implementation only** — not before. This documentation task does not authorize implementation.
