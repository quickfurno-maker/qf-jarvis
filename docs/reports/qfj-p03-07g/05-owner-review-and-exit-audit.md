# Report 05 — Owner Review and the QFJ-P03.07 Exit Audit

**Date:** 2026-07-24.

## What QFJ-P03.07G delivered

The projection-failure lifecycle built by A–F was durable, correct, and **completely invisible**. A
production projection could exhaust its five retries, block on a poison event, and stop processing every
subsequent event indefinitely without emitting a single signal — the repository had no logging, metrics,
or telemetry of any kind.

G supplies the foundation and its first consumer:

- an internal **closed-vocabulary structured logger** (18 events, severity derived from the event, JSON
  Lines over an injected sink and clock, no third-party dependency);
- an internal **metrics registry** with type-level label closure, so an unbounded label is a compile
  error rather than a review item;
- **derived health readers** and the startup schema gate;
- **post-commit telemetry** across the runner, worker, inspection/quarantine, and replay paths;
- a **read-only inspection CLI** with bounded exit codes;
- the **alerting specification**, the **operational query surface**, and a rewritten **runbook** with
  ratified recovery objectives.

Telemetry is never a correctness dependency: every emission happens after the transaction resolves, and
every call site is guarded.

## Scope containment — what this slice did NOT do

- **No metrics exporter**, no network egress, no distributed tracing, no log shipping.
- **No alert delivery** — the alerting document is a specification.
- **No dashboard or frontend.**
- **No mutating operator CLI.**
- **No new migration, no migration 0007, no change to migrations 0001–0006.**
- **No package-root API expansion** (39 symbols, unchanged).
- **No correctness change** to ordering, checkpoints, advisory locks, retry policy, the taxonomy, or
  D/E/F behaviour.
- **No managed-database access, no credential handling, no deployment.**
- No MVP (M1) runtime work.

## Readiness posture

- Local: `format:check`, `lint`, `typecheck`, `git diff --check` **pass**; unit **2659/2659** across 67
  files (from 2533/59 at F), including the unchanged 39-symbol public-API test and the
  migration-conformance/checksum tests.
- Integration: **PASS in CI against PostgreSQL 17** — **391/391** across 20 files, including the 9 new
  `projection-health.integration.test.ts` tests. It was not run locally (`DATABASE_URL` is absent and
  this task forbids handling credentials); the result above is taken from the CI log.
- Migration 0006 checksum unchanged; 0007 absent; managed PostgreSQL untouched.

---

# QFJ-P03.07 Exit Audit

## Criterion-by-criterion

| #   | Criterion                               | Status                                                                                                                                                                                  |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | A–G merged and locked                   | **A–F merged** (PRs #26, #29, #30, #31, #32, #33). **G is merge-ready** — PR #35, CI green (run 30066733285) on the PR head at time of review — pending owner review and merge          |
| E2  | Quality gates green                     | **PASS** — local format, lint, typecheck, diff-check, 2659/2659 unit; CI run 30066733285 **success** with integration **391/391** across 20 files on the PR head at time of review      |
| E3  | Observability coverage complete         | **PASS** — every lifecycle transition emits its bounded event and updates its metric; the redaction test asserts on full serialised output; no unbounded label exists                   |
| E4  | Runbook complete                        | **PASS** — zero `[UNIMPLEMENTED]` markers; every named command exists; all nine recovery objectives have concrete numeric thresholds                                                    |
| E5  | Public API freeze preserved             | **PASS** — exactly 39 root symbols; the CLI is reachable only via an internal subpath                                                                                                   |
| E6  | No migration 0007; 0001–0006 unchanged  | **PASS** — all six checksums identical; 0007 absent                                                                                                                                     |
| E7  | Managed deployment explicitly separated | **PASS** — see below                                                                                                                                                                    |
| E8  | Known limitations documented            | **PASS** — see below                                                                                                                                                                    |
| E9  | Repository clean and locked             | **PASS** — tracked tree clean, nothing staged, protected untracked directory untouched                                                                                                  |
| E10 | The four D-era invariants still hold    | **PASS** — exhaustion creates exactly one durable active failure; the checkpoint stays blocked and never skips; operator actions are attributed and audited; diagnostics remain bounded |

## Functional exit criteria (ADR-0040)

| Criterion                                                                                     | Status                                                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Retry exhaustion → exactly one durable active failure                                         | **PASS** (D; unchanged by G)                                                                          |
| Checkpoint stays blocked, never skips                                                         | **PASS** — the only transition out of `blocked` is a successful replay advancing exactly one position |
| Operators inspect / acknowledge / quarantine idempotently                                     | **PASS** (E)                                                                                          |
| Authorized replay reprocesses the exact event under the advisory lock and resolves atomically | **PASS** (F)                                                                                          |
| Every operator action attributed and audited                                                  | **PASS** — append-only ledger; `UPDATE`/`DELETE` refused by trigger                                   |
| Diagnostics bounded                                                                           | **PASS** — closed codes only; the G redaction sweep is the enforcement test                           |
| Least-privilege grants hold                                                                   | **PASS** (0004/0006; unchanged)                                                                       |
| Root API contained                                                                            | **PASS** — 39 symbols                                                                                 |
| Rebuild determinism for QFJ-P03.08 achievable                                                 | **PASS** — gap-free commit-ordered positions preserved; no skip exists anywhere in the lifecycle      |

## E7 — Managed deployment status, stated without ambiguity

**Repository implementation of QFJ-P03.07 is complete. This is NOT a production-readiness
declaration, and the two must not be conflated.**

- Managed PostgreSQL remains at migration **0001**.
- Migrations **0002–0006 are unapplied and not deployed**.
- The `qf_jarvis_migrator` direct-login password is **unresolved**.
- **Password rotation is paused.**
- **No migration retry is authorized.**
- No managed-database access occurred during this slice.

Everything QFJ-P03.07 delivers — the failure aggregate, the action ledger, replay authorizations, the
lease evidence, and all of G's observability over them — targets relations created by migrations
0004–0006, **none of which exist in the managed environment**. The capability is exercised in local and
CI only.

Concretely: alert **A9** (migration mismatch / schema unavailable) **would fire immediately** in
managed today, and the worker's startup schema gate **would refuse to start** there. That is correct
behaviour, and it is the honest summary of managed status.

A future reader must not conclude from "QFJ-P03.07 complete" that projection failure operations are live
in production. They are not.

## E8 — Known operational limitations

1. **No metrics exporter.** Metrics are process-local and in-memory. The inspection CLI and its bounded
   exit codes are the supported external read path.
2. **No alert delivery.** The alerting document specifies conditions, severities, windows, suppression,
   and actions; wiring them to a pager/webhook is separate, unauthorized work.
3. **No mutating operator CLI.** Acknowledge, quarantine, authorize, and execute require a programmatic
   authorized caller. This is a deliberate design decision (four-eyes approval, attributed actor
   identity, ADR-0040's command boundary), not an omission.
4. **`retired` has no automated producer.** It is reachable by design and produced only through
   governance escalation.
5. **Logs are at-least-once.** A crash between COMMIT and emission loses a line; a retry after an
   ambiguous commit may duplicate one. The action ledger is the authority; logs are evidence.
6. **Divergence and commit-outcome-unknown persist nothing.** Their log line and counter are the only
   trace, which is why they are the only `critical` events and why divergence repeats are rate-limited
   rather than dropped.
7. **The A4 infrastructure-rate threshold is derived from worker poll cadence** and should be re-derived
   per environment once the deployed poll interval is fixed. The _shape_ of the rule — a sustained rate,
   never a single occurrence — must not change.
8. **Worker-process metrics have no consumer in this slice.** Derived gauges are populated by the CLI's
   health read; the worker maintains process counters that nothing currently exports. Adding a per-cycle
   database refresh to the worker was rejected as a behavioural change to the cycle loop.
9. **None of this is active in managed.** See E7.

## Process disclosure

During the documentation commit, a `git add -A` staged the protected untracked directory
`docs/reports/qfj-managed-reconciliation-0002-0005/`, which the task forbids staging. The branch was
rebuilt so it was never committed; the file is present on disk, untracked, byte-identical, and absent
from every commit. Nothing had been pushed. Full detail in report 04.

## Verdict

**PASS / QFJ_P03_07G_READY_FOR_OWNER_REVIEW** — CI is green, including the PostgreSQL 17 integration
suite. GitHub Actions run **30066733285**, conclusion **success**, verified the **PR head at time of
independent owner review** — `c50ca6b557468dcc52a59579fa3c9b526f8e9ed9`. The later documentation-only
remediation commit that corrects these reports does not alter the already-reviewed implementation and
requires its own new CI run.

**QFJ-P03.07 (Projection Failure Operations) is complete in the repository.** The next slice is
**QFJ-P03.08**. Managed deployment of migrations 0002–0006 remains a separate, currently paused lane and
is not authorized by this work.
