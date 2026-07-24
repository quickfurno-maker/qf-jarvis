# Report 05 — Exit-Readiness and Non-Goal Audit

**Date:** 2026-07-24. **Slice:** QFJ-P04.01A. **ADR:** [ADR-0045](../../decisions/ADR-0045-qfj-p04-01a-model-gateway-foundation.md).

> QFJ-P04.01A is IMPLEMENTED ON A FEATURE BRANCH / DRAFT PR. Not complete, not merged; merge is separately authorized after owner review.

## Acceptance criteria

| #   | Criterion                                                                        | Status   |
| --- | -------------------------------------------------------------------------------- | -------- |
| 1   | ADR-0045 committed first; implemented without contradiction                      | **PASS** |
| 2   | New `@qf-jarvis/model-gateway` package; provider-neutral contract                | **PASS** |
| 3   | Deterministic `FakeModelProvider` only; no real adapter/key/network              | **PASS** |
| 4   | Hybrid-ready (execution class first-class; Groq-first later; local later)        | **PASS** |
| 5   | Default mode OFF; only OFF/ACTIVE execute                                        | **PASS** |
| 6   | Data-class privacy: LOCAL_ONLY never hosted; HUMAN_ONLY never reaches a provider | **PASS** |
| 7   | Capability routing; deterministic policy order; unavailable excluded             | **PASS** |
| 8   | Timeout/cancellation/retry-budget/circuit/kill-switch                            | **PASS** |
| 9   | Token/cost budgets (refuse, not truncate); concurrency/queue bounded             | **PASS** |
| 10  | Structured-output validation (malformed/invalid fail; no hidden repair)          | **PASS** |
| 11  | Provenance (provider/model/prompt/mode/attempt); safe redaction                  | **PASS** |
| 12  | Gateway authorizes/executes nothing; models propose typed intents only           | **PASS** |
| 13  | Riya/Anisha/Jarvis/Core/n8n boundary preserved; Kimi excluded                    | **PASS** |
| 14  | NO schema/migration; migration 0008 absent/unreserved                            | **PASS** |
| 15  | event-backbone root API remains 39; barrel unchanged                             | **PASS** |
| 16  | No package-manifest change beyond the new package + required workspace wiring    | **PASS** |
| 17  | Format/lint/typecheck/unit/build/dist-containment pass                           | **PASS** |
| 18  | Reports complete; PR remains draft/unmerged                                      | **PASS** |

## Non-goal audit — none breached

No Groq adapter; no local adapter; no network; no API key; no provider SDK; no agent runtime; no Riya/Anisha conversation logic; no memory/RAG/knowledge; no tools/n8n; no database/schema/migration; no deployment; no model training/fine-tuning; no chain-of-thought storage; no full evaluation platform.

## Owner decisions honoured

Groq is the fixed first real provider for the **next** slice (QFJ-P04.01B); a local OpenAI-compatible workstation adapter follows later (QFJ-P04.01C); the gateway (not n8n, not an agent) selects providers; sensitive/`LOCAL_ONLY` data never silently falls back to hosted; Core remains final authority; Kimi excluded.

## Risks and rollback

- **Determinism/reliability**: all time is injected; the circuit/semaphore are deterministic; failure paths are proven with the fake provider — no wall-clock races.
- **Scope**: additive (one new package + required workspace wiring); the event-backbone barrel, migrations, and app boundaries are untouched. Reverting the branch removes the package; nothing else depends on it yet.

## Next

After owner review and merge: **QFJ-P04.01B — Groq Cloud Adapter** (the first real hosted provider), which must still pass privacy, structured-output, budget, fallback, and evaluation (QFJ-P04.04) gates before any agent use; then the local workstation adapter (QFJ-P04.01C) and hybrid routing (QFJ-P04.01D). Managed deployment remains a separate paused lane.
