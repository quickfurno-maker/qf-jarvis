# Report 01 — Implementation Manifest and Invariant Proof

**Date:** 2026-07-24. **Slice:** QFJ-P03.08 — Rebuild Determinism and Erasure (implementation). **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

> QFJ-P03.08 is IMPLEMENTED ON A FEATURE BRANCH / DRAFT PR — not complete, not merged. Merge is separately authorized after owner review.

## Baseline

- Locked base `main`: `0327c2f126035d8204cfe547981446f859a7be2d` (ADR-0043 merged via PR #36).
- Feature branch: `qfj-p03-08-rebuild-determinism-erasure`, created from that exact SHA.

## Changed-file manifest (implementation)

**Added — source (3 files):**

| File                                                                   | Purpose                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/event-backbone/src/projections/projection-rebuild-errors.ts` | Closed, rebuild-scoped safe error vocabulary (fixed messages, runtime-normalised codes, no `cause`) |
| `packages/event-backbone/src/projections/projection-rebuild-digest.ts` | Canonical SHA-256 read-model digest: explicit value encoding, PK-ordered snapshot, per-model specs  |
| `packages/event-backbone/src/projections/projection-rebuild.ts`        | The bounded, single-threaded rebuild driver + `captureRebuildHorizon`                               |

**Added — tests (4 files):**

`projection-rebuild.test.ts` (driver, scripted fake client) · `projection-rebuild-digest.test.ts` (canonicalisation) · `projection-reducer-purity.test.ts` (lint enforcement) · `projection-rebuild.integration.test.ts` (real PostgreSQL 17).

**Modified — config (1 file):** `eslint.config.mjs` — a projections-`handlers`-scoped reducer purity block (closes the ADR-0022 §4 gap).

**Modified — docs (1 file):** `docs/architecture/qf-jarvis-roadmap-v3.md` — narrow status update (design merged; implementation on a feature branch / draft PR, not merged). Plus this `docs/reports/qfj-p03-08/` report set.

## Files that must NOT change — verified unchanged

- **Package-root barrel** `packages/event-backbone/src/index.ts` — unchanged (`git diff` empty); no new root export.
- **Migrations 0001–0006** — byte-identical to the locked hashes; **migration 0007 absent**.
- **Package manifests / lockfile** — unchanged (no dependency added; ESLint is already a dev dependency).
- **`apps/`, `.github/` (CI), `scripts/`** — unchanged.
- **QFJ-P03.07 correctness** (runner, worker, checkpoint store, failure/replay) — unchanged; the driver reuses only the pure `apply` and the position-ordered reader.
- **`ProjectionEvent`** — not widened (no subject/payload).
- **`docs/reports/qfj-managed-reconciliation-0002-0005/`** — untracked and untouched.

## Migration / API proof

| Migration | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| 0001      | `dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a` |
| 0002      | `4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c` |
| 0003      | `407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c` |
| 0004      | `148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30` |
| 0005      | `96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae` |
| 0006      | `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4` |

- Migration **0007 absent and unreserved**. **NO_MIGRATION_REQUIRED** (ADR-0043 §K): the driver reads the existing position map, cursors in memory, isolates via existing/ephemeral targets, and compares via an application-level digest.
- Package-root API remains **exactly 39 symbols** (`public-api.test.ts` `toHaveLength(39)` unchanged and passing).

## Managed boundary

No managed database was accessed. Local integration proof ran against the sanctioned **loopback** Docker test database only (`127.0.0.1:55432/qf_jarvis_test`, `--locale=C`), guarded by `database-test-utils.ts`. Managed PostgreSQL remains at migration 0001; 0002–0006 unapplied; password rotation and managed migration lanes remain paused; no deployment.
