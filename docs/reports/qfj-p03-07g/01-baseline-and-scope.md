# Report 01 — Baseline and QFJ-P03.07G Scope

**Date:** 2026-07-24.
**Branch:** `qfj-p03-07g-observability-runbook-exit-audit`.
**Baseline:** `main` = `84a057a91ba1a9462f9f1fbe624f2708da1c8581`.

## Verified baseline

All ten preconditions were checked before any file was written, and all ten passed.

| #   | Condition                                                | Result |
| --- | -------------------------------------------------------- | ------ |
| 1   | Repository root is `qf-jarvis`                           | PASS   |
| 2   | Origin is `quickfurno-maker/qf-jarvis`                   | PASS   |
| 3   | Branch was `main`                                        | PASS   |
| 4   | `HEAD` = local `main` = `origin/main`, divergence `0 0`  | PASS   |
| 5   | `HEAD` = `84a057a91ba1a9462f9f1fbe624f2708da1c8581`      | PASS   |
| 6   | Tracked tree clean                                       | PASS   |
| 7   | Nothing staged                                           | PASS   |
| 8   | Untracked reconciliation directory present and untouched | PASS   |
| 9   | Migrations 0001–0006 byte-identical                      | PASS   |
| 10  | Migration 0007 absent                                    | PASS   |

Locked checksums, verified at start and re-verified at the end:

```
dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a  0001_event_log.sql
4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c  0002_event_runtime_grants.sql
407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c  0003_ingestion_rejection_and_event_conflict.sql
148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30  0004_projection_foundation.sql
96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae  0005_projection_event_positions.sql
e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4  0006_projection_failure_operations.sql
```

## The finding that shaped the slice

The prior read-only audit established, and implementation confirmed, that **the repository contained no
logging, metrics, or telemetry infrastructure of any kind**. Verified exhaustively rather than assumed:

- A repository-wide search for `logg|telemetr|metric|observab|health|readiness|monitor|alert|dashboard`
  returned **only documentation** — zero source files.
- A repository-wide grep for `logger|Logger|emitMetric|counter|histogram|gauge` across all TypeScript
  returned seven files, **every one a false positive**: the word "counter" in prose comments about
  projection count columns.
- The only runtime output anywhere in `packages/` or `apps/` was `process.stdout.write` /
  `process.stderr.write`, in exactly two managed-database CLIs, neither on the projection path.
- The projection worker's entire observable output was three fixed constant strings plus an in-process
  summary of three numbers (`cycles`, `succeeded`, `stoppedBy`), none of it emitted per cycle.

The operational consequence, stated plainly: **a production projection could exhaust its five retries,
block on a poison event, and stop processing every subsequent event indefinitely — and nothing anywhere
would say so.** The worker kept cycling, kept returning `blocked-existing`, and kept exiting 0. The
state was durable and correct; it was simply invisible.

This did not block G. It defined it. The framing inherited from ADR-0040 and the QFJ-P03.07F boundary
report — "metrics/logs/alerts for the lifecycle" — reads as instrumentation. It is not.
**QFJ-P03.07G is a greenfield observability foundation plus its first consumer**, and the foundation had
to exist before a single projection metric could be emitted.

## Scope delivered

**Foundation (new).** Closed structured-log vocabulary; JSON Lines logger over an injected sink and
clock; in-process metrics registry with type-level label closure; derived health readers and the
startup schema probe. No third-party logging, metrics, tracing, exporter, or alert dependency.

**Instrumentation.** Post-commit telemetry hooks in the runner, worker, worker CLI, inspection/quarantine
operations, and the authorized-replay service.

**Operator surface.** One **read-only** inspection CLI (`list`, `inspect`, `history`, `divergence`) with
`--json` and bounded exit codes, exposed on a narrowly scoped internal subpath.

**Documentation.** Alerting specification, operational query surface, rewritten runbook with ratified
recovery objectives, and three stale-statement corrections.

**Tests.** 126 new tests (2659 total, from 2533) plus one PostgreSQL integration suite.

## Non-goals, explicitly deferred

No metrics exporter or network egress · no alert delivery (pager/webhook/email/Slack) · no dashboard or
frontend · no distributed tracing · no log shipping or retention · **no mutating operator CLI** · no
change to runner, checkpoint, ordering, advisory-lock, retry, or taxonomy behaviour · no new migration
and no migration 0007 · no package-root API expansion · no managed-database access · no MVP (M1) runtime
work.

## Managed-database boundary

Untouched and out of scope throughout. Managed PostgreSQL remains at migration **0001**; migrations
**0002–0006 are unapplied and not deployed**; the `qf_jarvis_migrator` password is unresolved; password
rotation is paused; no migration retry is authorized. No connection to any managed database was opened,
no credential was read, printed, or requested, and no migration was executed.

**Repository completion is not managed production readiness.** That distinction is carried explicitly
into the runbook, the alerting specification, the roadmap, and report 05.
