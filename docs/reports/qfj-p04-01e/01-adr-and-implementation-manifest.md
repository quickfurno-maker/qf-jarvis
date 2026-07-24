# Report 01 — ADR and Implementation Manifest

**Date:** 2026-07-24. **Slice:** QFJ-P04.01E — Provider Operations and Rollout Governance. **ADR:** [ADR-0049](../../decisions/ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md).

> Implemented on a feature branch / DRAFT PR. Not complete, not merged. Merge is separately authorized after owner review.

## Baseline

- Locked base `main`: `ab853d20ecabb4c1d20add902dea361bc2802995` (QFJ-P04.01D merged via PR #43, two-parent merge of `9325741` + `6f838e6`).
- Feature branch: `qfj-p04-01e-provider-operations-governance`, from that exact SHA.
- ADR-0049 committed first: `9bace6b` (`docs(adr): define QFJ-P04.01E provider rollout governance`).

## What this slice adds

A governed **provider-rollout controller** — OFF → SHADOW → CANARY → ACTIVE with FALLBACK and a synchronous emergency disable — over the existing Groq (HOSTED) and local (LOCAL) providers and the hybrid routing, behind the unchanged `ModelProvider` contract. Rollout is **opt-in**: a gateway with no controller behaves exactly as QFJ-P04.01D (its 241 prior tests are unchanged). The controller consumes already-authorized approval attestations; it is not itself an authorization system, and **it activates no live provider**.

**No live Groq or local-model call, no real key/token, no external network in tests/CI. No agent, no n8n, no RAG, no memory, no schema, no migration.**

## Changed-file manifest

**Added — operations (`packages/model-gateway/src/operations/`):**

| File                     | Responsibility                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `rollout-reasons.ts`     | Closed safe vocabularies (modes, serve targets, operator/refusal reasons, event types) + `RolloutEvent`/hook |
| `provider-release.ts`    | `ProviderReleaseRef` (id/provider/model/version/executionClass/configDigest) + factory                       |
| `rollout-approval.ts`    | `RolloutApprovalAttestation` (opaque eval ref, exact release binding, mode/canary ceilings) + helpers        |
| `rollout-policy.ts`      | `ProviderRolloutPolicy` + factory (mode-specific validation); `offRolloutPolicy` default-OFF seed            |
| `rollout-transitions.ts` | `validateTransition` — the strict promotion/rollback matrix + approval ceilings                              |
| `canary-bucket.ts`       | Deterministic non-security `rolloutId`+`runId` hash → `[0,10000)` cohort                                     |
| `rollout-controller.ts`  | `createProviderRolloutController` — snapshot / transition / emergencyDisable (in-memory, non-global)         |
| `rollout-execution.ts`   | `decideServing` — the pure per-run serving decision (serve/shadow/fallback)                                  |
| `index.ts`               | Operations composition surface — no canary hash, no serving helper, no transition validator, no secret       |

**Modified — additive integration (opt-in; default path unchanged):**

| File             | Change                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway.ts` | Optional `rolloutController` + `rolloutObservability` on `ModelGatewayConfig`; a `serveRollout` branch (serving decision → ledgered serve → optional single shadow / bounded fallback) taken only when a controller is present, with precedence over `routingProfile`; a `runShadow` helper. The foundation/routing paths are untouched. |
| `src/index.ts`   | Root barrel re-exports the operations composition + safe observability types; the canary hash, serving helper, transition validator, and mutable internals stay private                                                                                                                                                                  |

**Added — tests:** `src/tests/provider-operations.test.ts` (38 tests: release/approval/policy, transitions, controller, canary, serving decision, gateway integration).

**Added — docs:** `docs/decisions/ADR-0049-*.md`; this `docs/reports/qfj-p04-01e/` set; a narrow `docs/architecture/qf-jarvis-roadmap-v3.md` status update.

## Package / public-API impact

- **No new dependency; no new export subpath** (`exports` map remains `.` and `./testing`); lockfile unchanged.
- The root barrel is **deliberately widened** with the operations composition surface and safe observability types only. `decideServing`, `validateTransition`, `canaryBucket`/`canaryCohort`, and the approval-binding helpers are **not** exported — they are internal. No provider instance or mutable object is exposed.
- **No new gateway error code** — rollout refusals map to the existing closed codes (`gateway-off`, `local-provider-required`, `human-only`, `no-eligible-provider`, `capability-mismatch`); the precise rollout reason travels in the content-free `RolloutEvent`. The `observability/events.ts` `GatewayEvent` shape is unchanged.

## Files that must NOT change — verified unchanged

- `@qf-jarvis/event-backbone` package-root barrel — unchanged; public-API lock remains **39** symbols.
- Migrations 0001–0007 — byte-identical (SHA-256 asserted in the containment test); **migration 0008 absent** and unreserved.
- The Groq (P04.01B), local (P04.01C), and hybrid-routing (P04.01D) sources — unchanged (integrated only through the neutral contract).
- The protected untracked directory `docs/reports/qfj-managed-reconciliation-0002-0005/` — untouched.

## Commit plan (staged)

1. `docs(adr): define QFJ-P04.01E provider rollout governance` — **committed** (`9bace6b`).
2. `feat(model-gateway): add provider rollout policies` — reasons + release + approval + policy + transitions + canary.
3. `feat(model-gateway): enforce governed rollout modes` — controller + execution + gateway wiring + barrel.
4. `test(model-gateway): prove rollout safety and rollback` — the operations test.
5. `docs(reports): record QFJ-P04.01E implementation evidence` — reports + roadmap.
