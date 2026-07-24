# Report 01 — Design and Implementation Manifest

**Date:** 2026-07-24. **Slice:** QFJ-P04.01A — Model Gateway Foundation. **ADR:** [ADR-0045](../../decisions/ADR-0045-qfj-p04-01a-model-gateway-foundation.md).

> Implemented on a feature branch / DRAFT PR. Not complete, not merged. Merge is separately authorized after owner review.

## Baseline

- Locked base `main`: `c77faf6de887e9456d7a4063cf433b0e33056610` (QFJ-P03 repository-complete).
- Feature branch: `qfj-p04-01a-model-gateway-foundation`, from that exact SHA.

## What this slice adds

A new provider-neutral package **`@qf-jarvis/model-gateway`** — the single governed waist every model call passes through — plus a deterministic `FakeModelProvider`. **No real provider adapter, no key, no network, no agent, no schema/migration.** ADR-0045 was committed first.

## Changed-file manifest

**Added — new package (`packages/model-gateway/`):**

| Area           | Files                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| manifest/build | `package.json` (dep: zod only; exports `.` + `./testing`), `tsconfig.json`   |
| contracts      | `src/contracts/{enums,capabilities,request,response,provider,provenance}.ts` |
| errors         | `src/errors/gateway-error.ts` (20 closed safe codes)                         |
| reliability    | `src/reliability/{clock,semaphore,circuit-breaker}.ts`                       |
| budgets        | `src/budgets/budget-policy.ts`                                               |
| observability  | `src/observability/events.ts`                                                |
| routing        | `src/routing/select-providers.ts`                                            |
| gateway        | `src/gateway.ts`, `src/index.ts` (root barrel — no fake provider)            |
| test double    | `src/testing/{fake-model-provider,index.ts}` (the `./testing` subpath)       |
| tests          | `src/tests/{gateway,contracts,containment}.test.ts` (46 unit tests)          |

**Modified — workspace integration (strictly required for the new package):** root `tsconfig.json` (add the project reference), `pnpm-lock.yaml` (add the model-gateway importer + its zod dependency).

**Added — docs:** `docs/decisions/ADR-0045-*.md`; this `docs/reports/qfj-p04-01a/` set; a narrow `docs/architecture/qf-jarvis-roadmap-v3.md` status update.

## Files that must NOT change — verified unchanged

- `@qf-jarvis/event-backbone` package-root barrel `index.ts` — unchanged; its public-API lock remains **39** symbols.
- Migrations 0001–0007 — byte-identical; **migration 0008 absent** and unreserved.
- No `apps/`, `.github/` (CI), `scripts/`, event-backbone/event-ingestion/contracts source change.
- `docs/reports/qfj-managed-reconciliation-0002-0005/` — untracked and untouched.

## Dependency proof

`@qf-jarvis/model-gateway` depends on **`zod@4.4.3` only** (already in the monorepo). **No** provider SDK (Groq/OpenAI/Anthropic/Ollama/llama), **no** network library (axios/undici/node-fetch), **no** database dependency, **no** env/secret loader. Proven by the containment test.

## Managed boundary

No managed/local database access; no migration executed; no secret read; no deployment. Managed PostgreSQL remains at migration 0001; 0002–0007 unapplied; managed migration + password-rotation lanes remain paused.
