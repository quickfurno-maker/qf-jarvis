# QF Jarvis — Authoritative Migration Ledger

**Document status:** Canonical and authoritative for migration inventory, checksums, and the migration-allocation policy. Adopted 2026-07-21 under [ADR-0039](../decisions/ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md). Read with [qf-jarvis-roadmap-v3.md](../architecture/qf-jarvis-roadmap-v3.md).

> **This ledger records facts inspected in the repository.** SHA-256 checksums were computed locally (`sha256sum`) against the authoritative source migrations under `packages/event-backbone/src/persistence/migrations/`. The compiled copies under `packages/event-backbone/dist/persistence/migrations/` are byte-identical (checksums match). **No migration was created, modified, or applied by the governance task that produced this ledger.**

## Canonical migration path

- Authoritative source: `packages/event-backbone/src/persistence/migrations/`
- Compiled mirror (identical checksums): `packages/event-backbone/dist/persistence/migrations/`

## Ledger

| # | Filename | SHA-256 (src) | Historical owning stage | Canonical QFJ phase | Repository status | Local/test status | Managed-DB status | Immutable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0001 | `0001_event_log.sql` | `dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a` | Stage 3.1 — initial event-store foundation | QFJ-P02 | Present, unchanged | Applied (local/CI) | **Applied** | Yes |
| 0002 | `0002_event_runtime_grants.sql` | `4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c` | Stage 3.3 — event runtime grants | QFJ-P02 | Present, unchanged | Applied (local/CI) | **Unapplied** | Yes |
| 0003 | `0003_ingestion_rejection_and_event_conflict.sql` | `407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c` | Stage 3.3.3 — ingestion rejection & event conflict | QFJ-P02 | Present, unchanged | Applied (local/CI) | **Unapplied** | Yes |
| 0004 | `0004_projection_foundation.sql` | `148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30` | Stage 3.4.1 — projection foundation | QFJ-P03.01 / QFJ-P03.02 | Present, unchanged | Applied (local/CI) | **Unapplied** | Yes |
| 0005 | `0005_projection_event_positions.sql` | `96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae` | Stage 3.4.3 — projection event positions (commit-ordered) | QFJ-P03.03 | Present, unchanged | Applied (local/CI) | **Unapplied** | Yes |
| 0006 | `0006_projection_failure_operations.sql` | `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4` | QFJ-P03.07C — projection failure persistence | QFJ-P03.07 | Present (new, this slice) | Applied (local/CI) | **NOT APPLIED / separately gated** | Yes |

## Exact facts

- Migrations **0001–0005 exist and are immutable.** Their bytes are preserved unchanged; the checksums above are the record.
- **Managed PostgreSQL carries migration 0001 only.** Migrations **0002, 0003, 0004, 0005, 0006 are unapplied** to managed PostgreSQL, and **no managed migration is authorized**. Because the default migrator applies every pending migration in order, an unauthorized managed run would apply `0002`→`0006` together — which is precisely why it is not authorized.
- **Migration 0006 now exists**, created by **QFJ-P03.07C** (its exclusive owner) under separate authorization. It is the **projection failure persistence foundation** ([ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md)): the failure aggregate, the append-only action/audit ledger, replay authorizations, and replay-attempt/lease evidence. It contains **no** RAG, pgvector, agents, task runtime, model gateway, WhatsApp, n8n, QuickFurno Core integration, memory, analytics, or `rm_subject_activity`. **It has not been applied to managed PostgreSQL and is not deployed.**
- **QFJ-P03.07D (Atomic Retry-Exhaustion Integration) uses migration 0006 unchanged.** It wires the production runner to the existing 0006 tables (the fifth deterministic failure now establishes a failure aggregate + `created` action atomically) but adds **no** new migration, modifies **no** migration byte (0006 checksum above is unchanged), and creates **no** migration 0007. Managed status is unchanged.
- **The RAG migration is unallocated.** No migration number is pre-reserved for RAG.
- **Migration 0007 does not exist and no migration number after 0006 is pre-reserved.** RAG/conversation persistence would use the next valid number only after 0006, under its own authorized design.

## Permanent migration-numbering policy

**Roadmap text alone cannot authorize or allocate a migration number.** The next migration number may be used only when **all** of the following hold:

1. the owning phase design is approved;
2. schema change is proven necessary;
3. exact scope is reviewed;
4. prior migration inventory is confirmed;
5. managed rollout impact is documented;
6. migration creation is separately authorized.

No SQL is created, no migration stub is created, and no SQL is applied on the strength of a roadmap or ledger entry alone.

## Verification note

To re-verify the checksums locally:

```
sha256sum packages/event-backbone/src/persistence/migrations/*.sql
```

The output must match the SHA-256 column above exactly. Any mismatch means a supposedly immutable migration was altered and must be investigated before any further work.
