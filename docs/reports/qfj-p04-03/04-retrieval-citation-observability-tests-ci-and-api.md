# Report 04 — Retrieval, Citation, Observability, Tests, CI, and API Evidence

**Slice:** QFJ-P04.03 — Governed Knowledge System. **ADR:** [ADR-0051](../../decisions/ADR-0051-qfj-p04-03-governed-knowledge-system.md).

## Bounded exact retrieval

Retrieval is deterministic, exact, and bounded (proven): retrieve by exact id/version; by exact topic; by a bounded multi-topic list; `maxRecords` and the content-size bound both fail closed (`knowledge-limit-exceeded`); the same request against the same registry returns an identical result; there is **no** free-text/semantic query field and **no** unrestricted list-all operation on the registry. No model or network call occurs — the package imports no `node:` I/O module, no provider SDK, and uses no `fetch`/`process.env` (proven by source scan).

## Citation / provenance

Every returned record carries a **frozen citation** — knowledge id, exact version, source reference, source revision, authority tier, `effectiveFrom`, optional `expiresAt`, and content digest (proven). A retired **audit** lookup is a **separate** path that returns a citation and lifecycle state — **never content** — and cannot be mistaken for a current retrieval (no `ok`/`records`; proven).

## Observability (content-free)

Retrieval reports every outcome through an injected hook as a `KnowledgeEvent` carrying only a run id, agent scope, knowledge id/version/topic, authority tier, classification, a closed reason, and a count. Proven: a served event and denied/expiry/conflict events are emitted with the correct reason, and the serialised events contain **no** document content, prompt/message, subject reference, key, or token.

## Local quality gate — all green

Run against the working tree on branch `qfj-p04-03-governed-knowledge-system`:

| Gate                                  | Command                           | Result                     |
| ------------------------------------- | --------------------------------- | -------------------------- |
| Format                                | `pnpm run format:check`           | PASS                       |
| Lint (whole repo, `--max-warnings=0`) | `pnpm run lint`                   | PASS                       |
| Typecheck (build + per-package tests) | `pnpm run typecheck`              | PASS                       |
| Unit tests (whole repo)               | `pnpm run test:unit`              | **3070 passed / 84 files** |
| — of which governed-knowledge         | 4 files                           | **60 passed** (new)        |
| Build                                 | `pnpm run build`                  | PASS (7 packages)          |
| Dist containment                      | `pnpm run check:dist-containment` | PASS                       |

Integration tests require the CI PostgreSQL service; this slice touches no database, schema, or migration, so they are unaffected.

## Containment — proven

- The package depends **only** on `zod`; it exposes only `.` and `./testing`.
- Production source has **no** `fetch`, `process.env`, `node:` I/O import, provider SDK import, or `embedding`/`vector`/`semantic`/`RAG`/`n8n`/excluded-vendor term (proven by source scan).
- The build (`tsconfig.build.json`) excludes `src/tests`, so **dist is production-only** (no `*.test.*`, no fixtures); the shipped `./testing` gate is the only test-support export.
- Migrations 0001–0007 are **byte-exact** (sha-256 locked) and there is **no 0008**; the `@qf-jarvis/event-backbone` root API remains **39**.
- No control byte exists in any tracked TypeScript file (whole-repo scan, after the Stage A hygiene fix).

## Test inventory (60 cases across 4 spec files)

| File                       | Coverage (matrix items)                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge-record.test.ts` | record/lifecycle validation (1–7, 9, 10) + transitions                                                                          |
| `registry.test.ts`         | ordering, duplicate/conflict, exact/topic lookup, supersession existence/newer/cycle, snapshot (12–21)                          |
| `retrieval.test.ts`        | freshness/authority/conflict (8, 22–29), permissions/privacy (30–42), bounded retrieval (43–51), citation/observability (52–57) |
| `containment.test.ts`      | authority/integration boundaries (58–65), public-API lock, migrations/API/control-byte containment (66–76)                      |

## Public API surface — additive and neutral

The root barrel exports the closed vocabularies, the record/request factories and the immutable registry factory, the retrieval authority and audit lookup, the citation/result/privacy-gate/observability types, and the closed error/reason vocabularies. It does **not** export the test privacy gate (that lives under `./testing`), the conflict-resolution internals, or the per-record eligibility helper. The `@qf-jarvis/event-backbone` public API is unchanged (remains **39**).
