# Report 04 — Migration Ledger and Database Readiness

**Date:** 2026-07-21. **Purpose:** Record the exact migration inventory, checksums, statuses, and the migration-numbering policy. Authoritative source: [migration-ledger.md](../../governance/migration-ledger.md).

## Exact migration filenames and SHA-256 checksums

Computed locally with `sha256sum` against `packages/event-backbone/src/persistence/migrations/`. The compiled mirror in `dist/` is byte-identical (checksums match).

| #    | Filename                                          | SHA-256                                                            |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------ |
| 0001 | `0001_event_log.sql`                              | `dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a` |
| 0002 | `0002_event_runtime_grants.sql`                   | `4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c` |
| 0003 | `0003_ingestion_rejection_and_event_conflict.sql` | `407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c` |
| 0004 | `0004_projection_foundation.sql`                  | `148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30` |
| 0005 | `0005_projection_event_positions.sql`             | `96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae` |

## Repository status

- Migrations 0001–0005 are **present and unchanged** (byte-for-byte). They are immutable.
- **No `0006*` file exists** in `src/` or `dist/`.

## Local / test status

- 0001–0005 are applied in local/CI PostgreSQL 17 as part of the test and build pipeline (per the historical stage record and ADRs 0034/0036/0037/0038).

## Managed status

- **Managed PostgreSQL carries migration 0001 only.**
- Migrations **0002, 0003, 0004, 0005 are unapplied** to managed PostgreSQL; **no managed migration is authorized.** Because the default migrator applies every pending migration in order, an unauthorized managed run would apply `0002`→`0005` together — the reason it is not authorized.

## Migration 0006 verdict

**ABSENT and not created.** Migration 0006 does not exist and was not created by this governance task. It is **conditionally reserved for QFJ-P03.07 (Projection Failure Operations)** and only if the approved QFJ-P03.07 design proves schema is required. If ever created it must not contain RAG, agents, task runtime, model gateway, WhatsApp, n8n, QuickFurno Core integration, or `rm_subject_activity` (absent a later explicit ownership decision). This is consistent with historical ADRs 0036/0037/0038, which state "there is no 0006" and "Stage 3.5's migration shifts to 0006+."

## RAG migration verdict

**UNALLOCATED.** No migration number is pre-reserved for RAG. No migration number after 0006 is pre-reserved. The contradiction audit for `RAG migration.*0006 | migration 0006.*RAG` returned **no matches**, confirming no document allocates RAG to 0006.

## Migration-numbering policy

Roadmap text alone cannot authorize or allocate a migration number. A number may be used only when: (1) the owning phase design is approved, (2) schema change is proven necessary, (3) exact scope is reviewed, (4) prior migration inventory is confirmed, (5) managed rollout impact is documented, and (6) migration creation is separately authorized.

## Readiness risks

- The largest managed risk is the **all-pending default migrator**: any authorized managed run must be scoped and reviewed for the full `0002`→`0005` set, not a single migration, because the default migrator applies all pending migrations.
- Applying 0004/0005 managed has not received reviewed managed-readiness; that is a prerequisite gate, not a completed step.

## Next authorization gate

Managed application of `0002`→`0005` requires reviewed managed-readiness for `0004` and `0005` (or one full-scope report) plus explicit owner authorization for the complete `0002`→`0005` scope — a separately authorized managed-readiness task, out of scope here.

## Confirmation

**No migration or SQL was created, modified, or applied by this task.** No migration stub was created. No database (managed PostgreSQL or Supabase) was accessed. The migrations were inspected read-only and checksummed.
