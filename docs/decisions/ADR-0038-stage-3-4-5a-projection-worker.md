# ADR-0038 — Stage 3.4.5A: the internal projection worker/scheduler

**Status:** Accepted (2026-07-20, under the owner's standing Stage 3.4 authorization)
**Deciders:** Owner
**Phase:** 3 — Stage 3.4.5A (the internal worker that drives the runner; real handlers and rebuild are later slices)

**Relates to:** [ADR-0021](./ADR-0021-processing-retries-dead-letters-and-replay.md) (processing, retries) · [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md) (ordering, rebuild determinism) · [ADR-0034](./ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md) (Stage 3.4 protocol, exit gate) · [ADR-0035](./ADR-0035-stage-3-4-2-projection-registry.md) (registry) · [ADR-0036](./ADR-0036-stage-3-4-3-gap-free-projection-ordering.md) (positions) · [ADR-0037](./ADR-0037-stage-3-4-4-projection-runner.md) (the one-position runner)

---

## Context

Stage 3.4.4 (ADR-0037) delivered `runProjectionOnce`, which processes **at most one position for one projection per call** and returns one frozen result (or throws a fixed-code error); it is **COMPLETE and merged via PR #22 (merge commit `d7c9fbfb286040b7d8f32f927d7185d92d46c52f`)**. Nothing drives it repeatedly yet. The Stage 3.4.5 invariant audit concluded the remaining Stage 3.4 work is **implementable with required decisions** and recommended **splitting** it: a code-only worker/scheduler + isolation gate now, with the two real read-model handlers and rebuild deferred, because operational in-place rebuild is architecturally blocked by the merged schema (the append-only immutable attempt log, the attempt uniqueness constraint, the fail-closed reconciliation, the absence of a reset function, and read-model tables with no projection-version column) and would require a future migration.

**Stage 3.4.5A** is that first slice: the **internal projection worker/scheduler** that repeatedly drives `runProjectionOnce` across a registry, with deterministic traversal, no busy-spin, injected time/sleep, and graceful shutdown — and **nothing else**. It adds **no** real handler, **no** rebuild, **no** migration, **no** `apps/worker` change, and **no** package-root export.

## Decision

`packages/event-backbone/src/projections/projection-worker.ts` exposes two internal functions — `runProjectionCycle` (one deterministic cycle) and `runProjectionWorker` (the loop) — under this contract:

1. **Deterministic traversal.** A cycle visits every projection **once**, in `registry.list()` order (ascending projection name, the registry's deterministic enumeration), **sequentially**. It calls `runProjectionOnce` at most once per projection per cycle, so a cycle advances **at most one position per projection**. Bounded concurrency is a later evidence-driven optimisation, not a Phase-3 need.

2. **Isolation is a CLOSED-RESULT property; a THROWN value is a non-result failure.** `runProjectionOnce` represents a **deterministic projection-handler failure** through its closed result union — a poison event returns as `retry-scheduled` or `blocked-now`, **never** as a thrown value. Each of the seven closed results (`busy`, `caught-up`, `succeeded`, `retry-scheduled`, `blocked-now`, `blocked-existing`, `retry-pending`) is recorded and the cycle **continues** to the next projection. That is the isolation mechanism: each projection has its own checkpoint `(name, version)` and name+version advisory lock, so a poisoned projection never stalls another. A value **thrown** by `runProjectionOnce`, by contrast, is a **non-result** failure (infrastructure, a database-lifecycle fault, a repository invariant, an unknown COMMIT outcome, an unavailable runner) that cannot be reasoned about at the cycle level. On a throw the cycle **stops immediately**: it invokes **no** later projection, manufactures **no** projection-local result, appends **no** attempt, mutates **no** checkpoint, does **not** claim the cycle completed, and throws a fresh closed `ProjectionWorkerError` whose `code` and `message` are repository-owned constants. The caught value is **discarded without any inspection** — the `catch` has no binding, so it is never read, `instanceof`-checked, stringified, interpolated, enumerated, spread, prototype- or descriptor-inspected, preserved as `cause`, or logged. Do not conflate a poisoned event (a closed result) with an infrastructure exception (a thrown value).

   **The closed error boundary covers every injected seam, not just `runOnce`.** A bindingless `catch` normalises a failure from `registry.list()`, the registry snapshot, `deps.now()`, `runOnce()`, **validating a returned runner result**, or `deps.sleep()`. The normalised `code`/`message` come from a small repository-owned constant table that distinguishes at minimum:

   | code                             | meaning                                                                                                                         |
   | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
   | `projection-worker-cycle-failed` | a non-result failure at any cycle seam (registry, snapshot, clock, runner, or result validation).                               |
   | `projection-worker-sleep-failed` | the between-cycles `sleep` rejected. **A sleep rejection is a failure — it is NOT converted into a successful `aborted` stop.** |

   **A returned runner result is validated before it is used or recorded.** The `outcome` must be one of the seven closed kinds; the returned identity must **match the requested definition** (`projectionName`/`projectionVersion` equal the definition's), and a `retry-scheduled`/`retry-pending` outcome must carry a valid canonical `next_attempt_at`. A malformed or hostile result (unknown outcome, mismatched identity, throwing getter, revoked proxy, bad instant) **fails closed** with `projection-worker-cycle-failed`. The recorded `ProjectionWorkerOutcome` is built from the **registry definition's** validated name/version — never from caller-returned text.

3. **No busy-spin, bounded poll interval.** `progressed` means a projection **advanced a position** (`succeeded`) this pass. A cycle that progressed loops again immediately (more positions are likely available). A cycle that advanced **nothing** yields through the injected `sleep` until the earliest scheduled retry (`next_attempt_at` from a `retry-scheduled`/`retry-pending` outcome) or a bounded poll interval, whichever is sooner. The worker never re-loops hot while every projection is `busy` / `caught-up` / `retry-pending` / `blocked`.

   The poll interval is **locked** to a closed range, validated **before any work** (a violation fails closed with the existing `ProjectionInputError`, and these constants are **internal** — not re-exported from the package root):

   | constant                   | value    | rationale                                                                                                                                                 |
   | -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `MIN_POLL_INTERVAL_MS`     | `100`    | a hard floor: even a fully-idle worker cannot poll more than ten times a second, so a misconfiguration cannot degrade into a hot loop against PostgreSQL. |
   | `DEFAULT_POLL_INTERVAL_MS` | `1_000`  | the unconfigured cadence: one idle poll per second is responsive without being wasteful.                                                                  |
   | `MAX_POLL_INTERVAL_MS`     | `60_000` | a hard ceiling: an idle worker still wakes at least once a minute, so a newly-eligible retry is never starved for longer than a minute.                   |

   `pollIntervalMs` must be **finite, an integer, `>= MIN`, and `<= MAX`**; `MIN`/`MAX` are accepted, `MIN-1`/`MAX+1`/`0`/negatives/decimals/`NaN`/`±Infinity` are rejected. (The wake delay to the next scheduled retry is separately clamped into `[0, pollIntervalMs]`.)

4. **Injected time and a repository-owned abortable sleep.** The worker reads the clock **only** through the injected `now(): CanonicalInstant` and yields **only** through `sleep(ms, signal)`. It never calls `Date.now()` in scheduling logic (`Date.parse` is used only to diff two given canonical instants for the wake delay). Domain time still reaches a handler solely via the event's acceptance instant. Deterministic tests inject both a clock and an immediate recording sleep — there are **no** wall-clock sleeps in the concurrency proofs.

   `sleep` remains injectable (for those deterministic tests) but now **defaults to a repository-owned `abortableSleep`** so a composition root gets a correct implementation for free. `abortableSleep` uses `setTimeout` (never `setInterval`), resolves normally when the timer fires and **early** when the signal aborts, **clears the timer** on abort, **removes its abort listener** on every exit path (normal completion, abort, or a setup/completion fault), resolves **immediately without creating a timer** when the signal is already aborted, and **never rejects** — so it leaves no timer, listener, or unresolved promise. Its cleanup is proven under fake timers (a test-controlled timer seam, no wall-clock waits) for normal completion, already-aborted startup, abort-during-sleep, and post-completion inertness.

5. **Graceful shutdown — drain the active cycle; cancellation belongs to the loop.** Cancellation is observed **only** by `runProjectionWorker`, **never** inside `runProjectionCycle`. A cycle, once begun, **completes its whole registry snapshot** — it offers every definition exactly one `runOnce` invocation and never returns a partial cycle as completed (a cycle stops early **only** if a `runOnce`/seam failure throws, per §2). The loop checks the optional `AbortSignal` **before** beginning a cycle and **after** the complete cycle: once aborted, it lets the active cycle **drain to completion**, then starts **no** following cycle and does **not** sleep. Because each `runOnce` is a complete runner cycle — which releases or destroys its client and auto-releases its advisory transaction lock at COMMIT/ROLLBACK — a drained worker leaves **no** leaked client, advisory lock, open transaction, or timer, and raises no unhandled rejection. This is proven with three projections where the first aborts the signal _during its own invocation_: all three still complete exactly once, the worker reports `stoppedBy: aborted`, no second cycle begins, and no sleep starts.

6. **Injected pool, not owned.** The worker borrows the caller's pool and **never closes it**. Pool lifetime belongs to the composition root (a later CLI, or the test). This keeps the worker a pure, fully-injected, deterministically-testable scheduler.

7. **Injected runner seam.** `runOnce` defaults to `runProjectionOnce`; it is injectable so focused unit tests can script every outcome deterministically without a database. Integration tests use the default against real PostgreSQL 17.

8. **Safe observability.** A cycle returns a frozen `ProjectionCycleResult` and the worker a frozen `ProjectionWorkerSummary`; both carry only closed, non-identifying fields — projection name/version, the closed outcome kind, and counts (there is **no** `error` outcome: a non-result failure aborts the cycle and throws instead). Never a payload, `Error`, message, stack, cause, SQLSTATE, SQL, credential, or caller marker. Full metrics/dashboards remain Phase 13.

9. **Single-version, internal, no export.** The worker drives whatever registry it is given; a version bump replaces the active definition (ADR-0035 policy), and the merged read-model tables can host exactly one version, so the worker is **single-version** by construction. None of the worker vocabulary is exported from the package root — the barrel's exact 39-symbol surface and `exports: ["."]` are unchanged (`public-api.test.ts` still passes).

## Explicit deferrals (NOT in Stage 3.4.5A)

- **The two real read-model handlers** (`rm_event_type_activity`, `rm_daily_event_acceptance`), the **production registry composition** that contains them, and **`apps/worker` activation** — **Stage 3.4.5B** (code-only; the read-model tables and the `qf_jarvis_projection_runtime` grants already exist from migration `0004`).
- **Controlled rebuild and the live-vs-rebuild deterministic proof** — **Stage 3.4.5C**, a **separately reviewed** slice. The two-metadata rebuild workflow itself belongs to Stage 3.4.5C — it does **not** move to Stage 3.6. The **administrative authorization** and the **database-role design** for rebuild (a destructive rebuild needs read-model `DELETE`/`TRUNCATE`, which `qf_jarvis_projection_runtime` deliberately lacks, and it must reconcile with the append-only immutable attempt log) are **unresolved and must be decided in Stage 3.4.5C**. **This slice (3.4.5A) adds no `DELETE`/`TRUNCATE` rights, no migration, no rebuild code, and no administrative command.**
- **`rm_subject_activity`** (a distinct, richer projection) — remains deferred to **Stage 3.6**, per ADR-0022 §9 and the approved staged plan.
- **A worker executable / package `bin`** that reads `DATABASE_URL` and owns+closes a pool — part of Stage 3.4.5B's `apps/worker` activation. Stage 3.4.5A ships the scheduler function only.
- **`apps/worker`** stays an empty compileable boundary in this slice — the worker lives inside `@qf-jarvis/event-backbone` as an internal module (the composition boundary the audit recommended, mirroring `persistence/migrate-cli.ts`); wiring it into `apps/worker` is Stage 3.4.5B.
- **Dead letters, replay, unblock, quarantine** — Stage 3.5.

**Scope discipline.** This ADR concretizes the worker parameters ADR-0034 left open; it does **not** supersede ADR-0022 (rebuild determinism), ADR-0034, PR #22, or the approved staged plan, and it makes **no** rebuild-ownership or rebuild-scope decision — those are Stage 3.4.5C. **Stage 3.4 remains incomplete and Stage 3.5 remains blocked.**

## Migration and managed status

- **No new migration.** Stage 3.4.5A is code-only. Migrations `0001`–`0005` are **byte-for-byte unchanged**; there is **no `0006`**. Managed PostgreSQL remains **`0001`-only**; `0002`–`0005` are unapplied and no managed migration is authorized.

## Consequences

**Positive.** The runner is now drivable: a deterministic, isolation-preserving, no-busy-spin scheduler with injected time/sleep and graceful shutdown, proven against real PostgreSQL 17 (including a genuinely blocked poison projection that does not stall a healthy one, the retry clock gate, and no client/lock leak). It is fully unit-testable through the injected `runOnce` seam. The parameters ADR-0034 left open for the worker are locked here.

**Negative — accepted.** The worker is single-version and does not rebuild; a version bump or rebuild still needs the deferred migration slice. The worker takes an injected pool and sleep rather than owning them, so a composition root (a later CLI) must provide a real abortable sleep and own the pool — deliberately, to keep the scheduler pure and deterministic.
