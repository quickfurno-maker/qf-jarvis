# Report 01 — Current State and Baseline

**Task:** QF Jarvis — Canonical Roadmap v3.0 Governance Reconciliation (documentation and governance only).
**Date:** 2026-07-21.
**Scope:** Read-only inspection of the merged baseline before any governance document was written.

## Baseline verification

| Fact                                 | Value                                      | Verified |
| ------------------------------------ | ------------------------------------------ | -------- |
| Local `main` SHA                     | `01b164b40d9d34d32b9233e97c4d75ce946121ee` | ✅       |
| `origin/main` SHA                    | `01b164b40d9d34d32b9233e97c4d75ce946121ee` | ✅       |
| Synchronization `origin/main...main` | `0  0`                                     | ✅       |
| Working tree at start                | clean                                      | ✅       |

## PR #24 merge details

| Field               | Value                                                 |
| ------------------- | ----------------------------------------------------- |
| Number              | 24                                                    |
| State               | **MERGED**                                            |
| isDraft             | false                                                 |
| Base                | `main`                                                |
| Head (`headRefOid`) | `a4fa50013685cbb0bb4ff82404b8f29898eacf4f`            |
| Merge commit        | `01b164b40d9d34d32b9233e97c4d75ce946121ee`            |
| mergedAt            | `2026-07-21T15:32:04Z`                                |
| URL                 | https://github.com/quickfurno-maker/qf-jarvis/pull/24 |

**Merge parents** of `01b164b…` (`git rev-list --parents -n 1`):

- parent 1: `9d271bbae3121f49f78a74ff6abb3969dcfb7fc6`
- parent 2: `a4fa50013685cbb0bb4ff82404b8f29898eacf4f`

This is a true merge commit (two parents), consistent with PR #24 being merged, not fast-forwarded.

## Branch state

- Governance branch created: `qfj-p00-roadmap-v3-governance`, forked from merged `main` (`main...HEAD` = `0  0` before edits).
- Feature branch `stage-3.4.5b-projection-handlers` is **absent** locally and remotely (its work is merged into `main` via PR #24).

## Working-tree state

Clean at baseline; the only changes introduced are the governance documentation described in reports 02–05.

## Migration inventory

Authoritative source: `packages/event-backbone/src/persistence/migrations/` (compiled mirror in `dist/` is byte-identical).

| #    | Filename                                          | SHA-256                                                            |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------ |
| 0001 | `0001_event_log.sql`                              | `dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a` |
| 0002 | `0002_event_runtime_grants.sql`                   | `4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c` |
| 0003 | `0003_ingestion_rejection_and_event_conflict.sql` | `407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c` |
| 0004 | `0004_projection_foundation.sql`                  | `148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30` |
| 0005 | `0005_projection_event_positions.sql`             | `96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae` |

**Migration 0006 is absent.** No `0006*` file exists in either directory. See [migration-ledger.md](../../governance/migration-ledger.md).

## Documentation inventory (pre-existing)

- `docs/architecture/` — 17 files, incl. `phased-roadmap.md` (active roadmap), `event-backbone.md` (active Phase-3 status), `agent-model.md`, `responsibility-matrix.md`, `data-ownership.md`, `system-boundary.md`, `trust-boundaries.md`.
- `docs/decisions/` — 38 ADRs, `ADR-0001` … `ADR-0038` (highest existing number 0038 → next available **0039**).
- `docs/governance/` — 6 pre-existing files (auditability, automation-levels, change-management, engineering, privacy, security principles).
- `docs/charter/`, `docs/contracts/`, `docs/compatibility/`, `docs/engineering/` — supporting material.
- `docs/reports/` — **did not exist** before this task; created here.

## CI / test baseline

- Root scripts include `format:check` (prettier), `lint` (eslint `--max-warnings=0`), `typecheck` (tsc build + per-package test typecheck), `test` (`test:unit` + `test:integration`), and `check` (format:check → lint → typecheck → test → build → check:dist-containment).
- `pnpm check` and `test:integration` require a **local PostgreSQL 17** (via `db:up`). This governance task is documentation-only and does not modify runtime; the integration suite is therefore an environment-gated step (see report 05 and the environment-limitation note).

## Root API surface

- `@qf-jarvis/event-backbone` package-root runtime surface is asserted at **exactly 39 symbols** by `packages/event-backbone/src/tests/public-api.test.ts` (`EXPECTED_ROOT_SURFACE` length 39), unchanged since Stage 3.4.5B. Package `exports` expose only `.`.
- Workspace apps: `apps/api`, `apps/worker`. Packages: `contracts`, `event-backbone`, `event-ingestion`.

## Managed-database status

- Managed PostgreSQL carries **migration 0001 only**. Migrations **0002, 0003, 0004, 0005 are unapplied** managed; no managed migration is authorized.

## External-system status

- **No** live QuickFurno Core connection, **no** Supabase managed access, **no** n8n, **no** WhatsApp/provider integration is active. Phase 3 uses synthetic fixtures only.

## Known limitations

- The integration test suite (`pnpm check` / `test:integration`) is not exercised by this documentation-only task; it requires a running local database. This is reported honestly rather than worked around.
- The historical `phased-roadmap.md` and `event-backbone.md` bodies still contain long pre-merge narratives that describe `stage-3.4.5b-projection-handlers` as under review in Draft PR #24; a canonical banner at the top of each now marks that as historical and points to the merged baseline and the canonical roadmap.
