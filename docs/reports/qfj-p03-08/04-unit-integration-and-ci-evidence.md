# Report 04 — Unit, Integration, and CI Evidence

**Date:** 2026-07-24. **Slice:** QFJ-P03.08. **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

## Local validation — executed results

| Gate             | Command                                             | Result                                                                       |
| ---------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Format           | `prettier --check .`                                | **PASS**                                                                     |
| Lint             | `eslint . --max-warnings=0`                         | **PASS** (incl. the new projections-`handlers` purity block)                 |
| Typecheck        | `tsc --build tsconfig.json`                         | **PASS**                                                                     |
| Unit tests       | `vitest run` (unit config)                          | **PASS — 2692/2692 across 70 files** (from 2659/67; +33 across 4 files)      |
| Integration      | `vitest run --config vitest.integration.config.mjs` | **PASS — 396/396 across 21 files** (from 391/20; +5)                         |
| Build            | `tsc --build && copy-sql-assets`                    | **PASS**                                                                     |
| Dist containment | `check-dist-containment.mjs`                        | **PASS** — "dist is production-only … exports are the approved root surface" |

Integration ran against the sanctioned **loopback** Docker PostgreSQL 17 test database (`127.0.0.1:55432/qf_jarvis_test`, `--locale=C`), guarded three ways by `database-test-utils.ts` (loopback host, test-database name, forbidden-substring denylist incl. `supabase`). It **fails, never skips**, without `DATABASE_URL` (repository CI policy). No managed/Supabase host was contacted; no connection string was printed.

## New test files and what they prove

| File                                     | Tests | Kind                  | Proves                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ----- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projection-rebuild-digest.test.ts`      | 15    | unit                  | canonical encoding (bigint/int/Date/date-string/null), unsupported-value fail-closed, determinism/order-sensitivity, SHA-256 shape, SQL projections                                                                                                            |
| `projection-rebuild.test.ts`             | 12    | unit                  | horizon capture, ascending exactly-once traversal, position-only metadata, horizon-0 no-op, beyond-horizon exclusion, gap/read/handler/invalid aborts, no reducer-text leak                                                                                    |
| `projection-reducer-purity.test.ts`      | 9     | unit                  | the purity rule flags clock/`new Date()`/randomness/env/network/fs-crypto imports; a pure reducer is clean; the rule is wired to `projections/handlers/**`                                                                                                     |
| `projection-rebuild.integration.test.ts` | 5     | integration (real PG) | live==rebuilt digest for both read models + repeatable; horizon-0 no-op; rollback-contained rebuild leaves read model/checkpoint/attempts/failures unchanged; committed rebuild creates no checkpoint/attempt/failure rows; synthetic erasure survives rebuild |

## Required-test-matrix coverage (ADR/prompt §7)

Every item is covered: live/rebuild equality for both read models (integration); synthetic erasure survives rebuild (integration); fixed horizon captured once and later positions excluded (unit + integration); position-only ordering, no `Event.sequence` (unit + reader contract); gap fails closed, repeated rebuild identical, exactly-once handler invocation, safe bounded abort, hostile-value non-leak (unit); isolation from live checkpoint / attempt / failure / ledger / quarantine / replay and mid-rebuild abort safety (integration); canonical BIGINT/UTC-timestamp/DATE/null encodings and unsupported-value rejection, all-authoritative-columns-included / none-excluded (unit); no `ProjectionEvent` widening and no root-API expansion (source + `public-api.test.ts` 39); migrations 0001–0006 exact and 0007 absent (conformance suites + direct check); purity lint catches an intentional violation and passes valid reducers (unit); real-PostgreSQL fail-not-skip (harness).

## CI

CI evidence on the exact draft-PR head (workflow run, check names, status/conclusion, and test counts) is recorded in the external completion report and in report 05 once the draft PR is opened and its run completes. Run 30090256579 belongs to the earlier design PR (#36) and is **not** reused as this implementation's evidence.
