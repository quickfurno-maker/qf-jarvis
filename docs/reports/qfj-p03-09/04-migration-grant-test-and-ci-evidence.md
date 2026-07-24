# Report 04 — Migration, Grant, Test and CI Evidence

**Date:** 2026-07-24. **Slice:** QFJ-P03.09. **ADR:** [ADR-0044](../../decisions/ADR-0044-qfj-p03-09-subject-activity-projection.md).

## Migration 0007

- `0007_subject_activity_projection.sql`, SHA-256 `8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49`.
- Creates `qf_jarvis.rm_subject_activity` with the 0001-mirroring subject grammar and active/tombstone shape CHECKs; grants the projection role `SELECT(subject_type, subject_id)` on `event` and `SELECT/INSERT/UPDATE` on the read model (no DELETE/TRUNCATE).
- Migrations **0001–0006 unchanged** (hashes identical to the locked baseline). Migration set is now 0001–0007 with no 0008; the migration-set conformance tests were updated accordingly.

## Local validation — executed results (all PASS)

| Gate             | Command                                             | Result                                                                              |
| ---------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Format           | `prettier --check .`                                | **PASS**                                                                            |
| Lint             | `eslint . --max-warnings=0`                         | **PASS** (incl. the subject-reader boundary + reducer purity)                       |
| Typecheck        | `tsc --build tsconfig.json`                         | **PASS**                                                                            |
| Unit             | `vitest run` (unit)                                 | **PASS — 2704/2704 across 72 files** (from 2692/70; +38 net across 3 new + updates) |
| Integration      | `vitest run --config vitest.integration.config.mjs` | **PASS — 404/404 across 22 files** (from 396/21; +8, real PostgreSQL 17)            |
| Build            | `tsc --build && copy-sql-assets`                    | **PASS**                                                                            |
| Dist containment | `check-dist-containment.mjs`                        | **PASS** — approved root surface, production-only                                   |

Integration ran against the sanctioned **loopback** Docker PostgreSQL 17 test database only (`127.0.0.1:55432/qf_jarvis_test`, `--locale=C`), triple-guarded by `database-test-utils.ts`; it **fails, never skips**, without `DATABASE_URL`. No managed/Supabase host was contacted; no connection string was printed.

## New tests and what they prove

| File                                   | Tests | Kind                  | Proves                                                                                                                                                                                                                   |
| -------------------------------------- | ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projection-subject-reader.test.ts`    | 8     | unit                  | opaque-grammar accept/reject, non-positive & missing position, over-length & non-string, frozen result, no raw-value leak                                                                                                |
| `projection-subject-boundary.test.ts`  | 5     | unit                  | the restricted-import rule fires; it is wired to the metadata reducers only; subject reader not root-exported; `ProjectionEvent` unchanged                                                                               |
| `subject-activity.integration.test.ts` | 8     | integration (real PG) | activity accumulation + namespacing; permanent tombstone (before/after/repeated/isolation); live==rebuild digest incl. erased state; rebuild leaves checkpoint unchanged; grant proof (subject readable, payload denied) |

Updated conformance/registry tests (migration set 0001–0007; three-projection production registry; least-privilege now grants subject columns) keep the full suite green with no assertion weakened.

## Required-matrix coverage

Subject validation, visibility boundary, tenant/namespace isolation, activity accumulation, first/last position & timestamp, count, position ordering, no-subject-N/A, erasure before/after/repeated, permanent-no-reactivation, second-subject-unaffected, pre-erasure-no-resurrection-on-rebuild, rebuild digest equality incl. erased state, hostile subject values, redaction, grant proof (subject readable / payload denied), checkpoint atomicity via the unchanged runner, no P03.07 regression (full suite), root API 39, migration conformance (0001–0006 exact; 0007 present), real-PostgreSQL fail-not-skip — all covered.

## CI

CI evidence on the exact draft-PR head (workflow run, check, conclusion, counts) is recorded in the external completion report once the draft PR is opened and its run completes. This slice's evidence is that new run, not any prior run.
