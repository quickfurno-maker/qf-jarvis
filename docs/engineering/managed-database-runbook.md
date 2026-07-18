# Managed Database Runbook — QF-Jarvis PostgreSQL

**Status:** Managed-database readiness has been established, and migration `0001_event_log.sql` is applied to the managed database. The provider security remediation (`public.rls_auto_enable()`) has been **executed and verified**. Migration `0002_event_runtime_grants.sql` (Stage 3.3 slice 3 — least-privilege runtime grants) and migration `0003_ingestion_rejection_and_event_conflict.sql` (Stage 3.3.3 — the append-only `ingestion_rejection` and `event_conflict` audit tables) are recorded here and are **NOT yet applied to the managed database** — they await review and authorization before they are applied. The managed database carries only `0001`.
**Date:** 2026-07-12

The checklist for the **first migration** against the dedicated, Supabase-managed QF-Jarvis PostgreSQL project ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md), [ADR-0024](../decisions/ADR-0024-verified-tls-and-managed-database-preflight.md)).

> **This is the QF-Jarvis project. It is not QuickFurno Core's Supabase project, and Core's remains permanently forbidden** — no credential, no connection string, no role, no read, no write.

> **No live QuickFurno personal data may reach this database.** Phase 3 stores **synthetic Phase 2 fixtures only**. The legal classification and retention policy of a production event log is an owner-approved **hard gate on Phase 11**. Hardening the connection does not unblock the data: a safer road to a place you are not permitted to go is still a place you are not permitted to go.

---

## The order. Do these in this order.

| #   | Step                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | **Merge Stage 3.1.1**                                                                                                |
| 2   | **Owner authorizes provider hardening.** Nothing below happens without it                                            |
| 3   | **Enable and verify server-side SSL enforcement** ([below](#server-side-ssl-enforcement))                            |
| 4   | **Revoke `EXECUTE` on `public.rls_auto_enable()` from API roles** ([below](#the-remediation--executed-and-verified)) |
| 5   | **Verify `ensure_rls` remains enabled**                                                                              |
| 6   | **Re-run the Supabase security advisor**                                                                             |
| 7   | **Run standalone `pnpm db:preflight`**                                                                               |
| 8   | **Run `pnpm db:migrate`** — which **repeats the preflight automatically**                                            |
| 9   | **Verify the `qf_jarvis` schema, checksum, ownership and privileges**                                                |

---

## What must be true before the first migration

Nothing in this repository can enforce any of these. They are deployment obligations, and they are written down so they are not discovered later.

| #   | Obligation                                                                   | Why it matters                                                                                                                                                |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The migration role is not a superuser**                                    | A superuser bypasses every `REVOKE`, and can `ALTER TABLE ... DISABLE TRIGGER`. The append-only guarantee on the event log **does not bind a superuser**      |
| 2   | **The runtime role is a separate, dedicated login role**                     | Migrating is a privileged, occasional act. Serving traffic is an unprivileged, continuous one. One credential doing both is one credential that _can_ do both |
| 3   | **The runtime role does not own `qf_jarvis` or its tables**                  | A table owner can disable the immutability trigger on its own table. Ownership defeats the control from inside                                                |
| 4   | **`qf_jarvis` is NOT in Supabase's exposed-schema (Data API) configuration** | Not for debugging. Not temporarily                                                                                                                            |
| 5   | **No Supabase API key reaches event-backbone data**                          | `anon`, `service_role`, publishable — none of them. Jarvis connects as a database role, over `pg`                                                             |
| 6   | **The connection is direct or Supavisor session-mode**                       | Transaction mode breaks the migration advisory lock **silently** ([ADR-0024](../decisions/ADR-0024-verified-tls-and-managed-database-preflight.md) §5)        |
| 7   | **`QF_JARVIS_DB_CA_CERT_PATH` points at the provider's CA certificate**      | TLS is `verify-full`. There is no "encrypt but do not verify" mode                                                                                            |
| 8   | **`DATABASE_URL` carries no `sslmode` / `sslrootcert`**                      | `pg` lets those **override** the pinned `ssl` config, silently downgrading a verified connection                                                              |
| 9   | **Server-side "Enforce SSL on incoming connections" is ENABLED**             | **The client cannot check this. Ever.** See below                                                                                                             |

`pnpm db:preflight` — and `db:migrate`, which runs it automatically — check **1, 6, 7 and 8** mechanically. **They cannot check 2, 3, 4, 5 or 9.** Those are visible only from the provider's console and from how the roles were created. **A human has to confirm them, and no green preflight is evidence about any of them.**

---

## NEVER tunnel the managed database through loopback

> **A managed database must never be accessed through an SSH tunnel, a port-forward, a proxy, or any other mechanism that makes it appear as `localhost` or `127.0.0.1`.**
>
> This is not a style preference. `localhost`, `127.0.0.1` and `::1` are the **exactly three** hosts for which this code relaxes its rules, and it relaxes **two** of them at once:
>
> | Relaxed on loopback             | What tunnelling would do to it                                  |
> | ------------------------------- | --------------------------------------------------------------- |
> | **TLS may be `disabled`**       | A managed connection would be permitted to run **unverified**   |
> | **Superuser check is advisory** | A **superuser** migration role would stop failing the preflight |
>
> A tunnel would hand the managed database both exemptions **and leave every check green**. The preflight would pass. The migration would run. Nothing would go red — and the append-only guarantee on the event log, which does not bind a superuser and does not survive an unverified transport, would be resting on assumptions that had quietly become false.
>
> **The loopback exemption is safe only because loopback genuinely means "no network, disposable database".** A port-forward makes that sentence a lie while leaving the code unable to tell. **The code cannot detect this. Only you can.**
>
> **A local or CI database is disposable, and a managed one is not. Connect to the managed database directly, or through Supavisor in session mode, on its real hostname — and never through anything that renames it to `localhost`** ([ADR-0024](../decisions/ADR-0024-verified-tls-and-managed-database-preflight.md)).

---

## Server-side SSL enforcement

**An owner-authorized provider step. It must happen before the first migration.**

1. Open the QF-Jarvis project's **Database Settings** in the Supabase dashboard.
2. Find **"Enforce SSL on incoming connections"**.
3. **Confirm it is enabled. If it is disabled, enable it.**
4. **Acknowledge that changing this setting briefly reboots the managed database.** It is not a no-op, and it is not something to click in the middle of a deploy.
5. **Wait until the project reports healthy again.**
6. **Then** run `pnpm db:preflight`.

Record the verification through the **Supabase dashboard** or approved management tooling.

> ### Do NOT infer server-side enforcement from the fact that your client negotiated TLS
>
> These are two different claims, and conflating them is the entire trap:
>
> | Claim                                               | Who can verify it                                                |
> | --------------------------------------------------- | ---------------------------------------------------------------- |
> | _"**My** connection is encrypted and CA-verified."_ | The client. `pg_stat_ssl` says so, and the preflight checks it   |
> | _"**Nobody** can connect without TLS."_             | **Only the server.** The client has no visibility into it at all |
>
> A `verify-full` connection proves exactly one thing: **that** client used TLS. It says nothing about whether the server would have accepted a **plaintext** connection from a misconfigured job, a debugging session, or somebody who has the password. **`db:preflight` cannot see this, will never be able to see this, and a green preflight is not evidence of it.**

**Nothing in this repository enables it.** No Supabase Management API call is made, and no project ref or access token enters Git.

---

## The migration itself

```
# TLS trust material. PUBLIC certificate, not a secret — but deployment configuration,
# deliberately not committed, so a provider CA rotation needs no change to this repository.
export QF_JARVIS_DB_CA_CERT_PATH=/path/to/provider-ca.crt

# Routing and credentials ONLY. No sslmode. No sslrootcert.
export DATABASE_URL='postgresql://<migration-role>:<password>@<managed-host>:5432/<database>'

pnpm build
pnpm db:preflight     # step 7. Reads only. Exits non-zero if anything required is false.
```

Every required check must be `ok`. **If any fails, stop.** Nothing has been changed, and the database is exactly as it was.

```
pnpm db:migrate       # step 8. Runs the preflight AGAIN, automatically, first.
pnpm db:preflight     # step 9. Confirm the schema and history are as expected.
```

> **`db:migrate` will not migrate a database that fails its preflight**, and that is enforced by the code — not by you remembering to run step 7. It takes one client, runs the read-only preflight on it, and only then acquires the advisory lock and runs DDL.
>
> A failed preflight prints **`Managed database preflight failed`** and exits 1. That is a **different message** from **`Migration failed`**, and the difference is the point: the first means **nothing was touched**, and the second means something ran.
>
> Step 7 is still worth doing on its own. It lets you see the state and fix problems **without a migration attempt appearing in the log at all**.

`db:migrate` applies **every pending migration, in order**, each in its own transaction under the advisory lock. Against a virgin managed database that is `0001_event_log.sql` — which creates the **`qf_jarvis`** schema, the immutable `qf_jarvis.event` log, `qf_jarvis.schema_migration`, both mutation-rejection triggers, and the `REVOKE`s — and it would apply any later migration (such as `0002_event_runtime_grants.sql`) in the same run **once that migration is authorized and its runtime-role precondition is met**. It never applies a migration that is already recorded, and **it never touches `public`.** On the managed database `0001` is applied and `0002`/`0003` are not yet, so the next authorized `db:migrate` there would apply `0002` and `0003`, in that order.

### Migration `0002_event_runtime_grants.sql` — recorded, NOT yet applied

Stage 3.3 slice 3 adds a second migration, `0002_event_runtime_grants.sql`. It grants the deployment **runtime** role the _minimum_ it needs — `USAGE` on the `qf_jarvis` schema and `SELECT, INSERT` on `qf_jarvis.event`, and nothing more (no `UPDATE`/`DELETE`/`TRUNCATE`, no `CREATE`, no sequence grant, no access to `schema_migration`). The grant is conditional on the runtime role already existing, so the same migration runs unchanged on a laptop, in CI, and on the managed database. **The runtime role must be created BEFORE this migration is applied to the managed database** — it is a deployment artifact and is never a `CREATE ROLE ... LOGIN PASSWORD` in Git.

**This migration is NOT yet applied to the managed database.** It is implemented and verified against local PostgreSQL and remains **pending review**. When it is applied, the runner records it as version 2 and the append-only history then reads `0001_event_log.sql`, `0002_event_runtime_grants.sql`. Until then, the managed database carries migration `0001` alone.

### Migration `0003_ingestion_rejection_and_event_conflict.sql` — recorded, NOT yet applied

Stage 3.3.3 adds a third migration, `0003_ingestion_rejection_and_event_conflict.sql` ([ADR-0031](../decisions/ADR-0031-stage-3-3-3-rejection-and-conflict-storage.md)). It creates the two append-only, payload-free boundary audit tables — `qf_jarvis.ingestion_rejection` and `qf_jarvis.event_conflict` — with their mutation-rejection triggers, `REVOKE ALL … FROM PUBLIC`, and a conditional **column-level** runtime grant block. That block is a comprehensive clean-slate reassertion (as `0002`), extended to the two new tables: the runtime gets `INSERT` on only the caller-supplied columns and `SELECT` on only `sequence`/`recorded_at` (for `RETURNING`), and nothing else — no general `SELECT`, no sequence privilege, no `UPDATE`/`DELETE`/`TRUNCATE`/`CREATE`/`REFERENCES`/`TRIGGER`, no `schema_migration` access, no ownership. It stores **no payload, raw body, signature bytes, subject reference, validator message, or field path**. Like `0002`, its runtime grant is conditional on the runtime role existing, so the same SQL runs on a laptop, in CI, and on the managed database.

**This migration is NOT yet applied to the managed database.** It is implemented and verified against local PostgreSQL and remains **pending review**. When `0002` and `0003` are applied, the append-only history reads `0001_event_log.sql`, `0002_event_runtime_grants.sql`, `0003_ingestion_rejection_and_event_conflict.sql`. Until then, the managed database carries migration `0001` alone. **No live QuickFurno data is permitted; Phase 3 stores synthetic fixtures only, and the Phase 11 privacy/retention gate is untouched.**

---

## Provider security baseline: `public.rls_auto_enable()`

Supabase's security advisor reports a finding on a function **the provider itself installs**: `public.rls_auto_enable()`.

### What it is

|              |                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------ |
| **Function** | `public.rls_auto_enable()`                                                                       |
| **Property** | **`SECURITY DEFINER`** — it executes with the privileges of its owner, not its caller            |
| **Used by**  | The **enabled `ensure_rls` event trigger**, which calls it automatically when tables are created |
| **Owner**    | The provider. **Not QF Jarvis.**                                                                 |

### What must NOT be done

- **Do not drop `public.rls_auto_enable()`.** It is load-bearing: the `ensure_rls` event trigger depends on it, and dropping the function breaks the trigger that enforces row-level security across the project.
- **Do not disable the `ensure_rls` event trigger.** It is a security control, not a nuisance.
- **Do not change the function to `SECURITY INVOKER`.** It must run as its owner to do its job.
- **Do not put any of this in `0001_event_log.sql`, and do not make the Jarvis migration runner mutate `public`.** `qf_jarvis` is ours; `public` is the provider's. A migration that reaches into the provider's schema is a migration that will one day fight the provider's own upgrade — and it would lock a change to a schema we do not own inside a checksum-protected file we can never edit again ([ADR-0024](../decisions/ADR-0024-verified-tls-and-managed-database-preflight.md) §8).
- **Do not use Supabase's `apply_migration` for `0001`.** The Jarvis migration runner owns migration history, checksums and advisory-lock serialisation. A migration applied by a second tool is a migration the runner has no record of, and the checksum reconciliation that protects the schema is then reconciling against a lie.

### The remediation — EXECUTED AND VERIFIED

The finding is that the function is **executable by API-facing roles**. A `SECURITY DEFINER` function reachable from the Data API is a privilege-escalation surface: anyone who can call it runs code as its owner. It does not need to be callable directly by anybody — the **event trigger** invokes it, and an event trigger does not check `EXECUTE` on the function it fires.

**So the fix is to revoke direct execution, and change nothing else.** The function stays. The trigger stays. `SECURITY DEFINER` stays.

```sql
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
FROM PUBLIC, anon, authenticated, service_role;
```

**This statement has been RUN and VERIFIED on the managed database.** The verification queries below were run afterward and confirmed the four API-facing roles hold no `EXECUTE`, the `ensure_rls` event trigger is still enabled, and the function still exists as `SECURITY DEFINER`; the provider security advisor no longer reports the finding. It was a provider-console / manual operation — separate from, and never part of, the `qf_jarvis` schema migration. No project ref, access token, or connection string is recorded here.

### Verification queries

Run **after** the remediation, to prove it did what it was supposed to and nothing more.

**1. No API-facing role has `EXECUTE` — all four must be `false`:**

```sql
SELECT
  has_function_privilege('public',        'public.rls_auto_enable()', 'EXECUTE') AS public_execute,
  has_function_privilege('anon',          'public.rls_auto_enable()', 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role',  'public.rls_auto_enable()', 'EXECUTE') AS service_role_execute;
```

**2. The `ensure_rls` event trigger is still enabled** — `evtenabled` must be `'O'` (enabled, origin):

```sql
SELECT evtname, evtevent, evtenabled
  FROM pg_catalog.pg_event_trigger
 WHERE evtname = 'ensure_rls';
```

**3. The function still exists and is still `SECURITY DEFINER`** — `prosecdef` must be `true`:

```sql
SELECT p.proname, p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable';
```

**4. The provider's security advisors report no warning for this function.** Re-run the Supabase security advisor and confirm the `rls_auto_enable` finding is gone. This is the check that closes the loop — the other three prove the _mechanism_; this proves the _provider agrees_.

> **If the event trigger stops firing after the revoke, the revoke was wrong and must be reverted.** PostgreSQL does not check `EXECUTE` when an event trigger fires its function, so it should not — but "should not" is what verification is for. Query 2 and a test table creation will tell you.

---

## What this repository does and does not touch

|                                               |                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **`qf_jarvis` schema**                        | **Ours.** Created, migrated, revoked and protected by the Jarvis migration runner                                    |
| **`public` schema**                           | **The provider's.** The migration runner **never writes to it**, and the destructive test cleanup **never drops it** |
| **`public.rls_auto_enable()` / `ensure_rls`** | **The provider's.** Documented here; remediated manually, if at all; never by a Jarvis migration                     |
