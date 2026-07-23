# Report 01 — Baseline and Existing-Migrator Inventory

**Task:** QFJ Managed Migration Boundary — bounded managed migration targeting (`--through`).
**Date:** 2026-07-22. **Implementation-only; no managed database was accessed.**

## Recovery state

The prior execution was interrupted. Read-only inventory found the feature branch
`qfj-managed-migration-bounded-target` already created but **empty**: HEAD exactly at the locked
baseline, no tracked/staged changes, no commits after the baseline, branch not pushed, no PR.
Classified **STATE_0_NO_IMPLEMENTATION_STARTED** (branch pre-created; Section E directs creating it
only if absent, so it was reused, not recreated). Nothing was reset, restored, cleaned, stashed,
rebased, amended or deleted.

## Verified baseline

| Fact                   | Value                                                  |
| ---------------------- | ------------------------------------------------------ |
| Repository             | `C:/Users/KESHAV SHARMA/Desktop/qf-jarvis`             |
| Branch                 | `qfj-managed-migration-bounded-target`                 |
| Baseline SHA (start)   | `d73998fd78ede26ca7301e4f2b37322e67c0b648`             |
| `main` = `origin/main` | `d73998fd78ede26ca7301e4f2b37322e67c0b648`, sync `0 0` |
| Descends from baseline | yes                                                    |
| Open PRs at start      | none                                                   |

## Migration immutability (recalculated, all exact)

| #    | File                                              | SHA-256                                                            |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------ |
| 0001 | `0001_event_log.sql`                              | `dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a` |
| 0002 | `0002_event_runtime_grants.sql`                   | `4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c` |
| 0003 | `0003_ingestion_rejection_and_event_conflict.sql` | `407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c` |
| 0004 | `0004_projection_foundation.sql`                  | `148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30` |
| 0005 | `0005_projection_event_positions.sql`             | `96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae` |
| 0006 | `0006_projection_failure_operations.sql`          | `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4` |

Six migrations only; **0007 absent**; `git diff` against `origin/main` for `**/migrations/**` and
`**/*.sql` both exit 0.

## Pre-change migrator inventory

- **Scripts.** Root `db:migrate` → `pnpm --filter @qf-jarvis/event-backbone db:migrate` →
  `node ./dist/persistence/migrate-cli.js`. Root `db:preflight` → `preflight-cli.js`.
- **`migrate-cli.ts`** parsed **no arguments** and called
  `migrateWithPreflight(pool, config, defaultMigrationsDirectory())`.
- **`migrate.ts`** — `migrateWithPreflight(pool, config, migrationsDirectory)`: loads files, then on
  ONE client runs the read-only preflight and, only if it passes, `runMigrationsOnClient`.
- **`migration-runner.ts`** — `runMigrations(pool, dir)` and `runMigrationsOnClient(client, files)`:
  session advisory lock `4657120349871265` → idempotent bootstrap → `readAppliedMigrations` →
  `reconcile` (checksum / missing-file / out-of-order) → apply each pending migration in **its own
  transaction** → unlock in `finally`.
- **History mechanism.** `qf_jarvis.schema_migration` (version PK, filename, `BYTEA` checksum,
  `applied_at`), append-only by trigger + REVOKE; runner uses SELECT/INSERT only.
- **Bounded capability: absent.** No `--to` / `--target` / `--through` / version parameter existed
  anywhere. The only file-list-accepting function, `runMigrationsOnClient(client, files)`, is
  deliberately **not** root-exported and is reachable from no script — so there was no
  repository-supported way to stop at 0005. That gap is exactly what this slice closes.

## Managed-status context (documentation, not a live reading)

The migration ledger records managed as **0001 applied; 0002–0006 unapplied**. No managed database
was contacted in this task, so that remains documentation rather than queried evidence.
