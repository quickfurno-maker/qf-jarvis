# `@qf-jarvis/event-backbone`

The durable event backbone. **Stage 3.1 provides the PostgreSQL persistence foundation, and nothing else.**

## What is here

A validated database configuration, a connection pool, a transaction helper, a forward-only migration runner with checksum verification, and the **immutable canonical event log**.

## What is deliberately not here

**No ingestion. No signature verification. No contract parsing. No deduplication behaviour. No projection framework. No checkpoints. No retries. No dead letters. No replay. No quarantine. No read models. No test emitter. No metrics. No worker loop. No HTTP endpoint.**

Those are Stages 3.2 through 3.8, each with an Accepted ADR describing it.

> **The `UNIQUE (event_id)` constraint lays the _foundation_ for eventId idempotency ([ADR-0020](../../docs/decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md)). It is not the same thing as the Stage 3.3 behaviour that distinguishes a benign duplicate from a conflicting one — and this package does not claim it is.**

## Importing this package connects to nothing

There is no module-level pool and no ambient configuration. `createDatabasePool` is a function a caller invokes with an explicit config.

**Library code reads no environment.** The only place that reads `DATABASE_URL` is the migration CLI, because a CLI _is_ a process boundary. A library that reaches into `process.env` behaves according to something the caller cannot see and a test cannot control — and it is how a test suite ends up pointed at a production database because a shell variable was left set.

## The database is Jarvis's own

**Never QuickFurno Core's database. Never QuickFurno Core's Supabase project. Never a QuickFurno business table.** ([ADR-0001](../../docs/decisions/ADR-0001-source-of-truth-boundary.md), [ADR-0019](../../docs/decisions/ADR-0019-durable-event-store-and-persistence.md) §2.)

Jarvis has **its own** Supabase-managed PostgreSQL 17 project for deployment ([ADR-0023](../../docs/decisions/ADR-0023-dedicated-supabase-managed-postgresql.md)). Supabase is used **only as a Postgres host** — no Auth, no Storage, no Realtime, no Edge Functions, no Data API, and **no `@supabase/supabase-js`**. This package's only dependency is still `pg`, and **nothing in it knows who the provider is.**

## Everything lives in the `qf_jarvis` schema. Nothing lives in `public`.

The event log, the migration history, both mutation-rejection functions, both triggers, every index and every constraint — all of it is in **`qf_jarvis`**, and every reference to it is **fully qualified**.

`public` is the shared, world-facing default: the schema a managed provider's Data API reaches for first, and the schema every other tool assumes it may write to. **An immutable event log has no business living in a room with an unlocked door.**

A private schema also makes the access question answerable in one place — **revoke `USAGE` on the schema and every object in it is unreachable by name**, whatever grants a provider hands its own roles today or after its next upgrade:

```sql
REVOKE ALL ON SCHEMA qf_jarvis FROM PUBLIC;
-- and, only where they exist, from anon / authenticated / service_role
```

That second revoke is a **conditional `DO` block**, not a plain statement, and the reason matters: `anon`, `authenticated` and `service_role` are _Supabase's_ roles and **do not exist on a laptop**. An unconditional `REVOKE ... FROM service_role` is a hard error locally and in CI — and a migration that only runs on the provider is a migration CI never actually proved. It re-runs on **every** migration, so a provider that re-grants during a platform upgrade is re-revoked rather than silently tolerated.

**Nothing depends on `search_path`.** An ambient `search_path` is a global variable set by whoever connected last, and correctness that rests on one fails the day a pooler hands back a different session.

## Connection mode: direct or session-mode. Never transaction-mode.

> **`createDatabaseConfig` refuses a Supavisor transaction-mode pooler** (port `6543`) — for **every** pool this package creates, not just `db:migrate`.
>
> This package depends on **session state**: `pg_advisory_lock()` for the migration lock (and, from Stage 3.4, for each projection), plus `statement_timeout` and `application_name` set on connect. A transaction-mode pooler multiplexes clients across backends, so the lock could be taken on one session and released on another.
>
> **It throws rather than warns because the failure is silent.** Under transaction pooling the migration runner would _appear_ to work — no error, green logs — and would simply have stopped serialising two concurrent migrators. Nobody would find out until two deploys raced. **A guarantee that fails quietly is worse than one never claimed.**
>
> The error names the rule and **never the URL, the host, or the password**. A local database on a non-standard port is _not_ rejected: the guard keys on a Supabase host, not on the port alone.

**Stage 3.1 has not been validated against Supabase.** No migration has been applied there, and TLS configuration for a managed provider is not built. Both belong to the stage that first connects, and neither is claimed as done.

## Public surface

```ts
// Configuration — validated, bounded, explicitly supplied.
createDatabaseConfig(input): DatabaseConfig
describeConnectionTarget(url): string   // host:port/database — never the password

// Pool — no hidden global, nothing created at import time.
createDatabasePool(config): DatabasePool
closeDatabasePool(pool): Promise<void>

// Transactions — release on every path; the ORIGINAL error always propagates.
withClient(pool, callback)
withTransaction(pool, callback)         // BEGIN / COMMIT, ROLLBACK on failure

// Migrations — forward-only, checksummed, advisory-locked.
runMigrations(pool, directory): Promise<MigrationResult>
loadMigrationFiles(directory)
defaultMigrationsDirectory(): string
```

**No retries at this layer.** Retry policy — what is retryable, how many attempts, what backoff — is a Stage 3.4 decision recorded in [ADR-0021](../../docs/decisions/ADR-0021-processing-retries-dead-letters-and-replay.md). An implicit retry buried in the transaction helper would put that policy where nobody thinks to look for it, applied to everything, uniformly, whether or not it is safe.

## The migration runner

Files are `NNNN_lowercase_description.sql`, applied in version order, each in **its own transaction**.

| Rule                                           | Behaviour                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Malformed filename                             | **Refused, before a connection is opened**                                       |
| Duplicate version number                       | **Refused**                                                                      |
| **An applied migration was edited**            | **Refuses to start.** History is not rewritten                                   |
| A recorded migration's file is missing locally | **Refuses to start.** The code is behind the database                            |
| A new migration below one already applied      | **Refused.** Forward-only means forward-only                                     |
| A migration fails                              | Rolled back. **Nothing is recorded**, so it runs again next time                 |
| Two migrators start at once                    | An **advisory lock** serialises them. The second waits, then finds the work done |
| The lock                                       | Released on **every** path — success, validation failure, SQL failure            |

The history table (`schema_migration`) is bootstrapped with `CREATE TABLE IF NOT EXISTS` **inside the advisory lock**, before it is read. It is deliberately not a migration itself: a runner that needs its own history table before it can read its own history has a bootstrap problem, and the honest fix is to state the bootstrap rather than hide it in `0000_`.

### The history is append-only too

`schema_migration` **is** the migration history, so it is protected exactly as hard as the event log: a `BEFORE UPDATE OR DELETE` trigger, plus `REVOKE UPDATE, DELETE ... FROM PUBLIC`, both installed by the bootstrap.

**A control that can be edited by the thing it constrains is not a control.** An `UPDATE` of a recorded checksum silently defeats the reconciliation that is the entire point of checksumming — the runner would compare a tampered file against a tampered record, find them in agreement, and start. A `DELETE` re-opens an applied migration for re-application against a schema that already has it.

The runner needs only **SELECT** and **INSERT**, and it is written that way. It never issues an `UPDATE` or a `DELETE` against the history, and now it cannot.

## The event log

Every column corresponds to a field in the Phase 2 canonical envelope, or to the signature and digest evidence [ADR-0020](../../docs/decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) requires. **Nothing is invented.** The envelope carries no aggregate sequence, so neither does this table ([ADR-0022](../../docs/decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md)).

### One event, one representation

The envelope lives in **columns**. The payload lives in **`payload` JSONB**. **The complete canonical event is not _also_ stored as a blob**, and that is deliberate: storing both would be two representations of one accepted fact, and two representations can disagree. A column says `subject_id = 'CORE-LEAD-42'` while the blob says `'CORE-LEAD-43'` — and now the log, whose whole purpose is to be the thing you can trust when everything else is in doubt, is a source of doubt. There is nothing to reconcile it against, because it _is_ the record of last resort.

So the contradiction is made **unrepresentable** rather than defended against. The persisted event is reconstructed from the envelope columns plus `payload`, and each field is written in exactly one place.

### `semantic_event_digest`, named for what it digests

It is a SHA-256 over the deterministic canonical JSON of the **entire parsed and validated canonical event** — envelope and payload together — as [ADR-0020](../../docs/decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §8 requires. It is **not** a digest of the payload, and it is no longer named as though it were. `body_digest` remains separate: SHA-256 over the exact bytes received, which is the value the signature commits to.

**Stage 3.1 stores the digest. It does not compare digests.** Distinguishing a benign duplicate from a conflicting one is Stage 3.3.

### Constraints that mirror the Phase 2 contracts

`event_type` and `subject_type` must be lowercase machine tokens (`^[a-z0-9]+([-.][a-z0-9]+)*$`, 1–64). `subject_id` must be an opaque Core reference (`^[A-Za-z0-9._:-]+$`, 1–128) — **not a UUID**, because Core owns its identifier scheme. `source` must be the literal `quickfurno-core`. `signature_algorithm` must be the literal `ed25519`.

**There is no closed list of subject types**, and there must not be: Core owns its entity taxonomy, and enumerating `lead`/`vendor`/`client` here would be inventing a fact about a system Phase 3 has not integrated with.

These are not a second copy of Zod. They are the few things PostgreSQL can enforce cheaply and that will not move under us, so that a bug in some future ingestion path cannot write a row the contracts would have refused.

### Immutability

Enforced two ways, and the limits are stated rather than implied:

- A `BEFORE UPDATE OR DELETE` trigger, which fires for **every** role including the table owner.
- `REVOKE UPDATE, DELETE ... FROM PUBLIC`.

> **A PostgreSQL superuser is not constrained by grants, and the table owner can disable a trigger.** Therefore **the runtime role must not be a superuser and must not own the schema or its tables, and the migration role must not be a superuser either.** The migration role and the runtime role are **separate responsibilities**: migrating is a privileged, occasional act; serving traffic is an unprivileged, continuous one, and one credential doing both is one credential that _can_ do both.
>
> **Stage 3.1 creates no password-bearing login role and commits none.** Roles are a deployment artifact — a `CREATE ROLE ... LOGIN PASSWORD '…'` in a migration is a credential in Git.
>
> Two further deployment obligations, which **live outside this repository and cannot be enforced by it** ([ADR-0023](../../docs/decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §4): **`qf_jarvis` must never be added to Supabase's exposed-schema (Data API) configuration**, and **no Supabase API key — `anon`, `service_role`, or otherwise — may be used to reach event-backbone data.** The revokes make a mistake far less dangerous; they do not make it impossible. That control is a console setting, and it is only as good as the person clicking.

## Running the tests

The tests in `*.integration.test.ts` require a real PostgreSQL and they **fail** without one. **They never skip.** A skipped database test is a green build that proves nothing — and proving the database behaviour is the entire point of this stage.

```powershell
$env:QF_JARVIS_POSTGRES_PASSWORD = "<local-only password>"
docker compose up -d --wait
$env:DATABASE_URL = "postgresql://qf_jarvis_dev:<that password>@127.0.0.1:55432/qf_jarvis_test"
pnpm.cmd db:migrate
pnpm.cmd check
```

`database-config.test.ts` is a **unit** test: it needs no database and runs in parallel with the rest of the repository. The PostgreSQL tests run **serially**, under their own `vitest.integration.config.mjs`, because they drop and recreate the `public` schema and would otherwise destroy each other. The serialisation is scoped to them — it is not imposed on the thousand database-free tests that have no reason to wait for a database.

The destructive test helpers refuse to run unless the target is **loopback**, **named as a test database**, and **free of any `prod`, `supabase`, or `quickfurno` substring**. All three guards must pass. The loopback allowlist is what rejects **every managed database** — not a provider denylist that has to keep up with the industry, but four permitted hostnames a managed provider can never be one of. The cost of a false refusal is a developer renaming a database; the cost of a false acceptance is unbounded.

**Cleanup drops `qf_jarvis`, and only `qf_jarvis`.** It does **not** drop `public` — `public` is not ours, and a suite that destroys a shared schema to tidy up after itself is a suite whose blast radius is the whole database rather than the one schema it created.

One test creates `anon`, `authenticated` and `service_role` (`NOLOGIN`, no privileges) so that the revocation test is **not vacuous** — on a laptop those roles do not exist, and "they have no grants" would otherwise pass by asserting nothing at all. It then _grants_ them access, re-runs the migrations, and proves the access was taken back. The connected role needs `CREATEROLE`; `compose.yml` already provides it, and the test **fails loudly** rather than skipping if it does not.

## Documentation

[event-backbone.md](../../docs/architecture/event-backbone.md) · [ADR-0019](../../docs/decisions/ADR-0019-durable-event-store-and-persistence.md) · [ADR-0020](../../docs/decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) · [ADR-0021](../../docs/decisions/ADR-0021-processing-retries-dead-letters-and-replay.md) · [ADR-0022](../../docs/decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md)
