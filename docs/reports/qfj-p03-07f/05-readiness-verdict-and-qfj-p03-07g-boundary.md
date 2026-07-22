# Report 05 — Readiness Verdict and QFJ-P03.07G Boundary

**Date:** 2026-07-22.

## What QFJ-P03.07F delivered

A safe, explicit, human-authorized, lease-protected, idempotent, crash-recoverable, **one-shot** replay
path for a quarantined projection failure, as an internal replay service:

1. **Authorize** (`quarantined → replay-authorized`): authorized, generation-guarded, divergence-gated,
   single-active-per-failure, future-bounded expiry, atomic (authorization + transition + one
   `replay-authorized` action); the checkpoint stays blocked and no handler runs.
2. **Execute** (one-shot): claim exactly one lease-protected `started` attempt under the name+version
   advisory lock (`replay-authorized → replaying`), apply the **registered** handler to the **exact**
   blocked event, and — on success — atomically apply the read model, **resume the checkpoint exactly one
   position** (the only transition out of `blocked`), succeed the attempt, resolve the failure, consume the
   authorization, and append evidence.
3. **Deterministic replay failure:** record a `failed` attempt, consume the one-shot authorization, return
   the failure to `quarantined` — the **checkpoint stays blocked**, no read model is committed, no
   automatic retry.
4. **Expired-lease takeover:** refused before expiry; abandons the expired attempt and starts a fresh one;
   never executes the handler by itself; idempotent.
5. **Reconcile:** read-only; determines the durable outcome after an ambiguous COMMIT; never a blind retry.

The atomic-success invariant (read-model + checkpoint advance + attempt success + resolution + authorization
consumption + audit = one commit) holds; a replay failure never advances the checkpoint; success advances
exactly one position; there is no skip.

## Scope containment (what this slice did NOT do)

- **No automatic replay; no scheduler, poller, timer, recurring loop, queue consumer, or replay worker
  daemon; no bulk replay; no replay of multiple positions per authorization; no replay without explicit
  authorization; no replay of an unquarantined failure.**
- **No checkpoint skip/jump; no manual checkpoint mutation; no clearing a failure without a successful
  handler application; no generic resolve operation; no automatic divergence repair; no evidence
  deletion/truncation.**
- **No projection-runner or worker behavior change; no event-ordering or advisory-lock-key change.**
- **No dashboard/frontend; no sensitive event payload, stack, raw message, SQL, or read-model row exposed.**
- **No migration change, no migration 0007, no SQL file, no managed deployment, no managed-PostgreSQL or
  Supabase access; no package-root API expansion (39 symbols).**
- **No n8n, WhatsApp, Riya/Anisha, Groq/model-gateway, RAG/pgvector/memory, Core, payment, package,
  marketing, or analytics code. No MVP (M1) runtime work.**

## Readiness posture

- Local: `format:check`, `lint`, `typecheck`, `git diff --check` pass; unit **2533/2533** (59 files),
  including the unchanged 39-symbol public-API test and the migration-conformance/checksum tests.
- Integration (authorize, execute success/failure, idempotency, concurrency, takeover, checkpoint
  resumption, lifecycle gates) runs in **CI** against real PostgreSQL 17; local PostgreSQL is not
  provisioned and was not accessed.
- Migration 0006 checksum unchanged; 0007 absent; managed PostgreSQL untouched.

## QFJ-P03.07G boundary (next)

QFJ-P03.07G — **Observability, Runbook and Exit Audit** — is next: metrics/logs/alerts for the blocked /
authorized / replaying / resolved lifecycle and replay outcomes, the operational recovery objectives, and
the QFJ-P03.07 exit audit. It adds **no** new replay behavior, migration, or managed rollout; the durable
replay path delivered here is the substrate it observes.

## Verdict

**PASS / QFJ_P03_07F_READY_FOR_OWNER_REVIEW** (pending green CI on the exact PR head).
