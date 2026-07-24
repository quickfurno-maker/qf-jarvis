# Report 01 — QFJ-P03 Exit Audit and Evidence

**Date:** 2026-07-24. **Slice:** QFJ-P03.10 — Operational Readiness and Exit Audit (documentation-only closure).

> This report records **completed** evidence and status. It creates no ADR (no new architecture decision), changes no source/schema/migration/test, and makes no managed-deployment or production-readiness claim.

## Locked baseline

- `main` at authoring: `7b31af62e66b15b945f8b30c69dfa0454054746f` (QFJ-P03.09 merged via PR #38).
- Closure branch: `qfj-p03-10-operational-readiness-exit-audit`, from that exact SHA.

## QFJ-P03.01–P03.09 — merged and evidenced

| Subphase   | Capability                          | Evidence                                                                                |
| ---------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| QFJ-P03.01 | Projection Contracts                | projection-definition / registry (internal)                                             |
| QFJ-P03.02 | Persistence Foundation              | **migration 0004** (checkpoint/attempt + two read models)                               |
| QFJ-P03.03 | Commit-Ordered Positions            | **migration 0005** (gap-free `projection_event_position` + trigger)                     |
| QFJ-P03.04 | Projection Registry                 | `projection-registry` / `production-registry`                                           |
| QFJ-P03.05 | Projection Runner (+ worker)        | `projection-runner` `runProjectionOnce`, `projection-worker`                            |
| QFJ-P03.06 | Production Projection Activation    | PR #24 (the two metadata handlers, `apps/worker`)                                       |
| QFJ-P03.07 | Projection Failure Operations (A–G) | PRs #26/#29/#30/#31/#32/#33/#35; **migration 0006**                                     |
| QFJ-P03.08 | Rebuild Determinism and Erasure     | **PR #37**, merge commit `8a9ec8aaaf753fb9566ee9c2ed571bd1e79abf29`                     |
| QFJ-P03.09 | Subject Activity Projection         | **PR #38**, merge commit `7b31af62e66b15b945f8b30c69dfa0454054746f`; **migration 0007** |

## Repository capability inventory (all present on `main`)

- **Append-only event storage** — `qf_jarvis.event` with mutation-rejecting triggers (migration 0001).
- **Deterministic commit-ordered positions** — `projection_event_position` + `SECURITY DEFINER` AFTER-INSERT trigger (0005); `event.sequence` is storage identity only.
- **Atomic checkpoint / read-model writes** — one event per transaction in the runner.
- **Registry + worker** — immutable registry; deterministic name-order traversal; injected clock/sleep; graceful shutdown; startup schema gate.
- **Retry / backoff / failure persistence** — bounded equal-jitter retries; migration 0006 failure aggregate + append-only action ledger.
- **Inspection / block / quarantine / replay** — QFJ-P03.07E/F; generation-guarded, lease-protected, idempotent, one-shot; read-only inspection CLI.
- **Three production projections** — `daily-event-acceptance`, `event-type-activity`, `subject-activity`.
- **Deterministic rebuild + digest** — internal rebuild driver + canonical SHA-256 digest; live == rebuilt proven (real PostgreSQL).
- **Permanent subject tombstone + rebuild survival** — `rm_subject_activity`; erasure survives rebuild; no reactivation.
- **Safe errors / redaction** — closed safe-code vocabularies; full-output redaction sweep.
- **Least-privilege grants** — 0002/0004/0006/0007; the projection role reads metadata + opaque subject only, never payload; no `DELETE`/`TRUNCATE`.
- **Observability + operations** — structured logging, in-process metrics, derived health readers; runbook, alerting spec, query surface.

## Invariants (verified on `main`)

Migrations 0001–0007 present with exact hashes:

```
0001 dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a
0002 4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c
0003 407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c
0004 148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30
0005 96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae
0006 e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4
0007 8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49
```

No migration 0008. Package-root runtime API remains **exactly 39 symbols**. `dist` containment passes (production-only, approved root surface). Local/CI PostgreSQL evidence: unit **2704/2704** (72 files) and integration **404/404** (22 files) green on the QFJ-P03.09 head; CI green.

## Verdict

**No missing repository capability.** QFJ-P03.01–P03.09 are merged and evidenced; QFJ-P03.10 is this operational-readiness exit audit. **The QFJ-P03 repository phase is COMPLETE.** Managed deployment is a distinct, paused lane (report 04); repository QFJ-P04 is unblocked (report 05).
