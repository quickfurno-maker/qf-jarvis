# Report 03 — Operational Readiness and Runbook Inventory

**Date:** 2026-07-24. **Slice:** QFJ-P03.10.

## Operational capabilities (present on `main`)

- **Worker startup/shutdown** — `runProjectionWorker` with deterministic name-order traversal, at most one position per projection per cycle, isolation (a blocked projection never stalls another), no busy-spin, injected time/sleep, graceful `AbortSignal` drain; `projection-worker-cli` enforces a **startup schema gate** (a schema mismatch refuses to start).
- **Bounded batch behaviour** — one event per transaction; bounded poll/retry cadence; no unbounded loops.
- **Health / metrics / logging** — derived health readers (`projection-health`), an in-process metrics registry with type-level label closure, and a closed-vocabulary structured logger (JSON Lines over an injected sink/clock). Health degrades a blocked projection without failing liveness/readiness (avoids restart loops); schema mismatch blocks worker startup.
- **Failure inspection + operator runbook** — a **read-only** inspection CLI (`list/inspect/history/divergence`, bounded exit codes, no mutating command); the operations docs:
  - `docs/operations/projection-failure-operations-runbook.md` (rewritten, zero `[UNIMPLEMENTED]` markers),
  - `docs/operations/projection-failure-alerting.md` (10 ratified alert rules),
  - `docs/operations/projection-failure-queries.md` (read-only SQL).
- **Rebuild evidence** — real-PostgreSQL determinism + erasure proofs (QFJ-P03.08/09); rebuild reuses only the pure `apply` and never mutates live checkpoint/failure state.
- **Migration inventory / checksums** — `qf_jarvis.schema_migration` is append-only; every migration is checksummed on startup and editing history fails the process; migration-conformance tests pin the 0001–0007 set.
- **Local/CI operational validation** — the full unit + real-PostgreSQL integration suites pass in CI (fail-not-skip without `DATABASE_URL`); format/lint/typecheck/build/dist-containment green.

## Production / managed prerequisites — clearly separated

Managed PostgreSQL remains at **migration 0001**; migrations **0002–0007 are unapplied and not deployed**; the `qf_jarvis_migrator` password is unresolved; the managed migration lane and the password-rotation lane are **paused**; no migration retry is authorized; no deployment has occurred. These are the production prerequisites for a **later, separately authorized** managed-deployment lane — distinct from repository completion. Concretely, in a managed environment today the migration-mismatch alert would fire and the worker's startup schema gate would refuse to start against a 0001-only database; that is correct behaviour and the honest managed status.

## Readiness

The repository projection foundation is **operationally complete for local/CI**. There is no missing repository operational capability; production operations (metrics export, alert delivery, managed deployment) are deliberately deferred and out of scope for repository completion.
