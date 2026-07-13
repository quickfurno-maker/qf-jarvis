# ADR-0024 — Verified TLS and Managed Database Preflight

**Status:** **Accepted** — approved by the owner on 2026-07-13.
**Date:** 2026-07-12
**Accepted:** 2026-07-13
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

**Depends on:** [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) (PostgreSQL, `pg`, migrations) · [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) (the dedicated managed project, the `qf_jarvis` schema, connection modes)

---

## Owner decision

**Keshav Sharma (Founder, QuickFurno — business owner) accepted this ADR on 2026-07-13**, for commit and pull-request review, on the following boundaries.

**What is decided:**

- **Every managed / non-loopback PostgreSQL connection requires certificate-verified TLS.** There is no "encrypt but do not verify" mode, and `rejectUnauthorized: false` is unrepresentable.
- **`db:migrate` enforces the preflight automatically.** It is a gate the code runs, not a step an operator is trusted to remember.
- **Direct or Supavisor session mode only. Transaction mode remains prohibited.**
- **Server-side SSL enforcement remains a provider deployment obligation.** No client can verify it, and this repository does not enable it.
- **Provider security hardening remains separately authorized** — including the `public.rls_auto_enable()` privilege revoke, which is recorded and not executed.
- **QuickFurno Core's Supabase project remains permanently forbidden** — no credential, no connection string, no role, no read, no write.
- **No live personal data may reach the managed database before the Phase 11 privacy gate.**

**What acceptance does NOT authorize.** Accepting this ADR settles the _design_. It connects nothing. It does not authorize connecting to the managed QF-Jarvis database, changing any Supabase setting, executing the `public.rls_auto_enable` revoke, applying migration `0001`, creating managed database roles, or starting Stage 3.2. **Each of those remains separately owner-authorized** ([managed-database-runbook.md](../engineering/managed-database-runbook.md)).

### The loopback superuser exception, accepted narrowly

The superuser check is **required off loopback and advisory on loopback** (§6). That exception is accepted, and it is accepted _narrowly_:

- **A managed / non-loopback migration role must not be a superuser.** This is enforced, and it fails the preflight.
- **A disposable local or CI loopback database may report superuser status without blocking**, because the official `postgres` image makes `POSTGRES_USER` a superuser.
- **The exception exists only for disposable local and CI environments.** It is not a general relaxation.
- **A green local or CI preflight is not evidence of compliant managed-role privileges.** It is evidence about a throwaway database, and nothing more.

> ### A managed database must never be made to look like loopback
>
> **A managed database must never be accessed through an SSH tunnel, port-forward, proxy, or any other mechanism that makes it appear as `localhost` or `127.0.0.1`** — because doing so would present a managed database to this code as a loopback one, and **silently claim both exemptions at once**: TLS would become optional, and the superuser check would stop being required.
>
> The loopback exemption is safe _only_ because loopback genuinely means "no network, throwaway database". A tunnel makes that sentence false while leaving every check green. **This is a prohibition on the operator, because it is the one hole the code cannot see.**

---

## Context

[ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) provisioned a dedicated, Supabase-managed PostgreSQL project for QF Jarvis and settled _which_ database and _which connection modes_. It did not settle **how the connection is trusted**, and it said so: _"Establishing and proving the connection mode and the TLS configuration a managed provider requires — which a loopback database does not — belongs to the stage that first connects, and is not claimed as done."_

This is that stage, and it must be done **before** the first managed migration, not during it.

Three facts make this more than a checkbox.

**One.** Every connection so far has been to `127.0.0.1`. Loopback has no network to be intercepted on, so the absence of TLS has cost nothing and proved nothing. The moment `DATABASE_URL` points at a managed host, the connection crosses a network — and _"it is probably fine"_ is not a threat model.

**Two.** `sslmode=require` looks like the answer and is not. **It encrypts and verifies nothing.** It accepts any certificate from anybody, so it stops a _passive_ eavesdropper and does exactly nothing about an _active_ one: an attacker who can answer for the host presents a self-signed certificate, and `require` shakes their hand. It is not a weaker version of TLS. It is a different thing that happens to share a spelling with it.

**Three — and this is the one that would have bitten us.** `pg` parses the connection string with `pg-connection-string`, and **an `sslmode` in the URL overrides the `ssl` object the pool was given.** A carefully validated, CA-pinned `verify-full` configuration can be **silently downgraded** by six characters in an environment variable. Nothing errors. Nothing logs. The connection is encrypted, unverified, and reported as healthy. A security control that can be turned off by a value it does not inspect is not a control.

There is a fourth, discovered while building this and worth recording plainly: **`describeConnectionTarget` printed the full hostname.** A Supabase direct host is `db.<project-ref>.supabase.co` — so the very first managed `db:migrate` would have written the project ref, which the owner has ruled must never appear in Git or a log, straight into the deploy output. That is fixed here.

## Decision

**Explicit, fail-closed, certificate-verified TLS for every non-loopback connection — and a read-only preflight before every managed migration.**

### 1. TLS is a discriminated union, and the unsafe option does not exist

```ts
type TlsConfig = { mode: 'disabled' } | { mode: 'verify-full'; caCertificatePem: string };
```

**There is no `rejectUnauthorized` field, so `rejectUnauthorized: false` is unrepresentable.** Not discouraged, not linted against, not caught in review — _unrepresentable_. The pool translates `verify-full` into `{ ca, rejectUnauthorized: true }` and `disabled` into `false`, and there is no third branch because there is no third case. The compiler, rather than a reviewer's attention on a Friday, is what keeps the unsafe configuration from appearing one day.

### 2. Loopback may go bare. Nothing else may.

| Target                                                    | Policy                                                 |
| --------------------------------------------------------- | ------------------------------------------------------ |
| **`localhost`, `127.0.0.1`, `::1`** — exactly these three | `disabled` **permitted**                               |
| **Anything else**                                         | **`verify-full` required.** `disabled` is a hard error |

The asymmetry is the point. On loopback there is no network to intercept, and demanding a certificate would mean **committing a CA to the repository so a laptop can trust itself**. Off loopback there is always a network.

**The default is `disabled`, and that default is safe _only because_ the non-loopback case then fails.** Omitting TLS for a managed database does not quietly open a plaintext connection; it raises `DatabaseTlsError`. Fail-closed means the lazy path is the loud path.

#### `postgres` was on this list, and it should not have been

It was admitted as "the Compose service name", reasoning that a container talking to a sibling container is the same trust situation as a laptop talking to itself.

**That reasoning is wrong.** `postgres` is a **DNS name, not a loopback address.** It resolves to whatever the resolver says it resolves to — and a hostname a resolver controls is a hostname an attacker who controls the resolver controls. The connection crosses a network. A connection that crosses a network gets TLS.

**A connection to `postgres:5432` now requires `verify-full`, and therefore fails without a CA.** Nothing in this repository connects that way — `compose.yml` publishes to `127.0.0.1:55432` and CI connects to `127.0.0.1:5432` — so nothing breaks. The hole was open, and it is closed.

**Matching is exact**, after lowercasing and stripping IPv6 brackets. `0.0.0.0` is a _bind_ address, not a destination. `localhost.example.com` is not `localhost`. `notlocalhost` is not `localhost`. `sub.localhost` is registrable in plenty of environments. **A substring or suffix test here would be the bug**, because "contains localhost" is how an allowlist stops being one.

### 3. The CA lives outside Git

`QF_JARVIS_DB_CA_CERT_PATH` is **mandatory for any non-loopback connection**. The CLIs read it at the process boundary, load the PEM, and pass the contents into `createDatabaseConfig`. **Library code still reads no environment.**

**The CA certificate is public trust material, not a secret.** It could be committed without leaking anything. It is still kept out of the repository, for a different reason: it is **deployment configuration**, and a provider rotating its CA must not require a commit to this repository. Infrastructure-specific material in Git is how a codebase acquires a second, undocumented deployment coupling.

#### The bundle is PARSED as X.509, not pattern-matched

Using Node's built-in `X509Certificate` — **no dependency added**.

A regex over PEM headers catches an empty file and an HTML error page from a proxy, which are the _common_ failures. It does not catch the _dangerous_ ones:

- **Random bytes wrapped in PEM headers.** Passes a regex. Parses as nothing. Would have failed at handshake time, in production, with an error message about something else.
- **A truncated download.** Same.
- **A perfectly valid _leaf_ certificate**, with `CA:FALSE`. This is the nasty one: it parses, it is real, it is somebody's genuine certificate — and it is **useless as a trust anchor**. A regex has no opinion about it. `X509Certificate.ca` does.

So: every `CERTIFICATE` block is extracted and parsed; **any block that fails to parse rejects the entire bundle** (a bundle we only partly understand is a trust decision made on incomplete information); **at least one certificate must have `ca === true`**; text outside the blocks is refused (only whitespace is permitted); a `PRIVATE KEY` block is refused with its own message, because pasting one there is a real mistake and a generic "not a PEM" would send someone looking in the wrong place. **The original PEM bundle is preserved byte-for-byte** for the `pg` `ssl` object — re-serialising trust material from parsed objects is a way to introduce a bug into the one thing that must not have one.

**This is syntax and CA-purpose validation, and nothing more.** Expiry, chain building and hostname verification remain **the TLS handshake's job**, where they belong. Doing them twice in two places is how the two places end up disagreeing.

It **fails closed** when the variable is unset, the file is missing or unreadable, the file is empty, no block parses, no parsed certificate is a CA, there is text outside the blocks, or a private key is present. Each of those is an ordinary deployment failure — an unset variable, a bad mount, a truncated download, the wrong file — and none may become "connect anyway".

**The errors name what is wrong and nothing about what is in the file:** no subject, no issuer, no fingerprint, no serial, no PEM contents, no path. A CA certificate is public trust material, so none of that would be a breach — but an error handler that habitually dumps what it just rejected is a _habit_, and habits get applied to material that is secret. A one-based block index is enough for anyone to find the offending block themselves.

### 4. TLS parameters in the URL are refused

A connection URL carrying **`sslmode`, `sslcert`, `sslkey`, or `sslrootcert`** is rejected, because `pg` lets them **replace** the explicit `ssl` object (see Context, fact three).

**The URL carries routing and credentials. TLS policy comes from the validated configuration.** The two cannot coexist, because if they coexist the URL wins and nobody finds out.

### 5. Direct and session-mode only — unchanged, and now interacting correctly with TLS

[ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) §6 stands in full: **Supavisor transaction mode is refused**, because advisory locks, `statement_timeout` and `application_name` are all session-scoped. Perfect TLS does not redeem it. A future component may introduce a transaction-mode connection **only after proving** it depends on no advisory lock, no prepared statement and no session state — and the migration and projection runners will never qualify.

### 6. The preflight is an ENFORCED gate on `db:migrate`, not an advisory command

**`db:migrate` runs the preflight itself, automatically, before it takes the advisory lock and before any DDL. A failed preflight aborts the migration.** It is not a step an operator is trusted to remember.

An earlier draft of this ADR made it advisory and accepted, as a negative, that "an operator may forget it". **That was a control that depended on a human following a checklist, which is to say it was not a control.** It has been replaced by one the code enforces.

```
1. loadMigrationFiles(directory)      ← no connection yet. A bad filename needs no database.
2. withClient(pool)                   ← ONE client, for everything below.
3. runPreflightOnClient(client)       ← BEGIN TRANSACTION READ ONLY … ROLLBACK
4. if (!report.passed) throw          ← nothing after this line runs
5. runMigrationsOnClient(client)      ← pg_advisory_lock, bootstrap, DDL
```

**Step 5 holds the first statement that can change anything** — the advisory lock, the `CREATE SCHEMA`, the `REVOKE`s, the migration. It is unreachable from a failed preflight. And there is **no ordering to get wrong at a call site**, because there is no call site: `migrateWithPreflight` is the only exported path to a migration, and it runs both.

**One client, not two.** The preflight runs on **the same session** the migration then uses. A preflight on one connection and a migration on another has verified a connection that is not the one about to write — different backend, possibly different role, possibly different TLS. That is a check that merely _looks_ like a check. **The configuration is never rebuilt**, either: `migrateWithPreflight` takes the `DatabaseConfig` the pool was built from, so the thing checked and the thing used are the same object.

**`pnpm db:preflight` remains**, as a standalone, read-only inspection command. It reports every failed check rather than throwing on the first, because _telling you what is wrong_ is its job. Throwing is the gate's job.

**The two failures are reported differently, and that difference matters at 2am:**

| Message                                 | Means                                               |
| --------------------------------------- | --------------------------------------------------- |
| **`Managed database preflight failed`** | **Nothing was touched.** No lock, no schema, no DDL |
| **`Migration failed`**                  | Something ran, and rolled back                      |

What it verifies, **without changing anything**:

| Check                                                                                                                       | Required                        |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| PostgreSQL **major version is 17** (the patch level is the provider's, and is not asserted)                                 | ✅                              |
| **TLS is active on this connection** — read from `pg_stat_ssl` for _this backend_, not from what the server merely supports | ✅ **off loopback**             |
| The **connected role is not a superuser**                                                                                   | ✅ **off loopback** (see below) |
| Connection mode is direct or session — never transaction                                                                    | ✅                              |
| Database name, and the **redacted** target                                                                                  | ✅                              |
| `qf_jarvis` schema state, and migration-history state if present                                                            | reported                        |

**The gate itself runs everywhere — loopback included.** Two of its _conditions_ are managed-only, and the superuser one needs explaining rather than glossing: **the official `postgres` Docker image creates `POSTGRES_USER` as a superuser.** That is true of the `compose.yml` this repository ships and of the CI service container. Requiring a non-superuser on loopback would fail the documented _"clone, compose up, `pnpm check`"_ path on every developer's first run, and fail CI — not because anything is wrong, but because a throwaway loopback database is a throwaway loopback database. **The obligation is about the managed deployment role, so it is enforced there.** On loopback the fact is still _reported_, so it stays visible; it just does not block a laptop.

**It cannot write, and that is enforced rather than promised.** Every query runs inside `BEGIN TRANSACTION READ ONLY`, which is then rolled back. A stray `CREATE`/`INSERT`/`UPDATE`/`DELETE` — now or in a future edit — does not quietly succeed: **PostgreSQL refuses it**, SQLSTATE `25006`. A comment saying "this function is read-only" is a promise made by whoever wrote it. A read-only transaction is a promise made by the database.

**It fails closed.** There is no warning tier, because a warning in a deploy log is read once and never again.

### 7. Nothing printed identifies the target

**The hostname of a managed database _is_ sensitive here**, and that is not obvious: `db.<project-ref>.supabase.co` contains the project ref.

- **Loopback** → `127.0.0.1:55432/qf_jarvis_test`. Useful, identifies nothing.
- **Anything else** → `«managed host redacted»:5432/postgres`. Port and database survive, because an operator needs to know _which database_; neither identifies the project.

Never the URL, the username, the password, the CA path, or the CA contents. **The CA path is redacted too** — on a managed platform it is routinely a mount point named after the project or the environment, and an error message is the most reliable way for a string to reach a log aggregator a wider group can read.

### 8. Server-side SSL enforcement must be ON, and the client cannot tell you that it is

**Before the first managed migration, "Enforce SSL on incoming connections" must be enabled in the provider's database settings** — an owner-authorized provider step, recorded in [managed-database-runbook.md](../engineering/managed-database-runbook.md).

**Do not infer server-side enforcement from the fact that this client negotiated TLS.** They are different claims, and conflating them is the whole trap:

| Claim                                                    | Who can verify it                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| _"**My** connection is encrypted and CA-verified."_      | The client. `pg_stat_ssl` says so, and the preflight checks it       |
| _"**Nobody** can connect to this database without TLS."_ | **Only the server.** The client has no visibility into it whatsoever |

A client that connects with `verify-full` proves exactly one thing: _that client_ used TLS. It proves nothing about whether the server would have accepted a **plaintext** connection from someone else — a misconfigured job, a debugging session, an attacker with the password. **The preflight cannot see this, will never be able to see this, and must not be read as covering it.**

Enabling it **reboots the managed database briefly**, which is why it is an owner-authorized step with a wait-for-healthy afterwards rather than something to click during a deploy.

**This ADR does not enable it, and nothing in this repository calls the Supabase Management API.** No project ref, no access token, no management credential enters Git.

### 9. Provider baseline hardening is a deployment obligation, and stays outside the migration

The provider's own security advisor reports a finding on `public.rls_auto_enable()`. **The remediation is recorded in a runbook and is not executed by this repository** ([managed-database-runbook.md](../engineering/managed-database-runbook.md)).

**It must not go into `0001_event_log.sql`, and the Jarvis migration runner must never mutate `public`.** Those are two different things with two different owners: `qf_jarvis` is _ours_, and `public` is the _provider's_. A migration that reaches into `public` to fix a provider's object is a migration that will one day fight the provider's own upgrade — and it would put a change to a schema we do not own inside a checksum-locked file we cannot edit afterwards.

### 10. The boundary and the privacy gate are untouched

**QuickFurno Core's Supabase project remains permanently forbidden** — no credential, no connection string, no role, no read, no write ([ADR-0001](./ADR-0001-source-of-truth-boundary.md), [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §2, [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) §2).

**No live QuickFurno personal data may reach the managed database before the Phase 11 privacy and retention decision.** Phase 3 stores synthetic Phase 2 fixtures only. Hardening the connection does not unblock the data: **a safer road to a place you are not permitted to go is still a place you are not permitted to go.**

## Consequences

**Positive.**

- **The unsafe configuration is unrepresentable**, not merely prohibited. `rejectUnauthorized: false` has no field to live in.
- **The silent-downgrade path is closed.** An `sslmode` in the URL is now a loud error rather than a quiet override of a security control.
- **The preflight is a gate the code enforces**, not a checklist item. It cannot be skipped, forgotten, or run against a different connection than the one that migrates.
- **A leaf certificate can no longer be mistaken for a CA.** That failure would have surfaced at handshake time, in production, as an error about something else.
- **The project ref can no longer leak through a log line.** It could have, on the very first managed `db:migrate`.

**Negative — accepted.**

- **Deploying now requires a CA certificate to be provisioned.** That is a real operational step, and it will be the first thing that breaks a deployment. It breaks it _loudly_, which is the trade being made.
- **`db:migrate` now opens the database twice conceptually** — a read-only transaction, then the migration — on one connection. That is a few milliseconds and one more round trip on every migration, forever, in exchange for never migrating a database nobody checked.
- **The superuser check does not bind loopback**, because the `postgres` Docker image makes `POSTGRES_USER` a superuser and a required check would fail every developer's first run. It is reported there, not enforced. **The check that matters is the managed one, and that one is enforced** — but a reader should not mistake a green local preflight for evidence about the production role.
- **Server-side SSL enforcement cannot be verified by this code, ever.** A client can prove _its own_ connection used TLS. It cannot prove the server would refuse a plaintext one. That check lives in the provider's console, and the runbook is the only place it can live.
- **A future component wanting a transaction-mode pooler must do real work to get one**, and some legitimately efficient design will be refused until it proves it needs no session state.
- **The `public.rls_auto_enable()` remediation is not automated.** It is a documented manual step against the provider's schema, and it will therefore be forgotten unless the runbook is followed. Automating it would mean this repository writing to a schema it does not own, which is worse.

## Alternatives rejected

**`sslmode=require`.** Rejected. It encrypts without verifying anybody, which defeats a passive attacker and not an active one, and would let a machine-in-the-middle read and rewrite the event log's contents in flight. It is the single most common way a database connection is "secured".

**`rejectUnauthorized: false` with a warning comment.** Rejected outright. It is `sslmode=require` wearing a TypeScript costume. Every codebase that contains it acquired it as a temporary measure.

**Node's default CA bundle, with no pinning.** Tempting, and it would work today: the provider's certificate chains to a public root. Rejected because it silently accepts _any_ certificate that any public CA has ever issued for that hostname, which is a materially larger trust set than "the certificate my provider actually uses". Pinning the provider's CA costs one deployment variable.

**Committing the CA certificate.** Rejected — not on secrecy (it is public), but on coupling: a provider CA rotation would then require a commit, a review and a deploy of _this_ repository to fix an _infrastructure_ change.

**Automating the `public.rls_auto_enable()` fix inside migration 0001.** Rejected. It would put a change to the **provider's** schema inside a **checksum-locked** file that can never be edited afterwards, and would make the Jarvis migration runner a thing that mutates `public` — which it must never be.

**Leaving the preflight advisory.** Rejected — and it had been the earlier draft's position, on the grounds that an automatic preflight would open a second connection and blur the two failure modes in a log. **Both objections were solvable, and neither was worth the cost of being wrong.** The connection is not doubled: the preflight and the migration share one client. The failure modes are not blurred: _"Managed database preflight failed"_ and _"Migration failed"_ are distinct messages, and the first explicitly says nothing was touched. What is left of the original argument is that it is slightly more code — against a control that otherwise depends on a human remembering a checklist, which is not a control.

**Making the superuser check required on loopback too.** Rejected, with a real cost accepted. It would have meant reworking `compose.yml` and the CI service to create a non-superuser role, because the `postgres` image makes `POSTGRES_USER` a superuser — a change to two deployment surfaces to enforce a rule about a third. The check is enforced where the obligation exists (the managed database) and reported where it does not.
