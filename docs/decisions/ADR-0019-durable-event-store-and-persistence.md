# ADR-0019 — Durable Event Store and Persistence

**Status:** Accepted — **§1's deployment-provider assumption superseded by [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md)**
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

> **Superseded in part.** [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) replaces **one line of this ADR**: the §1 table row _"Production on a VPS."_ Production PostgreSQL for QF Jarvis is now a **dedicated, Supabase-managed project** — **not QuickFurno Core's**.
>
> **Everything else here stands, and §2 is reinforced rather than relaxed.** Jarvis's own database, Core's Supabase still forbidden, raw SQL, no ORM, the `pg` driver, forward-only checksummed migrations, Compose for development only, GitHub Actions PostgreSQL for CI only, and the retention gate still closed.

---

## Context

Phase 3 builds the durable event backbone — "the load-bearing infrastructure of the entire system" ([phased-roadmap.md](../architecture/phased-roadmap.md)). Everything above it inherits its correctness, and its failures. Getting idempotency and replay wrong here poisons every phase built on top.

That means the storage decision is not a preference. It is the decision that determines whether **"the same event twice has the effect of once"** ([ADR-0003](./ADR-0003-event-driven-integration.md) §5) is a property the system _has_, or a property the system _tries to maintain_.

Three constraints frame the choice, and two of them eliminate options before any comparison begins.

**The boundary.** QF Jarvis is a separate service with a separate data boundary ([ADR-0001](./ADR-0001-source-of-truth-boundary.md)). It owns no business truth. Everything it stores is either an immutable copy of a fact Core recorded, or something derived from those copies and rebuildable from them.

**The supply-chain policy.** `pnpm-workspace.yaml` sets `onlyBuiltDependencies: []` — **no dependency may run a lifecycle build script**. This is not a preference either; it is an accepted supply-chain control, and it removes an entire class of candidate from consideration.

**The absence of anything.** The repository today has no database, no server, no queue, no transport, and one runtime dependency. Whatever Phase 3 adds is the first infrastructure this project has ever had, and it should be the smallest amount that makes the exit criteria provable.

## Decision

**PostgreSQL 17, as QF Jarvis's own database. Raw SQL through the pure-JavaScript `pg` driver. No ORM. Forward-only numbered migrations with recorded checksums.**

### 1. Why PostgreSQL, and it is not really about Postgres

The decisive property is one line of SQL:

```sql
INSERT INTO event (...) VALUES (...)
ON CONFLICT (event_id) DO NOTHING
RETURNING sequence;
```

**The `UNIQUE (event_id)` constraint _is_ the idempotency mechanism.** The single most load-bearing rule in Phase 3 — _at-least-once delivery must produce exactly-once effect_ — stops being application logic racing itself under concurrency, and becomes an invariant the storage engine enforces.

That is the whole argument. Everything else follows:

| Requirement                          | What Postgres gives                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crash safety                         | WAL, `fsync`, full ACID                                                                                                                                                                     |
| **Atomic deduplication**             | `ON CONFLICT` on a unique constraint — no read-then-write race                                                                                                                              |
| Concurrency                          | MVCC; **advisory locks** (one per projection); `FOR UPDATE SKIP LOCKED` if ever needed                                                                                                      |
| Atomic checkpoint + read-model write | One transaction, so a read model can never be ahead of or behind its own checkpoint                                                                                                         |
| Deterministic replay                 | `BIGINT GENERATED ALWAYS AS IDENTITY` — a total order over ingestion                                                                                                                        |
| Immutability                         | `BEFORE UPDATE OR DELETE` trigger **and** revoked grants — belt and braces                                                                                                                  |
| Migrations, indexing, operations     | Mature, boring, well understood                                                                                                                                                             |
| ~~Production on a VPS~~              | ~~A single instance, alongside the Jarvis service~~ — **superseded by [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md): a dedicated Supabase-managed PostgreSQL 17 project** |

### 2. Jarvis's own database. Never QuickFurno's.

**QF Jarvis must never hold a QuickFurno Core Supabase credential, and must never read or write a QuickFurno business table.**

This is not a comment on Supabase, which is fine. It is [ADR-0001](./ADR-0001-source-of-truth-boundary.md). A shared database is an integration point, and an integration point one `UPDATE` away from being a write path — which is exactly the erosion the boundary exists to prevent. ADR-0003 already rejected "shared database tables as an integration point" as _"alternative 1 wearing a hat."_

Jarvis gets its own instance, its own credentials, its own schema, its own backup, and its own blast radius.

> **This clause is what [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md) satisfies rather than overrides.** A **dedicated QF-Jarvis Supabase project** is its own instance, credentials, schema, backup and blast radius. **QuickFurno Core's Supabase project remains forbidden** — that rejection was never about the technology, and it has not softened.

### 3. Raw SQL. No ORM.

The queries that matter in Phase 3 are few, and they are precisely the ones an ORM abstracts away: `ON CONFLICT DO NOTHING`, advisory locks, ordered scans by identity column, and a transactional checkpoint write.

An ORM would hide the semantics we most need to be able to read in a diff. The number of distinct queries in this phase is small enough that the abstraction buys nothing and costs the ability to review the thing that must be right.

### 4. `pg`, and why the driver choice is constrained rather than chosen

`pg` (node-postgres) is pure JavaScript and **declares no lifecycle build script**, so it is compatible with `onlyBuiltDependencies: []`. That policy is what eliminates the alternatives, not taste.

It will be pinned exactly, and it must satisfy `minimumReleaseAge: 1440` (nothing published in the last 24 hours).

**`pg` is the only new runtime dependency Phase 3 introduces.**

### 5. Forward-only migrations, with a checksum guard

Numbered SQL files — `0001_event_store.sql`, `0002_…` — applied by a small in-repo runner. **No migration framework.**

- Each migration runs inside a transaction.
- `schema_migrations (version, applied_at, checksum)` records what was applied.
- **If a previously-applied migration's file has changed, startup fails.** History cannot be silently rewritten, which is the failure mode where staging and production quietly diverge.
- **No down-migrations.** Rollback is forward-fix, or restore.

Rollback is genuinely cheap here, and for a structural reason worth naming: **Jarvis owns no business truth.** Every derived read model is disposable and rebuildable. The only irreplaceable tables are the immutable event log and the audit ledgers.

### 6. Development and CI infrastructure — and its limits

Approved: a **development-only Compose configuration** for a local PostgreSQL, and a **GitHub Actions PostgreSQL service container** for CI.

**These are development and CI infrastructure only. They are not QuickFurno production deployment configuration**, and they must not become it. Phase 0 excluded Docker as a _deployment_ artifact; a local database for a developer is a different thing, and this ADR is where that distinction is recorded rather than assumed.

**The honest cost.** Phase 1's exit criterion was _"a developer can clone, install, and run checks."_ It now becomes _"clone, install, start the database, run checks."_ That is a real regression in ergonomics, and it is mitigated rather than denied:

- **Unit tests remain database-free and always run** — signature verification, backoff arithmetic, canonical digests, reducer purity.
- **Integration tests require `DATABASE_URL` and fail loudly rather than skip.** This repository does not tolerate skipped tests; a suite that silently skips is a green build that means nothing.

### 7. Retention and privacy are deliberately **not** decided here

Phase 3 stores **synthetic Phase 2 fixtures only**. No live QuickFurno personal data, no contact information, no production recipient, no production event stream, and no production Core connection.

**This ADR does not decide the legal classification or the retention policy of a production canonical event log, and Phase 3 must not hardcode one.**

The tension is real and should be stated rather than glossed. [auditability-principles.md](../governance/auditability-principles.md) §5 requires the audit trail to be append-only and immutable. [data-ownership.md](../architecture/data-ownership.md) says audit records are handled _"under legal-retention rules rather than deletion rules."_ But the event log carries **pseudonymous Core identifiers**, and a pseudonymous identifier linked to a person is still personal data. Whether an immutable event log qualifies as a retained audit record is a **legal question, not an engineering one**, and engineering must not settle it by default.

**Before Phase 11 permits a single live event, a separate owner-approved privacy and retention decision must define:**

- whether the canonical event log is a retained audit record;
- legal retention periods;
- erasure and anonymisation behaviour;
- legal holds;
- pseudonymous identifier handling;
- unlinking or cryptographic-erasure options;
- deletion propagation;
- access-control requirements.

**Phase 3 must not hardcode an arbitrary production retention period, and must not claim that immutable storage overrides an applicable erasure requirement.** What Phase 3 _does_ provide is the mechanism that makes any of those answers implementable: erasure events are processable, derived models are rebuildable, and the erasure survives a rebuild ([ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md)).

## Consequences

**Positive.**

- **Idempotency is enforced by the database**, not defended by application code under concurrency.
- **A transaction spans the event, the checkpoint, and the read model**, so there is no dual-write problem and no outbox to get wrong.
- **Immutability is enforced by the engine** — a trigger and revoked grants, not a convention.
- **Rollback is cheap**, because everything except the log is derived.
- **The boundary holds**: separate database, separate credentials, no Core coupling.
- **One new dependency.** The supply-chain surface barely moves.

**Negative — accepted.**

- **The repository now has infrastructure.** A developer needs a running database to run the full gate. Mitigated, not eliminated (§6).
- **Raw SQL is more verbose** than an ORM, and its correctness is on us. That is the trade: the queries that matter are readable in a diff.
- **Operating a database is a real cost** — backups, upgrades, connection limits. It arrives now rather than later, and it is the price of durable, replayable evidence.
- **No down-migrations** means a bad migration is fixed forward. Acceptable precisely because the derived state is disposable.

## Alternatives rejected

**`better-sqlite3`.** Rejected by policy before preference: it is a native module requiring a build script, and **`onlyBuiltDependencies: []` blocks it.**

**`node:sqlite` (built into Node 24).** The most tempting alternative — zero dependencies, no build scripts, and by far the best local ergonomics. Rejected on the merits: **single-writer**, no `SKIP LOCKED`, no advisory locks, and still experimental. Phase 3 is the layer where concurrency correctness must be provable, and SQLite's concurrency model is the one thing it does not offer.

**Dual dialect — SQLite locally, PostgreSQL in production.** Rejected outright, and this deserves emphasis. It means **the deduplication and concurrency semantics you test are not the semantics you run** — and those are precisely the semantics Phase 3 exists to get right. A test suite that green-lights code under a different concurrency model than production has not tested the code; it has tested a lookalike.

**Append-only files.** Rejected. There is no atomic deduplication, no transaction spanning event and checkpoint, no indexing, and crash safety would be hand-rolled. The entire design would become a re-implementation of what a unique constraint gives for free — and the re-implementation would be the part most likely to be wrong.

**QuickFurno's Supabase.** Rejected on the boundary (§2). Convenient, and that is exactly the danger. **This rejection is permanent and is not affected by [ADR-0023](./ADR-0023-dedicated-supabase-managed-postgresql.md)** — which provisions Jarvis a **separate** Supabase project, and makes Core's project _more_ tempting rather than more permissible.

**Prisma.** Rejected: it fetches engine binaries in a `postinstall` script, which the supply-chain policy blocks — and it would hide the semantics that matter.

**Drizzle.** Genuinely good, and pure TypeScript. Rejected as unnecessary at this size: it adds a schema-definition and codegen surface for perhaps a dozen queries, none of which benefit from it.
