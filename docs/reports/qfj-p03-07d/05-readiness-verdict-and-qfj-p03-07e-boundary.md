# Report 05 — Readiness Verdict and QFJ-P03.07E Boundary

**Date:** 2026-07-22.

## What QFJ-P03.07D delivered

The production projection runner's **fifth deterministic failure** is now connected to the QFJ-P03.07C
failure-persistence foundation. In one READ COMMITTED transaction, under the name+version advisory lock,
the runner atomically establishes the whole exhaustion state:

**final deterministic attempt + blocked checkpoint + blocked position + exactly one active failure aggregate + `created` action = one atomic transaction.**

A later invocation that finds an already-blocked checkpoint proves the active-failure biconditional
(exactly one active failure, at the blocked position) before returning `blocked-existing`, failing closed
on a divergence and never repairing. Only the deterministic-exhaustion path creates an aggregate; every
non-deterministic category still rolls back and creates none.

## Scope containment (what this slice did NOT do)

- **No operator inspection API, acknowledgement API, or quarantine command** — the runbook stays design-only.
- **No replay authorization endpoint, replay execution, replay worker, lease renewal, scheduler, timer, or poller.**
- **No automatic failure repair or skip** — divergence fails closed.
- **No failure notification infrastructure.**
- **No new migration, no migration 0007, no SQL file, no change to migrations 0001–0006, no managed
  deployment, no managed-PostgreSQL or Supabase access.**
- **No package-root API expansion** (39 symbols) and **no change to the success path, attempts 1–4,
  infrastructure/unknown/invariant/cancellation classification, event ordering, projection registration,
  production handlers, worker startup/scheduling, or build entrypoints.** No new worker or service is started.
- **No MVP (M1) runtime work.**

## Readiness posture

- Local: `format:check`, `lint`, `typecheck`, `git diff --check` pass; unit **2488/2488** (57 files),
  including the unchanged 39-symbol public-API test and the migration-conformance/checksum tests.
- Integration (fifth-failure atomicity, failure injection, concurrency, restart, ambiguous commit,
  non-deterministic containment) runs in **CI** against real PostgreSQL 17; local PostgreSQL is not
  provisioned and was not accessed.
- Migration 0006 checksum unchanged; 0007 absent; managed PostgreSQL untouched.

## QFJ-P03.07E boundary (next)

QFJ-P03.07E — **Operator Inspection and Quarantine** — is next: a read-only inspection surface and the
acknowledge/quarantine operator workflow over the now-populated `projection_failure` aggregate and its
append-only action ledger, behind an application/command boundary with the ADR-0040 role model
(READ_ONLY_OPERATOR / FAILURE_OPERATOR / REPLAY_APPROVER / SYSTEM_RUNNER / ADMINISTRATOR). Authorized
replay execution and the lease worker remain QFJ-P03.07F. Until then, a blocked projection has exactly one
sanctioned response: **escalate to engineering** — no manual database edits, no replay, no quarantine
command.

## Verdict

**PASS / QFJ_P03_07D_READY_FOR_OWNER_REVIEW** (pending green CI on the exact PR head).
