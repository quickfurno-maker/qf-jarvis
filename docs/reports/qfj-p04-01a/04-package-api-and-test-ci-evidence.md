# Report 04 — Package API and Test/CI Evidence

**Date:** 2026-07-24. **Slice:** QFJ-P04.01A. **ADR:** [ADR-0045](../../decisions/ADR-0045-qfj-p04-01a-model-gateway-foundation.md).

## Package API boundary

- `@qf-jarvis/model-gateway` exports exactly two entry points: the root `.` (stable provider-neutral contracts + `createModelGateway` + errors + budget/observability/clock injectables) and `./testing` (the `FakeModelProvider` test double). Proven by the containment test.
- The root barrel exposes **no** provider SDK type, **no** internal router/circuit/semaphore, **no** mutable registry, and **not** `FakeModelProvider`.
- The `@qf-jarvis/event-backbone` root API is untouched and remains **exactly 39 symbols** (its barrel and public-API lock are unchanged).

## Local validation — executed results (all PASS)

| Gate             | Command                          | Result                                                                      |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------- |
| Format           | `prettier --check .`             | **PASS**                                                                    |
| Lint             | `eslint . --max-warnings=0`      | **PASS**                                                                    |
| Typecheck        | `tsc --build tsconfig.json`      | **PASS** (root references now include the new package)                      |
| Unit             | `vitest run`                     | **PASS — 2750/2750 across 75 files** (from 2704/72; +46 across 3 new files) |
| Build            | `tsc --build && copy-sql-assets` | **PASS** (6 packages)                                                       |
| Dist containment | `check:dist-containment`         | **PASS** (event-ingestion scanner unaffected)                               |

No database was used or connected — this slice has no database. The new package's tests are pure unit tests over the deterministic `FakeModelProvider` (no network, no env, no key).

## New tests (46) and what they prove

| File                  | Focus                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway.test.ts`     | mode/kill-switch/human-only gates; data-class privacy (LOCAL_ONLY never hosted); deterministic order; capability mismatch; unavailability excluded; single fallback + single response; structured-output validation; timeout/cancel/retry/circuit; token/cost/concurrency/queue budgets; provenance; redaction; no authorize/execute; invalid-request rejection |
| `contracts.test.ts`   | request validation (structured needs schema, text forbids one; closed scopes/data-classes; frozen; no chain-of-thought); capability matching; error normalization; FakeModelProvider determinism (no network/env/key; records only safe run ids)                                                                                                                |
| `containment.test.ts` | depends only on zod; exports only `.`/`./testing`; fake provider not root-exported; no network/SDK/env/fs I/O in production source; no real adapter; no Kimi; event-backbone API 39; migrations 0001–0007 exact; no 0008                                                                                                                                        |

## Required-matrix coverage

All 50 matrix items are covered by the three test files (core behaviours in `gateway.test.ts`, contract/vocabulary in `contracts.test.ts`, and the containment items 37–50 in `containment.test.ts`). No PostgreSQL integration test is required — this slice has no database.

## CI

CI evidence on the exact draft-PR head (workflow run, check, conclusion, counts) is recorded in the external completion report once the draft PR is opened and its run completes.
