# Report 03 — Readiness Verdict and Managed Application Boundary

**Date:** 2026-07-22.

## What this slice delivered

A repository-supported **bounded** managed migration command:

```
pnpm db:migrate -- --through 0005
```

It closes the gap recorded by the preceding read-only preflight, which returned
`BLOCKED / NO_REPOSITORY_SUPPORTED_BOUNDARY_THROUGH_0005` because the only supported command applied
every pending migration and could not exclude `0006`. A `0002`→`0005` application is now
_expressible_ with repository-supported tooling — and only expressible; it is **not** approved, and
none was performed.

## The managed application boundary

- **A managed target refuses to run unbounded.** Omitting `--through` against a managed database
  fails before the pool is created, before the preflight, before the advisory lock, and before any
  DDL. Unbounded application survives only for a **local loopback** database.
- **`--through 0005` cannot include `0006`.** The bound is inclusive and `6 > 5`, so `0006` is placed
  in the plan's `excluded` list and is never selected. Proven by unit tests that assert the selected
  set equals `[0002, 0003, 0004, 0005]` and that `0006` is excluded for **every** target below it.
- **Forward-only is preserved.** A database already ahead of the target fails closed; a bound cannot
  un-apply history.
- **Nothing about how a migration executes changed** — same preflight, same advisory lock, same
  one-migration-per-transaction, same stop-on-first-error, same checksum/missing-file/out-of-order
  reconciliation over the full file set.

## What was NOT done

- **No managed database was accessed.** `DATABASE_URL` and `QF_JARVIS_DATABASE_URL` were never set or
  used; no managed `db:preflight` was run; no remote `db:migrate` was run.
- **No migration was applied** — 0002, 0003, 0004, 0005 and 0006 remain unapplied by this task.
- **No migration SQL was executed, and no migration file changed.** All six checksums are byte-exact;
  `0007` remains absent; no `.sql` file was created or edited.
- **No QuickFurno production or staging database was touched.**
- **No migration repair, no history write, no advisory lock acquired, no deployment.**
- No agents, WhatsApp, RAG, model gateway, apps, projection/replay/ingestion behaviour, or Supabase
  Auth/Storage/Realtime/Edge Function code. No lockfile change.

## Local invocation evidence (no database contact)

Both proofs ran with `DATABASE_URL` unset, and parsing precedes configuration resolution:

- `pnpm db:migrate -- --through 9999` → `Refusing to migrate: Migration target 9999 does not resolve
to any repository migration. Available versions: 1, 2, 3, 4, 5, 6.`
- `pnpm db:migrate -- --through 0005` → parses and resolves the target, then stops at
  `Refusing to migrate: DATABASE_URL is not set.`

The second proves the documented command is wired end-to-end through pnpm argument forwarding while
reaching no database.

## Quality gate

`format:check`, `lint`, `typecheck`, `build`, `check:dist-containment` and `git diff --check` all pass;
unit tests **2553/2553** across 60 files, including the unchanged public-API test that pins the
package-root runtime surface at **39 symbols** (the new errors, options type and target module are
internal and are not re-exported from the barrel).

## Owner decision this unblocks

The owner may now review a bounded `0002`→`0005` managed application as a single reviewable command
whose executed scope equals its reviewed scope. **That review and authorization are still required**:
`0004_projection_foundation.sql` and `0005_projection_event_positions.sql` still need
separately-reviewed managed readiness, and migration `0006` remains explicitly out of scope for any
such run.

## Verdict

**PASS / QFJ_MANAGED_MIGRATION_BOUNDARY_READY_FOR_OWNER_REVIEW** (pending green CI on the exact PR head).
