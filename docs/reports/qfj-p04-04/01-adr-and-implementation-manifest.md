# Report 01 — ADR and Implementation Manifest

**Slice:** QFJ-P04.04 — Evaluation and Red-Team Foundation. **ADR:** [ADR-0052](../../decisions/ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md).

## What this slice adds

One dedicated, provider-neutral package — **`@qf-jarvis/model-evaluation`** — implementing a **version-bound, deterministic evaluation and red-team evidence** system. It scores **pre-supplied candidate observations** against synthetic fixtures and closed thresholds, and produces immutable **approval evidence** for later rollout approval. It invokes **no** model. ADR-0052 was committed **first**.

## Boundary (what it does NOT do)

No live Groq/local call, no real key/token, **no LLM-as-judge, no model voting**, no real conversation data; no provider activation, **no rollout promotion**; no database/persistence, no schema, **no migration (0008 absent)**; **no semantic retrieval/embeddings/vector DB/RAG**; no agents/memory/WhatsApp/dashboard/n8n. Depends only on `zod`. Migrations 0001–0007 byte-exact; `@qf-jarvis/event-backbone` root API remains **39**.

## Package layout

```
packages/model-evaluation/
  package.json            (@qf-jarvis/model-evaluation; exports "." and "./testing"; dep: zod)
  tsconfig.build.json     (emitting build; EXCLUDES src/tests → production-only dist)
  tsconfig.json           (noEmit typecheck incl. tests)
  src/
    contracts/
      vocabularies.ts        closed targets/categories/severities/outcomes/scopes/classes/reasons
      errors.ts              EvaluationError + closed construction/gate codes
      instant.ts             pure canonical-instant helper (no wall-clock read)
      digest.ts              pure deterministic content digest (FNV-1a; no node:crypto)
      binding.ts             exact EvaluationBinding + release key + bindingsMatch
      scenario.ts            frozen scenario + ExpectedBehavior
      observation.ts         bounded CandidateObservation (no CoT/raw body/secret/subject id)
      thresholds.ts          versioned SuiteThresholds
      suite.ts               immutable EvaluationSuite (unique scenarios)
      case-result.ts         content-free case result
      suite-result.ts        immutable counts/mandatory/threshold/digest (no average score)
      evidence.ts            immutable, synthetic ApprovalEvidence
      observability.ts       content-free EvaluationEvent + hook + NOOP
    evaluators/
      evaluate-case.ts       one deterministic evaluator per category + dispatcher
    red-team/
      mandatory-suite.ts     the full mandatory red-team coverage set
    service/
      evaluate-suite.ts      the deterministic suite runner + aggregation
      create-evidence.ts     the fail-closed evidence gate
      rollout-bridge.ts      pure one-way rollout reference (mutates nothing)
    testing/
      fixtures.ts            synthetic foundation suite + safe/failing observations (./testing)
      index.ts               ./testing barrel
    index.ts                 public root barrel
    tests/                   deterministic specs (excluded from dist)
```

## Commits (ADR-first, small, auditable)

1. `docs(adr): define QFJ-P04.04 evaluation foundation` — ADR-0052 (committed first).
2. `feat(model-evaluation): add version-bound evaluation contracts`.
3. `feat(model-evaluation): add deterministic evaluators and evidence`.
4. `test(model-evaluation): prove red-team and approval boundaries`.
5. `docs(reports): record QFJ-P04.04 implementation evidence` (this report set + roadmap).

## Base

Branch `qfj-p04-04-evaluation-red-team-foundation`, created from the exact post-P04.03 main
`a4d36faa409e2c56b0cca08ea460314ff0bedaad`. DRAFT PR only — **do not merge** until owner acceptance.
