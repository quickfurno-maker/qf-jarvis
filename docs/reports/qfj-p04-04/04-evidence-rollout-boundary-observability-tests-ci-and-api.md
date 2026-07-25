# Report 04 — Evidence, Rollout Boundary, Observability, Tests, CI, and API

**Slice:** QFJ-P04.04 — Evaluation and Red-Team Foundation. **ADR:** [ADR-0052](../../decisions/ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md).

## Evidence gate

Approval evidence is created **only** on a clean pass (proven): the (optional) expected binding matches, every mandatory case ran, every CRITICAL passed, no blocking HIGH/CRITICAL inconclusive remains, no privacy/authority/data-class/secret/scope violation occurred, every category threshold held, and the case-set digest validates. Any single failure, a blocking inconclusive, or a binding mismatch blocks with a precise code (`evidence-blocked-*` / `binding-mismatch`). Evidence is **immutable, content-free** (no output/secret in the serialization), **target-exact**, marked `synthetic: true` / `productionApproval: false`, and exposes an opaque `evaluationRef`. A deterministic result yields a deterministic `evaluationRef`.

## Rollout boundary (one-way, no mutation)

`toRolloutApprovalReference` projects evidence into a read-only reference (`evaluationRef`, target, release key, `synthetic: true`) a future QFJ-P04.01E rollout may cite. It **mutates no gateway or rollout state, promotes nothing, and activates no provider** (proven: the reference and the evidence carry no `activate`/`promote`/`mutate`/`authorize`/`execute` method). Rollout promotion remains a separate, owner-authorized decision.

## Observability (content-free)

The suite runner emits `suite-evaluated` and per-case `case-evaluated` events; the evidence gate emits `evidence-created`/`evidence-blocked`. Each event carries only suite/release/provider/model ids and versions, a category/severity/outcome/reason, counts, and digests — proven to contain **no** prompt, output text, subject reference, key, or token even when a leak-scenario observation carried a sentinel.

## Local quality gate — all green

Run against the working tree on branch `qfj-p04-04-evaluation-red-team-foundation`:

| Gate                        | Command                           | Result                     |
| --------------------------- | --------------------------------- | -------------------------- |
| Format                      | `pnpm run format:check`           | PASS                       |
| Lint (`--max-warnings=0`)   | `pnpm run lint`                   | PASS                       |
| Typecheck (build + tests)   | `pnpm run typecheck`              | PASS                       |
| Unit tests (whole repo)     | `pnpm run test:unit`              | **3113 passed / 88 files** |
| — of which model-evaluation | 4 files                           | **43 passed** (new)        |
| Build                       | `pnpm run build`                  | PASS (8 packages)          |
| Dist containment            | `pnpm run check:dist-containment` | PASS                       |

## Containment — proven

- Depends **only** on `zod`; exposes only `.` and `./testing`.
- Production source has **no** `fetch`, `process.env`, `node:` I/O import, provider SDK import, `n8n`/excluded-vendor term, or `embedding`/`vector`/`cosine`/`RAG` (proven by source scan).
- The build excludes `src/tests`, so **dist is production-only** (no `*.test.*`); the synthetic `./testing` fixtures are the only test-support export.
- Migrations 0001–0007 **byte-exact** (sha-256 locked); **no 0008**; `@qf-jarvis/event-backbone` root API remains **39**.
- No control byte in any tracked TypeScript file (whole-repo scan).

## Public API — additive and neutral

The root barrel exports the closed vocabularies, the binding/scenario/observation/threshold/suite factories, the `evaluateSuite`/`createApprovalEvidence`/`toRolloutApprovalReference` services, the evaluator identity constants, the mandatory red-team set, the content digest, and the error/observability types. It does **not** export the synthetic fixtures (those live under `./testing`) or the internal `evaluateCase` dispatcher.
