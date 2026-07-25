# Report 04 — Knowledge, Evaluation, Privacy, Observability, Tests, and API

**Slice:** QFJ-M2 — Core Decision and Reply Orchestration Foundation. **ADR:** [ADR-0055](../../decisions/ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md).

## Knowledge / evaluation / RAG boundaries

Knowledge is retrieved through an injected **exact** knowledge port only (bounded topics, no free-text/semantic query); a knowledge refusal fails closed **before** the model/Core (proven). Citations remain exact (id/version/source/digest) and a draft may only cite what the plan permits. A model release may carry an exact QFJ-P04.04 `evaluationRef`; when the policy **requires** it, an absent ref is refused before model invocation (proven), and synthetic evaluation is never treated as production approval. **RAG stays disabled** — the orchestration module imports no `@qf-jarvis/rag-provisioning` and performs no semantic/vector/embedding call (proven by source scan).

## Privacy / content

The privacy gate runs before any knowledge/model interface; `HUMAN_ONLY` never reaches a model and `LOCAL_ONLY` never reaches a hosted interface (Report 02). The normalized inbound text is passed **only** to the model port. Observability events carry **no** inbound/reply content, prompt, subject reference, or token (proven — a `SECRET-INBOUND` / `SECRET-REPLY` / subject sentinel never appears in the serialized events).

## Local quality gate — all green

Run against the working tree on branch `qfj-m2-core-decision-reply-orchestration`:

| Gate                      | Command                           | Result                        |
| ------------------------- | --------------------------------- | ----------------------------- |
| Format                    | `pnpm run format:check`           | PASS                          |
| Lint (`--max-warnings=0`) | `pnpm run lint`                   | PASS                          |
| Typecheck (build + tests) | `pnpm run typecheck`              | PASS                          |
| Unit tests (whole repo)   | `pnpm run test:unit`              | **3191 passed / 95 files**    |
| — of which agent-runtime  | 4 files                           | **51 passed** (25 M1 + 26 M2) |
| Build                     | `pnpm run build`                  | PASS (10 packages)            |
| Dist containment          | `pnpm run check:dist-containment` | PASS                          |

## Containment — proven

- The orchestration module imports **no** provider/DB/transport library, **no** `fetch`/`process.env`/`node:` I/O, and **none** of `@qf-jarvis/{model-gateway,governed-knowledge,model-evaluation,rag-provisioning,event-backbone}` — the coupling is entirely through injected ports (proven by source scan).
- The build excludes `src/tests`, so **dist is production-only** (no `*.test.*`); the deterministic port fakes are `./testing`-only.
- Migrations 0001–0007 **byte-exact**; **no 0008**; `@qf-jarvis/event-backbone` root API remains **39**.
- No control byte in any tracked TypeScript file (whole-repo scan).

## Public API — deliberately extended

The root barrel now also exports the M2 surface: the closed proposal-kind/Core-outcome/reason/event-type vocabularies; `createOrchestrationContext`, `createOrchestrationProposal`, `coreDecision`, `createReplyPlan`, `validateReplyDraft`; `createOrchestrator`, `orchestrateInbound`; `NOOP_ORCHESTRATION_OBSERVABILITY`; and the port/result/proposal/decision types. The 27-symbol M1 surface plus 12 M2 value exports is re-locked in the containment test. The test fakes stay under `./testing`; the event-backbone public API is unchanged.
