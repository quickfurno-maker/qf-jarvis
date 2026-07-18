# Stage 3.3.5 — Managed Migration Readiness Report

**Status:** `READY_FOR_SEPARATE_OWNER_AUTHORIZED_MANAGED_RUN`
**Date:** 2026-07-18
**Scope:** Managed application of migrations **`0002`** then **`0003`** only.

> **This report documents readiness. It does NOT authorize, execute, or record a managed migration.** No managed database was contacted during Stage 3.3.5. Managed PostgreSQL continues to carry **only migration `0001`**; `0002` and `0003` remain **unapplied**. This report contains **no password, connection string, or secret**.

---

## 1. Scope and ordering

Exactly two migrations, applied **in this order**, each in its own transaction under the migration runner's advisory lock:

1. `0002_event_runtime_grants.sql` (version 2)
2. `0003_ingestion_rejection_and_event_conflict.sql` (version 3)

No other migration is in scope. There is **no `0004`**. `0001_event_log.sql` is already applied to the managed database and must **not** be re-applied.

## 2. Migration filenames and SHA-256 checksums

The checksums the runner will verify against the recorded history. They must match the on-disk files byte-for-byte; a mismatch is an **abort** condition (§10).

| Version | Filename                                          | SHA-256                                                            |
| ------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| 1       | `0001_event_log.sql`                              | `dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a` |
| 2       | `0002_event_runtime_grants.sql`                   | `4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c` |
| 3       | `0003_ingestion_rejection_and_event_conflict.sql` | `407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c` |

Only versions **2** and **3** are applied by the authorized run; version **1**'s checksum is listed so the runner can confirm the existing history is intact before proceeding.

## 3. Current managed state

- Migration **`0001` applied**. Managed `qf_jarvis.schema_migration` history is expected to read exactly `[0001_event_log.sql]`.
- Migrations **`0002` and `0003` NOT applied**.
- **Managed application status: NOT AUTHORIZED / NOT EXECUTED** in Stage 3.3.5.

## 4. Credential-rotation requirement (before any future run)

Any managed **runtime** or **admin** database credential that has been exposed — printed in a shell, written to a log, pasted into a config, or otherwise observed — is considered **compromised for this purpose and MUST be rotated before the authorized run**. The deployment runtime role (`qf_jarvis_runtime`) is a deployment artifact created out-of-band; it is **never** a `CREATE ROLE … LOGIN PASSWORD` in Git. This report deliberately contains no credential of any kind.

## 5. Owner-authorization gate

The managed run proceeds **only** on an explicit, recorded authorization from the owner for **this exact scope** (`0002` then `0003`). Approval of this readiness report is **not** authorization to apply the migrations. Approval of one stage is not authorization for the next.

## 6. Required preflight evidence (captured before applying)

The authorized run must run and retain the managed **preflight** output showing:

- verified TLS (`verify-full`) to the dedicated managed project — **never** a loopback tunnel to a managed host;
- PostgreSQL major version **17**;
- the `qf_jarvis` schema present and `schema_migration` history reading exactly `[0001_event_log.sql]`;
- the deployment **runtime role exists** (the conditional grants in `0002`/`0003` require it);
- no pending advisory-lock holder and no in-progress migration.

## 7. Backup / recovery posture (required before applying)

- A verified, restorable backup (or point-in-time-recovery window) of the managed database taken **immediately before** the run, with its identifier recorded in the evidence bundle.
- Confirmation that the provider's PITR/backups are enabled and current.
- A documented restore target and the person authorized to trigger a restore.

## 8. Migration ordering and runtime-role verification (post-apply, per migration)

After `0002`, and again after `0003`, the run verifies:

- **schema_migration** now records the applied version with the on-disk checksum, appended in order (`0001` → `0002` → `0003`), with **no** rewrite of earlier rows;
- **runtime-role ownership and grants** are exactly least-privilege:
  - `0002`: runtime has `USAGE` on `qf_jarvis` and `SELECT, INSERT` on `qf_jarvis.event`, and **nothing** else (no `UPDATE`/`DELETE`/`TRUNCATE`, no `CREATE`, no sequence grant, no `schema_migration` access);
  - `0003`: runtime has **column-level** `INSERT` on only the caller columns of `qf_jarvis.ingestion_rejection` and `qf_jarvis.event_conflict`, and `SELECT` on only `sequence`/`recorded_at`; and **no** access to any content/evidence column, no `UPDATE`/`DELETE`, no ownership.

## 9. Denials, triggers, and synthetic smoke tests (post-apply)

- **`PUBLIC` / `anon` / `authenticated` / `service_role` denial verification** — none of these roles may hold `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `qf_jarvis.event`, `qf_jarvis.ingestion_rejection`, or `qf_jarvis.event_conflict`.
- **Append-only trigger verification** — a `BEFORE UPDATE OR DELETE` attempt on each of the three tables is refused.
- **Post-migration schema_migration verification** — the final history reads exactly `[0001_event_log.sql, 0002_event_runtime_grants.sql, 0003_ingestion_rejection_and_event_conflict.sql]`.

### Synthetic smoke test — one transaction, ended by `ROLLBACK` (not `DELETE`)

The tables are **append-only**: their `BEFORE UPDATE OR DELETE` triggers refuse every `UPDATE` and `DELETE`, so a smoke-test row **cannot be removed with `DELETE`**, and the current hardcoded migrations create objects only in the fixed `qf_jarvis` schema — there is **no disposable namespace** to write into. The smoke test therefore runs entirely inside **one transaction that ends with `ROLLBACK`**. Rollback is a PostgreSQL transaction abort, **not** row deletion; it leaves the append-only triggers untouched and no production content behind.

```
BEGIN;
  -- SYNTHETIC fixtures only. No live QuickFurno data.
  -- 1. Insert one synthetic event, one synthetic ingestion_rejection, one synthetic event_conflict
  --    as the runtime role, writing ONLY the caller columns.
  -- 2. Read back ONLY the fields the runtime role may read (sequence, recorded_at / accepted_at);
  --    verify sequence and recorded_at behaviour and that the rows are visible INSIDE the transaction.
  -- 3. Intentional append-only denial checks, each isolated in a SAVEPOINT so the expected error
  --    does not abort the whole transaction:
  --      SAVEPOINT s; <attempt UPDATE — expect refused>;            ROLLBACK TO SAVEPOINT s;
  --      SAVEPOINT s; <attempt DELETE — expect refused>;            ROLLBACK TO SAVEPOINT s;
  --      (repeat per table: event, ingestion_rejection, event_conflict)
  -- 4. Complete all privilege and trigger checks.
ROLLBACK;   -- the ENTIRE synthetic smoke test is discarded by transaction rollback
```

After the `ROLLBACK`, a separate **admin verification** proves **zero** synthetic smoke rows persisted in any of the three tables (a `count(*)` for the synthetic markers returns 0). If a fully-isolated run is ever wanted instead, the only supported alternative is a **separate, explicitly-authorized disposable database clone** — not a namespace inside the live database, which the current migrations do not provide.

## 10. No down migration; forward-fix only; abort conditions

- **No down migration exists.** The runner is forward-only; a mistake is corrected by a **new** forward migration, never a rollback script.
- The run **ABORTS immediately**, applying nothing further, on any of:
  - a **checksum mismatch** for any recorded or pending migration;
  - an **unexpected migration history** (missing `0001`, an out-of-order or extra recorded version, or `0002`/`0003` already present);
  - **wrong database identity** (not the dedicated QF-Jarvis managed project — QuickFurno Core's project is forbidden);
  - **wrong role** (not the intended admin identity), or missing runtime role;
  - **unexpected objects** in `qf_jarvis` beyond what `0001` created;
  - **credential uncertainty** — any doubt that credentials are current and un-exposed.

## 11. Evidence bundle for the future authorized run

The authorized run must produce, outside the repository, an evidence bundle containing: the authorization record; the pre-run backup identifier; the preflight output; the on-disk vs recorded checksums; the per-migration apply logs; the post-apply grant, denial, and trigger verification; the synthetic smoke test — its transaction `BEGIN`, the synthetic inserts, the `SAVEPOINT`-based `UPDATE`/`DELETE` denial checks, the final `ROLLBACK`, and the **post-rollback zero-row proof** (admin `count(*)` = 0 for the synthetic markers in all three tables); the final `schema_migration` history; and a statement that no live data was used and no forbidden system was touched.

## 12. Conclusion

Local and CI PostgreSQL 17 verification is complete; the migrations are byte-for-byte stable at the checksums above; the pre-conditions, verification steps, and abort conditions for a managed application are specified. This report concludes **`READY_FOR_SEPARATE_OWNER_AUTHORIZED_MANAGED_RUN`**. It does **not** claim the migrations were applied, and no managed database was contacted.
