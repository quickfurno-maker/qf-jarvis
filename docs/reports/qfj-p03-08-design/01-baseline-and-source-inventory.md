# Report 01 — Baseline and Source Inventory

**Date:** 2026-07-24. **Slice:** QFJ-P03.08 — Rebuild Determinism and Erasure (design documentation). **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

## Baseline SHAs

- Locked `main` at authoring: `31d77c247f1201461b9567673f44a4d0c5738e92`.
- Design branch: `qfj-p03-08-design-rebuild-determinism-erasure`, created from that exact SHA.
- This is a **documentation-only** slice: no source, test, config, schema, or migration change.

## Predecessor closure

- **QFJ-P03.07 (Projection Failure Operations) is complete in the repository (A–G).** Merged via PR #35, merge commit `31d77c2` (parents `84a057a` + `672cfa4`).
- Subphase merges represented on `main`: A design (PR #26), B taxonomy (PR #29), C persistence + migration 0006 (PR #30), D retry-exhaustion (PR #31), E inspection/quarantine (PR #32), F authorized replay (PR #33), G observability/runbook/exit (PR #35).
- The major phase **QFJ-P03 is not complete**: QFJ-P03.08 (this slice), QFJ-P03.09 (Subject Activity Projection), and QFJ-P03.10 (Operational Readiness and Exit Audit) remain. QFJ-P04 is gated on all of QFJ-P03.

## Canonical ADR / source inventory (inspected)

- **ADRs:** ADR-0022 (rebuild-determinism architecture — governing), ADR-0019 §7 (retention deferred to Phase 11), ADR-0026 (payload-privacy boundary), ADR-0034 (foundation, migration 0004), ADR-0036 (gap-free positions, migration 0005 — the rebuild cursor), ADR-0037 (runner), ADR-0038 (worker), ADR-0039 (canonical roadmap, migration-allocation rule), ADR-0040 (QFJ-P03.07 failure operations, migration 0006).
- **Roadmap:** `qf-jarvis-roadmap-v3.md` (canonical under ADR-0039).
- **Source (projections subsystem):** `checkpoint-store.ts`, `projection-event-reader.ts`, `projection-runner.ts`, `projection-registry.ts`, `production-registry.ts`, `projection-definition.ts`, `projection-lock-key.ts`, `handlers/{event-type-activity,daily-event-acceptance}.ts`, `observability/*`.
- **Migrations:** 0004 (checkpoint/attempt + `rm_event_type_activity` + `rm_daily_event_acceptance`), 0005 (position map + rename `sequence`→`position`), 0006 (failure operations).
- **Tests:** the P03.04–P03.07 unit and integration suites. **No rebuild/digest test exists** (confirmed implementation gap = QFJ-P03.08's future work).
- **Config:** `eslint.config.mjs` (purity blocks scoped to `packages/contracts` + `packages/event-ingestion` **only** — not projections); package export map; `public-api.test.ts`.

## Migration / API invariants (verified at the locked SHA)

| Migration | SHA-256 |
| --- | --- |
| 0001 | `dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a` |
| 0002 | `4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c` |
| 0003 | `407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c` |
| 0004 | `148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30` |
| 0005 | `96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae` |
| 0006 | `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4` |

- Migration **0007 is absent and unreserved**.
- Package-root runtime API remains **exactly 39 symbols** (`public-api.test.ts` asserts `toHaveLength(39)`).

## Protected untracked directory boundary

`docs/reports/qfj-managed-reconciliation-0002-0005/` is present and untracked. This slice does **not** read, stage, modify, or delete it. It remains `?? docs/reports/qfj-managed-reconciliation-0002-0005/` throughout.

## Managed-database state (carried forward, not connected)

Managed PostgreSQL remains at migration 0001; migrations 0002–0006 are unapplied and not deployed; password rotation is paused; no migration retry is authorized; no deployment has occurred. QFJ-P03.08 is a repository/local-CI concern only.
