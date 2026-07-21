# Report 01 — Baseline and Current-Classifier Inventory

**Task:** QFJ-P03.07B — Projection Failure Contracts and Error Taxonomy (implementation).
**Date:** 2026-07-22.

## Baseline

| Fact                               | Value                                                        |
| ---------------------------------- | ------------------------------------------------------------ |
| `main` at start                    | `3bc4a45e88ab5b7d1e1229bf4cd31f09eef846ee` (sync 0 0, clean) |
| PRs #26/#27/#28                    | MERGED                                                       |
| ADR-0040 / -0041 / -0042           | present                                                      |
| `projection-failure-operations.md` | present (authoritative design)                               |
| Migration 0006 / 0007              | **absent**                                                   |
| Package-root runtime surface       | 39 symbols (frozen by `public-api.test.ts`)                  |

## Current classifier behaviour (before this slice)

The runner (`projection-runner.ts`) caught a handler rejection and classified it with `classifyHandlerError(error): 'deterministic' | 'infrastructure'` built on `inspectSqlstate` (a hostile-safe closed tri-state on the value's own `code`):

1. **Where the runner catches handler errors:** inside `executeRun`, around `await definition.apply(client, event)`; on throw it does `ROLLBACK TO SAVEPOINT projection_handler`, then classifies.
2. **How SQLSTATE is read:** `inspectSqlstate` reads the own `code` **data** property via a guarded `Object.getOwnPropertyDescriptor` — never invoking a getter/`valueOf`/`toString`.
3. **How missing SQLSTATE was classified (the defect):** an **absent** code (ordinary `Error`, primitive, or no own `code`) returned `'deterministic'` — so an ordinary bug was recorded as a bounded attempt and could drive the projection to `blocked`.
4. **Invalid/unreadable/hostile values:** an accessor, non-string, malformed code, revoked Proxy, or hostile descriptor trap returned `'invalid'` → `'infrastructure'` (conservative). Correct — retained.
5. **Deterministic attempts:** recorded via `appendFailedAttempt` with the closed safe code `projection-handler-failed`; retry 1–4 schedule backoff, the 5th blocks.
6. **Infrastructure failures:** `abortAndThrow('projection-infrastructure-failed')` — full ROLLBACK, no attempt.
7. **Repository-invariant failures:** reconciliation divergence throws `projection-attempt-checkpoint-divergent`.
8. **Cancellation/shutdown:** owned by the worker (`runProjectionWorker`, ADR-0038) via `AbortSignal`; the runner takes no signal.
9. **Unknown COMMIT outcome:** `projection-commit-outcome-unknown` (unchanged).
10. **Package-root freeze:** `EXPECTED_ROOT_SURFACE` (39) in `public-api.test.ts`; all projection internals are behind the barrel.

## The gap this slice closes

The absent-code → deterministic rule (item 3) is the exact behaviour ADR-0040 flagged as **requiring correction in QFJ-P03.07B**: a value that cannot be **proven** deterministic must not be treated as deterministic. QFJ-P03.07B introduces the five-category taxonomy, an explicit deterministic-handler-failure contract, and routes absent-code/ordinary errors to `UNKNOWN_UNCLASSIFIED_FAILURE` (fail closed, no attempt).

## Scope boundary (unchanged)

No persistence/quarantine/replay/aggregate/ledger; no migration 0006/0007; no SQL; no schema change; no package-root API change; no MVP/agent/RAG/WhatsApp/Core work.
