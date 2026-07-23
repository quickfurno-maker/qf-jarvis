# Report 02 — Bounded-Target Design, Tests and Safety Invariants

**Date:** 2026-07-22.

## The exact operational command

```
pnpm db:migrate -- --through 0005
```

The root script forwards arguments (`pnpm --filter @qf-jarvis/event-backbone db:migrate --`), and the
CLI skips the POSIX `--` separator pnpm passes through, so the documented command reaches the parser
verbatim.

## Design

Three small, separable pieces — no change to how a migration is executed:

1. **`migration-target.ts` (new, pure).** `parseMigrationThroughOption(argv)`,
   `resolveMigrationTarget(files, version)`, `planMigrationSelection(files, appliedVersions, target)`.
   It opens no connection, reads no environment, executes no SQL — which is what makes the rules
   unit-testable without a database. It lives outside `migrate-cli.ts` because that file is an
   executable (importing it would run it).
2. **`migration-runner.ts`.** `MigrationRunOptions { throughVersion? }` threaded through
   `runMigrations` and `runMigrationsOnClient`. After reconciliation it adds a forward-only
   database-ahead check and bounds the **pending** selection.
3. **`migrate-cli.ts`.** Parses first, resolves the target against the repository, refuses an
   unbounded **managed** run, prints the sanitized plan, and passes the bound to `migrateWithPreflight`.

## Ordering — why nothing unsafe can precede a rejection

```
1. parse --through                ← no config, no connection
2. loadMigrationFiles + resolve   ← repository only; unknown target fails here
3. resolveCliDatabaseConfig       ← still no connection
4. managed && unbounded → REFUSE  ← before the pool is even created
5. print sanitized plan
6. migrateWithPreflight → preflight (read-only) → advisory lock → DDL
```

A malformed invocation, an unknown target, or an unbounded managed run all fail at steps 1–4 — before
a pool exists, before the preflight, before the advisory lock, and before any migration SQL.

## Selection semantics

- **Inclusive.** `--through 0005` applies 0005.
- **Exactly one migration.** A target naming nothing is `MigrationTargetUnknownError`.
- **Applied 0001 + target 0005 → selects exactly 0002, 0003, 0004, 0005; excludes 0006.**
- **Already at target → verified no-op:** history read, reconciled, checksum-verified, nothing selected.
- **Database ahead → fails closed** with `MigrationTargetBehindHistoryError` (a bound cannot un-apply
  history), raised after reconciliation and before any migration SQL.
- **Unbounded remains valid for local loopback only** — existing developer behaviour is unchanged.

## Preserved contracts (deliberately untouched)

Reconciliation still sees **every** applied record against **every** repository file, so checksum
mismatch, missing-file, and out-of-order detection are exactly as strong bounded as unbounded — the
bound narrows only which _pending_ migrations run. The session advisory lock, the idempotent
bootstrap, one-migration-per-transaction, stop-on-first-error, the unlock in `finally`, and the
mandatory preflight are all unmodified. No migration SQL, no history-table shape, and no timeout
behaviour changed.

## Sanitized output

```
Plan
  target       0005 (0005_projection_event_positions.sql)
  target class managed            | local (loopback)
  repository   0001, 0002, 0003, 0004, 0005, 0006
  excluded     0006 (beyond target)
  …
  already applied  0001
  applied now      0002, 0003, 0004, 0005
```

Versions and filenames only. No URL, host, user, password, token or certificate. A **defect found by
this slice's own test** and fixed: the malformed-value error originally echoed the raw argument, so a
mistyped connection string would have been reflected into stderr. Offending tokens are now only quoted
when they are short and option-shaped; anything else is described as "the supplied value".

## Focused tests (`migration-bounded-target.test.ts`, 20 tests, DB-free)

Accepts `--through 0005`, the unpadded and `=` forms, and the pnpm `--` separator; returns null when
absent. Rejects: missing value, malformed value (`abc`, `5.0`, `-5`, `0`, `0x5`, `5;DROP`, `" 5"`),
duplicate option, unknown option, stray positional. Rejects an unknown target; resolves to exactly one
migration. Proves the target is inclusive; that applied-0001 + target-0005 selects exactly 0002–0005;
that **0006 is excluded for every target below it**; database-behind selects only the gap in order;
already-at-target selects nothing; unbounded selects everything. Proves the database-ahead,
managed-unbounded and unknown-target errors carry no connection value.

Behaviours requiring a real database (applied set, no-op, ahead, checksum mismatch, history gap,
filename mismatch, advisory lock, stop-on-first-error) remain covered by the existing migration
integration suites, which run in CI against local PostgreSQL — **never** a managed target.
