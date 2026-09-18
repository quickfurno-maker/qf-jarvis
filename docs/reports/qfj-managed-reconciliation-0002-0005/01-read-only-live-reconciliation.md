# Report 01 — Read-Only Live Reconciliation of Migrations 0002 Through 0005

**Date:** 2026-07-23.
**Scope:** Reconcile the recorded state of migrations `0002`–`0005` against the **live** QF-Jarvis
managed PostgreSQL database. **Read-only. Nothing was applied, altered, granted, revoked, created or
dropped.**

> **No project ref, host, role password, connection string, access token or certificate is recorded in
> this document.**

---

## 1. Target identity — verified before anything was read

|                 |                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Project**     | **QF-Jarvis** (the dedicated project of [ADR-0023](../../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md)) |
| Region / engine | `ap-south-1` · PostgreSQL **17.6** (major **17** — matches `REQUIRED_POSTGRES_MAJOR_VERSION`)                          |
| Status          | `ACTIVE_HEALTHY`                                                                                                       |
| Database        | `postgres`                                                                                                             |
| Schema owner    | `qf_jarvis_migrator`                                                                                                   |

Two other projects exist in the same organization — **QuickFurno** and **QuickFurno Staging**. **Neither
was connected to, queried, or read.** Identity was established from the project inventory _before_ the
first query, precisely so that "the managed database" could not be assumed.

---

## 2. Access path — and why it is not the migration path

`pnpm db:preflight` was run first, as the repository-sanctioned read-only check. **It refused to
connect:**

```
Preflight refused to connect: QF_JARVIS_DB_CA_CERT_PATH is not set, and this connection is NOT loopback.
```

That refusal is correct behaviour, and it is also a finding (§5, B2): with no CA trust material present,
**the repository's own tooling cannot reach the managed database at all.** No `verify-full` connection is
currently possible from this working copy.

Every live fact below was therefore gathered through the **provider's management API**, using `SELECT`
statements only. This carries one limitation that must be read with the results:

> The management path connects as a **provider-privileged role**, not as the migration role. So the
> facts below describe **what exists in the database**. They are _not_ a statement about what the
> migration role can see or do, and they are **not a substitute for a preflight**.

---

## 3. Repository side — immutability confirmed

`sha256sum` over `packages/event-backbone/src/persistence/migrations/*.sql` reproduces
[`migration-ledger.md`](../../governance/migration-ledger.md) **exactly, for all six migrations**. No
byte of any migration has changed. `0007` remains absent.

---

## 4. Live reconciliation

### 4.1 Migration history — clean, and exactly one row

| version | filename             | checksum (live)     | applied_at (UTC)    |
| ------- | -------------------- | ------------------- | ------------------- |
| 1       | `0001_event_log.sql` | `dbca835c…f4389d6a` | 2026-07-17 11:45:52 |

**The stored checksum equals the on-disk checksum of `0001_event_log.sql` byte-for-byte.** Consequences:

- **Zero history drift.** Checksum reconciliation, missing-file detection and out-of-order detection
  would all pass against this database today.
- **No repair is needed, and none is proposed.**
- `0002`, `0003`, `0004`, `0005`, `0006` have **no** history record. Nothing is half-recorded.

### 4.2 Object inventory — nothing from 0003/0004/0005 exists

Everything in `qf_jarvis`, in full:

| Kind      | Objects                                                                                                                                                                       | Owner                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Tables    | `event`, `schema_migration`                                                                                                                                                   | `qf_jarvis_migrator` |
| Sequence  | `event_sequence_seq`                                                                                                                                                          | `qf_jarvis_migrator` |
| Indexes   | 6 (`event_pkey`, `event_event_id_unique`, `event_subject_idx`, `event_type_version_idx`, `event_correlation_id_idx`, `event_causation_event_id_idx`, `schema_migration_pkey`) | `qf_jarvis_migrator` |
| Functions | `event_reject_mutation`, `schema_migration_reject_mutation` — both **`SECURITY INVOKER`**                                                                                     | `qf_jarvis_migrator` |
| Triggers  | `event_is_immutable`, `schema_migration_is_append_only` — both **enabled (`O`)**                                                                                              | —                    |

**Absent, as expected:** `ingestion_rejection`, `event_conflict` (0003); `projection_checkpoint`,
`projection_attempt`, `rm_event_type_activity`, `rm_daily_event_acceptance` (0004);
`projection_event_position_allocator`, `projection_event_position`,
`assign_projection_event_position()` (0005). **There is no partial application of anything.**

### 4.3 Privileges — provably pre-0002

| Check                                              | Live value                                     |
| -------------------------------------------------- | ---------------------------------------------- |
| `qf_jarvis` schema ACL                             | `qf_jarvis_migrator=UC` — **and nothing else** |
| `event` / `schema_migration` ACL                   | owner-only; **PUBLIC holds nothing**           |
| `qf_jarvis_runtime` → `USAGE` on schema            | **false**                                      |
| `qf_jarvis_runtime` → `SELECT`/`INSERT` on `event` | **false / false**                              |
| `anon`, `service_role` → `USAGE` on `qf_jarvis`    | **false**                                      |

`0002` grants `USAGE` + `SELECT, INSERT`. None of it is present. **`0002` is provably unapplied, and no
grant has been made by hand** — there is no drift to reconcile on the privilege surface either.

### 4.4 Roles — the decisive result

| Role                                    | Exists  | LOGIN | Superuser                     | Bearing                                                             |
| --------------------------------------- | ------- | ----- | ----------------------------- | ------------------------------------------------------------------- |
| `qf_jarvis_migrator`                    | **yes** | yes   | **no**                        | Owns the schema and every object. Obligation 1 satisfied            |
| `qf_jarvis_runtime`                     | **yes** | yes   | no                            | **`0002`/`0003` role precondition is MET**                          |
| `qf_jarvis_projection_runtime`          | **NO**  | —     | —                             | **`0004`/`0005` role precondition is NOT MET**                      |
| `anon`, `authenticated`, `service_role` | yes     | no    | no                            | `0004`/`0005` managed-alias deny-loops will fire                    |
| `postgres`                              | yes     | yes   | **no** (holds `rolbypassrls`) | Member of `qf_jarvis_migrator` **and** `qf_jarvis_runtime` — see B3 |

### 4.5 Provider security baseline — still holds

The [runbook's](../../engineering/managed-database-runbook.md) `public.rls_auto_enable()` remediation was
re-verified live: `public`, `anon`, `authenticated` and `service_role` all hold **`EXECUTE = false`**, and
the `ensure_rls` event trigger is **enabled (`O`)**. QF-Jarvis roles own **no relation outside
`qf_jarvis`** (plus its TOAST). **`public` is untouched by this repository**, as designed.

---

## 5. Blockers

### B1 — `qf_jarvis_projection_runtime` does not exist _(highest severity)_

Every reference to that role in `0004` and `0005` sits inside a
`DO $$ … IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qf_jarvis_projection_runtime') THEN … END IF`
block. This was verified line-by-line: **there is no unconditional reference.**

So a bounded `--through 0005` run against this database today would **succeed, report success, and grant
the projection role nothing at all.** It would not error. It would not warn.

And it is not re-runnable. The migration would be recorded with its checksum, the history is append-only,
and the migration files are immutable — so the skipped grants could only ever be reproduced **by hand,
out-of-band**, leaving the managed privilege state permanently unequal to what the migration text says it
is. That is exactly the divergence the checksum reconciliation exists to prevent, arriving through the one
door it does not watch.

**Required before any run: create `qf_jarvis_projection_runtime` with correctly rotated credentials.**

### B2 — No CA trust material; the sanctioned path cannot connect

`QF_JARVIS_DB_CA_CERT_PATH` is unset, so `db:preflight` and `db:migrate` both refuse before opening a
pool. **No preflight has been run against this database from this working copy, and none can be until the
provider CA file is supplied.** A managed run cannot proceed without it, and no fact in this report
substitutes for it.

### B3 — The configured connection is not the migration identity

A `DATABASE_URL` is present in the environment. It authenticates through Supavisor in **session mode**
(port 5432 — correct; transaction mode would be refused at config construction), but its username follows
the Supavisor `<role>.<project-ref>` convention with role **`postgres`** — **not `qf_jarvis_migrator`**.

_(Stated as inference from the username convention. It was **not** confirmed by connecting: doing so would
have required an unverified TLS downgrade that [ADR-0024](../../decisions/ADR-0024-verified-tls-and-managed-database-preflight.md)
forbids, and this reconciliation is not worth breaking that rule for.)_

If correct, applying `0002`→`0005` over that connection would mean:

- **The preflight would not catch it.** `postgres` is **not** a superuser on this project, so the required
  "migration role is not a superuser" check **passes**. The guard is aimed at privilege, and this is a
  failure of _identity_.
- **Split ownership.** Every object created by `0003`, `0004` and `0005` would be owned by `postgres`,
  while `0001`'s objects remain owned by `qf_jarvis_migrator`. One schema, two owners.
- **`0005`'s `SECURITY DEFINER` function would run as `postgres`** — a role holding `rolbypassrls` and
  membership in `anon`, `authenticated`, `service_role` and `authenticator` — rather than as the migrator.
  The runbook's instruction for `0005` is explicit: _"Confirm the owning role is correct in managed before
  applying."_ On the evidence available, it is not.

**Verify the migration identity is `qf_jarvis_migrator` before any run.**

### B4 — The credential must be rotated

The connection string, including its password, is present in the shell environment of this session. The
runbook's standing rule applies without exception: _"any credential that has appeared in a shell, a log,
or a config is compromised for this purpose and must be rotated."_

---

## 6. Risks this reconciliation retires

### R1 — `0005`'s table lock and backfill are currently free

**`qf_jarvis.event` contains 0 rows** (56 kB total relation size).

- The `LOCK TABLE qf_jarvis.event IN SHARE ROW EXCLUSIVE MODE` window and the dense `1..N` backfill are
  **effectively instantaneous**. The runbook's "not free … must be scheduled in a maintenance window"
  concern **does not apply to the managed database in its current state**.
- ADR-0036's **historical-backfill limitation is moot here**: the backfill cannot fail to reconstruct
  pre-`0005` commit order, because there is no pre-`0005` history to reconstruct. Every position the
  managed database will ever hold would be assigned by the trigger, in true commit order.

**Both statements are true only while the table is empty, and expire the moment the first event is
ingested.** They are a reason to sequence `0005` _before_ ingestion, not a permanent property.

### R2 — There is nothing to reconcile

No checksum drift, no history gap, no out-of-order record, no orphan object, no stray grant, no
half-applied migration, no PUBLIC exposure, no disabled trigger. The managed database is in a textbook
`0001`-only state, and **every Managed-DB status claim in the migration ledger for `0002`–`0005` is
confirmed live.** The ledger requires no correction.

---

## 7. What SQL still cannot tell you

Unchanged, and still human obligations:

| #   | Obligation                                                 | Why it stayed unverified                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Server-side **"Enforce SSL on incoming connections"**      | **No client can ever see this.** Not verified here, and a green anything is not evidence of it                                                                                                                                                                               |
| 4   | `qf_jarvis` absent from the Data API exposed-schema config | The `authenticator` role carries no `pgrst.db_schemas` override, so the value lives in project settings — dashboard-only. _(Mitigating, not substituting: the schema ACL grants `anon`, `authenticated` and `service_role` nothing, so exposure alone would reach no data.)_ |
| 5   | No Supabase API key reaches event-backbone data            | Not observable from inside the database                                                                                                                                                                                                                                      |

---

## 8. Verdict

**BLOCKED / QFJ_MANAGED_0002_0005_RECONCILED_CLEAN_PRECONDITIONS_UNMET**

The database is **clean** — that question is now settled with live evidence rather than inference. The
bounded `0002`→`0005` run remains blocked, and on preconditions rather than on drift:

1. **B1** — create `qf_jarvis_projection_runtime` (rotated credentials), or `0004`/`0005` grant nothing,
   irreversibly and silently.
2. **B2** — supply the provider CA so a real preflight can run.
3. **B3** — confirm the migration identity is `qf_jarvis_migrator`, not `postgres`.
4. **B4** — rotate the exposed credential.

Then, unchanged from [the boundary slice](../qfj-managed-migration-boundary/03-readiness-verdict-and-managed-application-boundary.md):
reviewed managed-readiness for `0004` **and** `0005`, and **explicit owner authorization for the full
`0002`→`0005` scope**. `0006` remains out of scope, and `--through 0005` excludes it by construction.

---

## 9. What this task did not do

- **Applied nothing.** No migration, no DDL, no grant, no revoke, no role creation, no history write.
- **Acquired no advisory lock. Ran no `db:migrate`.** The only repository command executed was
  `pnpm db:preflight`, which **refused to connect** and reached no database.
- **Wrote nothing to any database.** Every statement issued was a `SELECT` against catalogs.
- **Touched no QuickFurno or QuickFurno Staging project** — not a query, not a connection.
- **Changed no migration file** (all six checksums byte-exact), **created no `0007`**, and modified no
  code, test, or lockfile.
