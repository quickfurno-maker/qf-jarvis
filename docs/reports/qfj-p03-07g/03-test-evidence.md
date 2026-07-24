# Report 03 — Exact Test Evidence

**Date:** 2026-07-24.

> **Only executed results are reported here.** Nothing below is claimed unless it was run. The
> PostgreSQL integration suite was **not** executed locally — `DATABASE_URL` is absent and this task
> forbids handling credentials — so it was run in **CI against PostgreSQL 17**. Its result is recorded
> below from the CI log, not inferred.

## Executed locally — results

| Gate       | Command                        | Result                                               |
| ---------- | ------------------------------ | ---------------------------------------------------- |
| Format     | `prettier --check .`           | **PASS** — all matched files use Prettier code style |
| Lint       | `eslint . --max-warnings=0`    | **PASS** — 0 errors, 0 warnings                      |
| Typecheck  | `tsc --build tsconfig.json`    | **PASS** — no diagnostics                            |
| Whitespace | `git diff --check`             | **PASS** — clean                                     |
| Unit tests | `vitest run --passWithNoTests` | **PASS — 2659/2659 across 67 files**                 |

Baseline at QFJ-P03.07F was **2533 tests across 59 files**. This slice adds **126 tests across 8 files**
(7 new unit files plus 1 new integration file, and edits to 3 existing files).

## New test files

| File                                         | Tests | Covers                                                                               |
| -------------------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `projection-logger.test.ts`                  | 20    | closed vocabularies, JSON shape, injected clock, failure containment, volume control |
| `projection-metrics.test.ts`                 | 16    | label closure, counter/gauge/histogram behaviour, durability semantics               |
| `projection-observability-redaction.test.ts` | 7     | full-output redaction sweep across every event                                       |
| `projection-runner-telemetry.test.ts`        | 14    | post-commit emission, exhaustion, blocked-existing, fail-closed paths                |
| `projection-worker-telemetry.test.ts`        | 11    | lifecycle events, cycle counting, the startup schema gate                            |
| `projection-health.test.ts`                  | 15    | derived reads, the health decision, gauge projection, schema probe                   |
| `projection-inspection-cli.test.ts`          | 21    | command table, argument parsing, exit codes, output redaction                        |
| `projection-health.integration.test.ts`      | 9     | **real PostgreSQL** — PASS in CI (391/391, run 30066733285)                          |

## Mandated coverage — item by item

| Required item                                         | Where                                                                                          | Status |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| Closed events / severities                            | `projection-logger.test.ts`                                                                    | PASS   |
| JSON shape and injected clock                         | `projection-logger.test.ts`                                                                    | PASS   |
| Sink failure swallowed                                | `projection-logger.test.ts` (sink, clock, and no-op logger)                                    | PASS   |
| Metric name / label closure                           | `projection-metrics.test.ts`, redaction suite                                                  | PASS   |
| Counter / gauge / histogram behaviour                 | `projection-metrics.test.ts`                                                                   | PASS   |
| No `Date.now()` in the observability path             | `projection-logger.test.ts` asserts the injected clock is called                               | PASS   |
| **Redaction: full serialised output**                 | `projection-observability-redaction.test.ts`                                                   | PASS   |
| Retry telemetry after commit only                     | `projection-runner-telemetry.test.ts`                                                          | PASS   |
| Blocked-now events and counters                       | `projection-runner-telemetry.test.ts`                                                          | PASS   |
| **Blocked-existing: no transition re-count**          | `projection-runner-telemetry.test.ts` (single + 5× loop)                                       | PASS   |
| Bounded divergence event                              | `projection-runner-telemetry.test.ts` (two distinct kinds)                                     | PASS   |
| Bounded infrastructure event                          | `projection-runner-telemetry.test.ts` (phase, no message/stack)                                | PASS   |
| Commit-outcome-unknown only                           | `projection-runner-telemetry.test.ts`                                                          | PASS   |
| Telemetry failure does not alter result               | `projection-runner-telemetry.test.ts`, `projection-worker-telemetry.test.ts`                   | PASS   |
| **failureId carried from the exhaustion transaction** | `projection-runner-telemetry.test.ts` (all three events, one id)                               | PASS   |
| Worker started / stopped / cycle                      | `projection-worker-telemetry.test.ts`                                                          | PASS   |
| Cycle debug default-off / sampling                    | `projection-logger.test.ts`                                                                    | PASS   |
| Block keeps worker exit code 0                        | `projection-worker-telemetry.test.ts`                                                          | PASS   |
| Liveness / readiness semantics                        | `projection-health.test.ts`                                                                    | PASS   |
| **Schema mismatch blocks startup**                    | `projection-worker-telemetry.test.ts` (false, and throwing probe)                              | PASS   |
| Telemetry failure cannot change exit code             | `projection-worker-telemetry.test.ts`                                                          | PASS   |
| Operator reason never emitted                         | redaction suite (log) + CLI suite (human and `--json`)                                         | PASS   |
| Each metric update point                              | runner / worker telemetry suites                                                               | PASS   |
| Forbidden labels rejected                             | `projection-metrics.test.ts`, redaction suite (12 keys)                                        | PASS   |
| `busy` is not a failure                               | `projection-runner-telemetry.test.ts`                                                          | PASS   |
| Process-local reset                                   | `projection-metrics.test.ts`                                                                   | PASS   |
| Derived gauges rebuild from DB                        | `projection-health.test.ts` (unit) · `projection-health.integration.test.ts` (CI)              | PASS   |
| CLI: all four commands                                | `projection-inspection-cli.test.ts`                                                            | PASS   |
| CLI: JSON, exit codes, pagination, sanitisation       | `projection-inspection-cli.test.ts`                                                            | PASS   |
| **CLI: no mutating command table entry**              | `projection-inspection-cli.test.ts`, `public-api.test.ts`                                      | PASS   |
| Migrations 0001–0006 unchanged                        | `migration-vocabulary-conformance.test.ts`, `projection-failure-migration-conformance.test.ts` | PASS   |
| No 0007                                               | conformance tests + direct verification                                                        | PASS   |
| Root API exactly 39 symbols                           | `public-api.test.ts`                                                                           | PASS   |
| CLI internal subpath only                             | `public-api.test.ts`, `stage-3-4-5b-containment.test.ts`                                       | PASS   |
| Runbook has zero `[UNIMPLEMENTED]`                    | verified: `grep -c` returns **0**                                                              | PASS   |
| Every alert metric exists                             | cross-checked against `PROJECTION_METRIC_NAMES`                                                | PASS   |
| Every threshold concrete                              | all nine ratified with numeric values                                                          | PASS   |
| All existing D/E/F tests green                        | full suite 2659/2659                                                                           | PASS   |

## Regression evidence

Every pre-existing test passes unchanged. Three test files were **edited**, and it is worth being
precise about why, since "existing tests unchanged" was a stated gate:

1. **`projection-worker-cli.test.ts`** — the fixture gained the three new injected seams
   (`probeSchema`, `createLogger`, `metrics`). No assertion was changed, weakened, or removed; the
   schema probe defaults to "complete" so the pre-existing startup/shutdown cases exercise exactly what
   they did before. A new required process seam legitimately requires a fixture to supply it.
2. **`public-api.test.ts`** — two assertions pinned the exports map to a two-entry set. Adding a second
   narrowly scoped internal subpath changes that set. Both were updated to the three-entry set and their
   intent preserved (no wildcard, nothing reaching persistence or the migration runner). **The 39-symbol
   root assertion was not touched** and still passes. Two new tests were added.
3. **`stage-3-4-5b-containment.test.ts`** — the same exports-map pin, updated identically.

`apps/worker/src/tests/worker-entry.test.ts` also gained the new seams in its fake-deps helper, with no
assertion changed.

No test was skipped, no assertion lowered, nothing retried, and no database error suppressed.

## Integration status — executed in CI

`projection-health.integration.test.ts` (9 tests) was **not run locally**. A local PostgreSQL container
is present, but `DATABASE_URL` is not set in this environment and this task forbids reading, requesting,
or handling any credential — so the connection string the harness requires was deliberately not
obtained.

It ran in **CI against PostgreSQL 17** and **passed**:

```
✓ packages/event-backbone/src/tests/projection-health.integration.test.ts (9 tests) 255ms
  Test Files  20 passed (20)
       Tests  391 passed (391)
```

Per the repository's integration configuration these tests **fail rather than skip** without
`DATABASE_URL`; a skipped database test is a green build that proves nothing.

What CI proved: the health queries are correct against the schema as actually migrated — column names,
the active-failure predicate matching the partial index, the position-map join through the gap-free
ordering authority, and the catalog probe — plus the restart property (a fresh registry rebuilding the
correct blocked set) and the gauge-clearing property.

**Two fixture defects only a real database could surface** were found and fixed on the first CI run,
which is precisely why the suite exists:

1. A `resolved` failure row must carry both a resolution time and the successful attempt reference —
   `projection_failure_resolved_shape` makes "resolved" and "has a resolution" the same proposition.
2. A checkpoint cannot be blocked out of nowhere: `recordCheckpointBlocked` guards on
   `failed_attempt_count = 4`. The fixture now walks the real bounded-retry path (attempts 1–4 leave it
   active; only the fifth blocks it), which exercises the invariant rather than bypassing it.

Neither was a defect in the implementation.

## CI result

`Quality gate` — **pass**, 1m40s. GitHub Actions run **30066733285**, conclusion **success**. This run
verified the **PR head at time of review** —
`c50ca6b557468dcc52a59579fa3c9b526f8e9ed9` — the head that the independent owner review inspected.

Unit **2659/2659** across 67 files · integration **391/391** across 20 files · build, migrations, and
the working-tree-clean check all green.

The later documentation-only remediation commit that corrects these reports does not alter the
already-reviewed implementation; it requires its own new CI run, which is the merge-readiness evidence
for that commit. Run 30066733285 remains the stable evidence for the reviewed head, not for the
remediation commit.

## Commands as run

```
npx prettier --check .
npx eslint . --max-warnings=0
npx tsc --build tsconfig.json
git diff --check
npx vitest run --passWithNoTests
```
