# ADR-0023 — Dedicated Supabase-Managed PostgreSQL for QF Jarvis

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

**Supersedes:** [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §1 — **the deployment-provider assumption only** ("Production on a VPS — a single instance, alongside the Jarvis service"). **Every other decision in ADR-0019 stands unchanged**, and §2 in particular is reinforced rather than relaxed.

---

## Context

[ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) decided **PostgreSQL 17, as Jarvis's own database, raw SQL through `pg`, no ORM**. That decision was about the **engine** and the **boundary**. In one line of a table it also assumed a **provider** — a self-hosted instance on a VPS — and that assumption was never argued, because nothing at the time depended on it.

It does now. A **dedicated Supabase project has been provisioned exclusively for QF Jarvis**: its own project, its own database, its own credentials, its own backups, its own blast radius. PostgreSQL major version 17, matching local development and CI.

**This is not QuickFurno Core's Supabase project, and it must never become it.**

That sentence carries the whole risk of this ADR, so it is worth being precise about what changed and what did not. ADR-0019 §2 rejected _QuickFurno's_ Supabase — **on the boundary, not on the technology**. It said so explicitly: _"This is not a comment on Supabase, which is fine."_ The objection was never to a managed Postgres provider; it was to **sharing a database with the system Jarvis is forbidden to write to**. A separate Supabase project shares nothing with Core's — not a database, not a credential, not a network, not a role.

The danger is that "QF Jarvis uses Supabase" and "QuickFurno Core uses Supabase" are one word apart and one mistake apart. This ADR exists to make the distinction explicit and permanent, rather than leave it to be inferred by whoever next reads a connection string.

## Decision

**Supabase is adopted as the managed PostgreSQL provider for QF Jarvis's own database, and as nothing else.**

### 1. Supabase is a Postgres host. It is not a platform we are adopting.

QF Jarvis uses **exactly one** thing from Supabase: **a PostgreSQL 17 database, reached over the wire by the `pg` driver using `DATABASE_URL`.**

**Explicitly not used, in Stage 3.1 and not without a superseding ADR:**

- **Supabase Auth** — Jarvis authorizes nothing. Authorization is QuickFurno Core's ([ADR-0001](./ADR-0001-source-of-truth-boundary.md), [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md)).
- **Supabase Storage** — Jarvis stores no files.
- **Supabase Realtime** — Phase 3 is checkpoint-driven and deliberately broker-free ([ADR-0021](./ADR-0021-processing-retries-dead-letters-and-replay.md)). A realtime channel is a second delivery path with a second durability boundary.
- **Supabase Edge Functions** — Jarvis executes nothing. Execution is n8n's, on Core's authority.
- **The Data API (PostgREST).** See §4: the schema is never exposed through it.
- **Supabase client SDKs.** **`@supabase/supabase-js` must not be added.** It is a client for Auth, Storage, Realtime, and PostgREST — every one of which is a capability this ADR declines. Adding it would import the platform in order to use the database, and the database is already reachable.

**The driver stays `pg`. The configuration stays `DATABASE_URL`.** Nothing in the application knows it is talking to Supabase, and nothing in it should. That is the property that keeps this a _provider_ decision rather than an _architecture_ decision — and the property that makes it reversible.

### 2. The boundary is unchanged, and this ADR strengthens it

|                                        |                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| **QuickFurno Core's Supabase project** | **Forbidden.** No credential, no connection string, no role, no read, no write     |
| **QuickFurno business tables**         | **Forbidden.** Jarvis reads none and writes none                                   |
| **QF-Jarvis Supabase project**         | Jarvis's own database. Its own project, credentials, schema, backups, blast radius |

ADR-0019 §2 required "its own instance, its own credentials, its own schema, its own backup, and its own blast radius." **A dedicated Supabase project satisfies every clause of that requirement.** The separation ADR-0019 demanded is not weakened by this ADR; it is the reason this ADR is permissible at all.

**A shared database is an integration point, and an integration point is one `UPDATE` away from being a write path.** That has not stopped being true because the provider is now named. If Jarvis ever holds a credential to Core's project, this ADR has been violated, regardless of how convenient the reason was.

### 3. Everything QF Jarvis owns lives in a private schema: `qf_jarvis`

**Nothing lives in `public`. Not the event log, not the migration history, not a function, not a trigger.**

`public` is the shared, world-facing default. On a managed provider it is the schema an exposed Data API reaches for first, and on any PostgreSQL it is the schema every other tool assumes it may write to. **An immutable event log has no business living in a room with an unlocked door.**

A private schema also makes the access question answerable in **one place**: revoke `USAGE` on the schema, and every object inside it becomes unreachable by name — regardless of what grants a provider hands to its own roles by default, now or in a future platform release. One revoke is worth more than a hundred table grants, because a hundred table grants have to be remembered when the hundred-and-first table is added.

```sql
REVOKE ALL ON SCHEMA qf_jarvis FROM PUBLIC;
-- and, only where they exist, from anon / authenticated / service_role — see §5.
```

**Nothing depends on `search_path`.** Every object is fully qualified — in the migrations, in the migration runner, in the tests, and in every diagnostic query. An ambient `search_path` is a global variable set by whoever connected last, and **correctness that rests on one fails the day a pooler hands back a different session.** This is not a style preference; it is the same class of bug as §6.

The schema is created by the migration runner's **bootstrap**, under the advisory lock, before the history table it must read. That bootstrap is stated openly rather than hidden in a `0000_` migration.

### 4. The Data API stays closed; the runtime role and the migration role are different roles

**These are deployment obligations. Stage 3.1 cannot discharge them, and does not pretend to.**

| Obligation         |                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The Data API**   | **`qf_jarvis` must never be added to Supabase's exposed-schema configuration.** Not "for debugging", not "temporarily"                                                                                                                     |
| **API keys**       | **No Supabase API key — `anon`, `service_role`, publishable, or otherwise — may be used to reach event-backbone data.** There is no supported path; there must not be an unsupported one                                                   |
| **Runtime access** | A **dedicated PostgreSQL login role**, created at deployment. Not the owner, not a superuser                                                                                                                                               |
| **Ownership**      | **The runtime role must not own the schema or its tables.** A table owner can `ALTER TABLE ... DISABLE TRIGGER`, which defeats the immutability trigger entirely                                                                           |
| **Superuser**      | **Neither the runtime role nor the migration role may be a superuser.** A superuser is not constrained by grants, and no `REVOKE` in this repository binds one                                                                             |
| **Separation**     | **The migration role and the runtime role are separate responsibilities.** Migrating is a privileged, occasional act; serving traffic is an unprivileged, continuous one, and one credential doing both is one credential that can do both |

**`service_role` deserves a specific prohibition**, because it is the credential most likely to be reached for and least likely to be understood: it **bypasses row-level security entirely**. Jarvis connects to PostgreSQL directly, as a database role. There is no circumstance in Phase 3 in which acquiring a service-role key is the right answer.

**Stage 3.1 creates no password-bearing login role, and commits none.** Roles are a deployment artifact. A `CREATE ROLE ... LOGIN PASSWORD '…'` in a migration is a credential in Git, and there are none.

### 5. Three databases, one schema, and they must not diverge

| Environment            | Database                                           | Purpose                                                                   |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| **Local development**  | Portable/Compose **PostgreSQL 17**, loopback       | The developer's database and the destructive test database                |
| **CI**                 | **GitHub Actions PostgreSQL 17 service container** | The integration-test database. Ephemeral, disposable, CI-only credentials |
| **QF-Jarvis Supabase** | **Managed PostgreSQL 17**                          | Jarvis's own deployed database                                            |

**Local and CI are unchanged by this ADR.** Supabase is not a development database and is not a test database. Nothing in the test suite may point at it — see §8.

**The same forward-only migrations must produce the same schema in all three**, and that is a requirement, not a hope. It is achievable because the migrations are **plain SQL against stock PostgreSQL 17**: no Supabase extension, no `auth.*` schema, no RLS policy, no PostgREST-shaped table.

**This is why the revocation of `anon`, `authenticated` and `service_role` is written as a conditional `DO` block.** Those roles are _Supabase's_. They do not exist on a laptop, so an unconditional `REVOKE ... FROM service_role` is a **hard error** locally and in CI. The migration therefore checks `pg_roles` first and revokes only from roles that exist — so **the identical SQL runs everywhere**. A migration that only runs on the provider would mean the thing CI proved is not the thing production runs, which is the _exact_ failure ADR-0019 rejected when it refused a SQLite/PostgreSQL dual dialect.

**The revoke re-runs on every migration**, deliberately. A provider that re-grants to its own roles during a platform upgrade would otherwise silently re-open the door, and **nothing would go red**.

### 6. Connection mode: direct or session-mode only. Never transaction-mode.

**This is the one place where "it is just Postgres" is not quite true, and it must be recorded rather than discovered.**

The persistence package depends on **session state**, in more places than the migration runner:

| What depends on it                        | Why a transaction-mode pooler breaks it                               |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `pg_advisory_lock()` — the migration lock | Session-scoped. Taken on one backend, released on another — or leaked |
| **Projection advisory locks** (Stage 3.4) | Same. The projection would silently stop being exclusive              |
| `statement_timeout`, set on connect       | A session-level `SET` does not reliably survive the multiplexing      |
| `application_name`, set on connect        | Same. Attribution in `pg_stat_activity` becomes unreliable            |
| Any future session-level configuration    | Same                                                                  |

**Therefore the QF Jarvis persistence package supports:**

- **direct PostgreSQL connections**; or
- **Supavisor session-mode connections** (port `5432`).

**It does not support Supavisor transaction-mode connections** (port `6543`).

**This is enforced in `createDatabaseConfig`, not in the migration CLI** — so it holds for _every_ pool the package creates, including the ones a future ingestion path or projection runner will open. A rule that guards only `db:migrate` guards the one caller that was already being careful. The error names the rule and **never the URL, the host, or the password**.

**It throws rather than warns because the failure is silent.** Under transaction pooling the migration runner would _appear_ to work — no error, green logs, migrations applied. It would simply have stopped serialising two concurrent migrators, and nobody would learn that until two deploys raced. **A guarantee that fails quietly is worse than one that was never claimed.**

**A future component may introduce a separate transaction-mode connection — but only after proving that it depends on no advisory lock, no prepared statement, and no session state.** That is a new decision with its own evidence. It is not a relaxation of this one, and it does not apply retroactively to the migration runner or the projection runner, which will never qualify.

**Stage 3.1 has not been validated against Supabase.** No migration has been applied there. Establishing and _proving_ the connection mode and the TLS configuration a managed provider requires — which a loopback database does not — belongs to the stage that first connects, and is **not claimed as done**.

### 7. PostgreSQL: major version 17 is the contract; patch levels are not

|                  |                                                                                 |
| ---------------- | ------------------------------------------------------------------------------- |
| **Required**     | **PostgreSQL major version 17.** Everywhere: local, CI, and the managed project |
| **Not required** | **Identical patch versions.** They already differ, and that is fine             |

At the time of writing, local development and CI pin **17.10** (the exact image tag, in `compose.yml` and in the CI workflow), while the managed QF-Jarvis project runs a provider-managed **17.6.x** build. **That divergence is expected and permitted.**

**Local and CI patch equality does not imply Supabase patch equality, and the repository must not pretend otherwise.** Pinning the exact image in `compose.yml` and CI buys one specific thing — that a laptop and a CI runner agree with _each other_ — and it must not be over-read as a claim about the provider, whose patch level is the provider's to choose.

**Migrations and queries must remain compatible across supported PostgreSQL 17 minor releases.** Nothing in this repository may depend on behaviour introduced in a specific 17.x patch.

**A provider patch upgrade must not require a change to this repository** unless PostgreSQL compatibility genuinely changes. If a provider upgrade ever _does_ force a change here, that is a finding worth an ADR, not a quiet edit.

### 8. The test suite must never point at Supabase — including Jarvis's own

The destructive test helpers drop the `qf_jarvis` schema. They refuse any target that is not loopback, is not named as a test database, or contains `supabase`, `quickfurno`, `prod`, `production`, or `live`.

**The loopback allowlist is what rejects every managed database** — not a provider denylist that has to keep up with the industry, but four permitted hostnames that a managed provider can never be one of.

**The `supabase` guard stays, and this ADR makes it more important rather than less.** It is no longer only protecting Core's project — it is now also the thing standing between a stray `DATABASE_URL` and **Jarvis's own production event log**. A guard that was defending against a mistake nobody could make is now defending against one somebody could.

**Supabase is not a test target. It is not a development target. It is a deployment target**, and the test suite has no business reaching it.

### 9. No secrets in the repository. None.

**Never committed, in any file, in any form:** the project ref · the database hostname · the connection URL · database passwords · service-role keys · `anon`/publishable keys · API keys of any kind.

**The deployment target is identified outside the repository, through controlled deployment configuration.** This ADR names _that a dedicated project exists_ and _what may be done with it_. It does not name _where it is_, and it must not: the ref is the hostname, and the hostname is half of a connection URL. The repository gains nothing from holding it — no code reads it; `DATABASE_URL` arrives from the environment — and a secret is cheapest to protect when it was never written down.

`DATABASE_URL` is supplied by the environment, and **the only code that reads it is the migration CLI** — a process boundary. Library code reads no environment ([ADR-0019](./ADR-0019-durable-event-store-and-persistence.md)). There is **no `.env`, no `.env.example`, and no configuration loader**, and there must not be one: a committed `.env.example` becomes a copied `.env`, and a copied `.env` becomes the habit that eventually lands a real credential in a working tree ([security-principles.md](../governance/security-principles.md)).

Any Supabase-shaped hostname appearing in this repository is a **synthetic placeholder in a unit test** and is deliberately not a valid project ref.

### 10. No live QuickFurno personal data. The retention gate is untouched.

**The QF-Jarvis Supabase project must contain no live QuickFurno personal data during Phase 3.** Phase 3 stores **synthetic Phase 2 fixtures only** — no contact information, no production recipient, no production event stream, no live Core connection.

**Provisioning a deployment database does not unblock production event-log retention**, and must not be read as doing so. [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7 stands in full: whether an immutable canonical event log is a retained audit record is **a legal question, not an engineering one**, and it remains an **owner-approved hard gate on Phase 11**. A database now exists that _could_ hold production events. It may not.

**Having somewhere to put the data is not permission to put it there.** This ADR provisions a host. It grants no licence.

### 11. What this supersedes, exactly

**Superseded:** ADR-0019 §1, the table row _"Production on a VPS — a single instance, alongside the Jarvis service."_ Production PostgreSQL for QF Jarvis is now **Supabase-managed, in a dedicated QF-Jarvis project**.

**Not superseded, and explicitly reaffirmed:**

- §2 — Jarvis's own database. **Core's Supabase remains forbidden.**
- §3 — Raw SQL. No ORM.
- §4 — The `pg` driver, pinned, script-free, under `onlyBuiltDependencies: []`.
- §5 — Forward-only numbered migrations with checksum reconciliation. No down-migrations.
- §6 — Compose is **development-only**; GitHub Actions PostgreSQL is **CI-only**.
- §7 — Retention and privacy are **not** decided, and Phase 11 is the gate.
- Immutability: `BEFORE UPDATE OR DELETE` triggers and revoked grants, on **both** the event log and the migration history.

## Consequences

**Positive.**

- **Operational cost drops.** Backups, patching, monitoring, point-in-time recovery and availability become the provider's problem rather than a solo founder's. ADR-0019 named "operating a database is a real cost" as an accepted negative; this substantially reduces it.
- **The blast radius of a provider mistake is one schema.** `qf_jarvis` is revoked from `PUBLIC` and from every provider role, is absent from the Data API, and is reachable only by a database login. A misconfigured Data API cannot expose an event log that is not in a schema it can see.
- **The same migration runs everywhere.** The conditional revoke is what buys that, and it is the difference between CI proving production and CI proving something adjacent to it.
- **It is reversible.** Nothing above the `pg` driver knows the provider. Moving to a VPS, RDS, or anything else that speaks PostgreSQL 17 is a change to one environment variable.

**Negative — accepted.**

- **The name collision is a permanent hazard.** "Supabase" now means two different things in this ecosystem, and only one of them is allowed. Every future reviewer must check _which project_ a credential belongs to. This ADR is the mitigation, and it is not a complete one — vigilance is still required, and pretending otherwise would be the mistake.
- **The connection-mode rule is a real constraint on future design.** Anything that wants a transaction-mode pooler for connection efficiency must first prove it needs no session state. Some things will want it and will not qualify.
- **The Data API prohibition is a permanent operational discipline**, enforced by a console setting rather than by code. **Nothing in this repository can prevent someone from adding `qf_jarvis` to the exposed-schema list.** The revokes make it far less dangerous if they do — but the honest statement is that this control lives outside Git, and it is only as good as the person clicking.
- **A production-shaped database now exists before the privacy gate has been decided.** The temptation to point a live event stream at it arrives earlier than the decision that would permit it. §10 is the answer, and it is a rule, not a reassurance.
- **Provider lock-in on operations, not on code.** Supabase's backup, PITR and observability tooling will be used, and leaving would mean rebuilding those. The _schema_ and the _queries_ remain portable; the operational surface does not.

## Alternatives rejected

**Self-hosted PostgreSQL on a VPS** (the ADR-0019 assumption). Rejected on cost of ownership, not on capability. A single founder operating backups, patching, PITR and availability by hand is a real risk to the one asset that is genuinely irreplaceable — **the immutable event log** — and it is the kind of risk that is invisible until the day it is not.

**QuickFurno Core's Supabase project.** **Rejected, permanently, on the boundary** ([ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §2, [ADR-0001](./ADR-0001-source-of-truth-boundary.md)). This is the same rejection as before and it has not softened. Sharing Core's project would put Jarvis one `UPDATE` away from being a write path into business truth. **The existence of a Jarvis Supabase project makes this alternative more tempting and no more permissible.**

**Using the `public` schema.** Rejected. It is the default a Data API reaches for, the schema every other tool writes to, and the one place where "who else can see this?" has no single answer. A private schema turns that question into one `REVOKE`.

**Supabase as a platform** — Auth, Storage, Realtime, Edge Functions, PostgREST. Rejected because each one is a capability the architecture deliberately withholds from Jarvis. Jarvis authorizes nothing, executes nothing, and delivers nothing. Adopting a platform that offers to do all three would be adopting an argument for why it should.

**`@supabase/supabase-js`.** Rejected. It is a client for the capabilities above. The database is reachable with the driver already approved, already pinned, already audited, and already script-free. Adding a second way to reach it would add a dependency in order to gain nothing.

**Pinning the provider's exact patch version.** Rejected as both impossible and undesirable: the provider chooses its own patch level, and a repository that claimed to pin it would be asserting something it cannot enforce. Major 17 is the contract; the rest is the provider's job (§7).
