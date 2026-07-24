# Report 01 — ADR and Implementation Manifest

**Date:** 2026-07-25. **Slice:** QFJ-P04.02 — Model Capability Registry. **ADR:** [ADR-0050](../../decisions/ADR-0050-qfj-p04-02-model-capability-registry.md).

> Implemented on a feature branch / DRAFT PR. Not complete, not merged. Merge is separately authorized after owner review.

## Canonical scope

The roadmap (`docs/architecture/qf-jarvis-roadmap-v3.md`, table row) names **QFJ-P04.02 | Capability Registry | Stage 4.1 (capabilities)** — materially equivalent to the model/provider capability registry this slice implements. Repository terminology is used; no roadmap rename.

## Baseline

- Locked base `main`: `47f19d3371e529052add1bf0fd8114de89203bd9` (QFJ-P04.01E merged via PR #44, two-parent merge of `ab853d2` + `8b1f43e`).
- Feature branch: `qfj-p04-02-model-capability-registry`, from that exact SHA.
- ADR-0050 committed first: `e330389` (`docs(adr): define QFJ-P04.02 model capability registry`).

## What this slice adds

One immutable, version-bound **Model Capability Registry** inside `@qf-jarvis/model-gateway`: a canonical technical record of configured provider/model **release** capabilities bound to exact `ProviderReleaseRef` identities (QFJ-P04.01E). Routing and rollout consume it; a mismatched provider/release is excluded **before invocation**. Registry eligibility is technical inference eligibility only — no business authority, no provider activation. It is **opt-in**: a gateway with no registry behaves exactly as QFJ-P04.01E (its 279 prior tests are unchanged).

**No live Groq or local-model call, no real key/token, no external network, no model discovery. No agent, no WhatsApp/dashboard, no memory/RAG, no n8n, no schema, no migration.**

## Changed-file manifest

**Added — capabilities (`packages/model-gateway/src/capabilities/`):**

| File                        | Responsibility                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `task-classes.ts`           | Closed `MODEL_TASK_CLASSES` and `STRUCTURED_OUTPUT_MODES` vocabularies                          |
| `capability-reasons.ts`     | Closed `CAPABILITY_MATCH_REASONS` + `CapabilityEvent`/hook                                      |
| `capability-profile.ts`     | `ModelCapabilityProfile` + factory (exact release binding; coherence checks); tuple key         |
| `capability-requirement.ts` | `ModelCapabilityRequirement` + factory + `deriveCapabilityRequirement` (no raw content copied)  |
| `capability-match.ts`       | `matchDescriptor` + `matchRequirement` — the single technical match authority (fail closed)     |
| `capability-registry.ts`    | `createModelCapabilityRegistry` — immutable; resolveRelease/resolveDescriptor; frozen summaries |
| `index.ts`                  | Composition surface — no match internals, no tuple-key helper, no provider instance, no secret  |

**Modified — additive integration (opt-in; default path unchanged):**

| File             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/gateway.ts` | Optional `capabilityRegistry` + `capabilityObservability` on `ModelGatewayConfig`; a pre-invocation descriptor pre-filter in `serve()` (a non-resolving provider is marked unhealthy so the existing selection/rollout paths drop it, with a content-free capability event); an exact-release resolution gate (`rolloutReleaseResolves`) for the rollout serving/fallback/shadow release. The foundation/routing/rollout logic is otherwise untouched. |
| `src/index.ts`   | Root barrel re-exports the capability composition + safe types; the match internals, tuple-key helper, and mutable internals stay private                                                                                                                                                                                                                                                                                                              |

**Added — tests:** `src/tests/capability-registry.test.ts` (25 tests: profile/registry validation, matching, gateway/rollout integration, declared-vs-approved).

**Added — docs:** `docs/decisions/ADR-0050-*.md`; this `docs/reports/qfj-p04-02/` set; a narrow `docs/architecture/qf-jarvis-roadmap-v3.md` status update.

## Package / public-API impact

- **No new dependency; no new export subpath** (`exports` map remains `.` and `./testing`); lockfile unchanged.
- The root barrel is **deliberately widened** with the capability composition surface and safe types only. `matchDescriptor`/`matchRequirement`, `profileTupleKey`, and mutable internals are **not** exported. No provider instance or secret is exposed. **No new gateway error code** — a registry mismatch maps to the existing `no-eligible-provider` / `local-provider-required` / `human-only`, and the precise reason travels in a content-free `CapabilityEvent`.

## Files that must NOT change — verified unchanged

- `@qf-jarvis/event-backbone` package-root barrel — unchanged; public-API lock remains **39** symbols.
- Migrations 0001–0007 — byte-identical (SHA-256 asserted in the containment test); **migration 0008 absent** and unreserved.
- The Groq (P04.01B), local (P04.01C), routing (P04.01D), and operations (P04.01E) sources — unchanged (consumed only through the neutral contract/release refs).
- The protected untracked directory `docs/reports/qfj-managed-reconciliation-0002-0005/` — untouched.

## Note on the Stage-A merge (PR #44)

The QFJ-P04.01E branch (PR #44) was merged at its exact head as authorized. During final review one **non-blocking code-hygiene finding** was recorded: `packages/model-gateway/src/operations/canary-bucket.ts` contains a stray `\0` (NUL) byte as the canary hash separator (`` `${rolloutId}\0${runId}` ``). It is functionally benign — the canary derives solely from `rolloutId`+`runId`, remains deterministic, and (given the identifier grammar) is collision-free — but git marks the file "binary". It could not be corrected without breaking the exact-head guard and is out of P04.02 scope; a dedicated one-line follow-up (separator → a space) is recommended.

## Commit plan (staged)

1. `docs(adr): define QFJ-P04.02 model capability registry` — **committed** (`e330389`).
2. `feat(model-gateway): add immutable capability registry` — task classes + reasons + profile + requirement + registry.
3. `feat(model-gateway): enforce version-bound capability matching` — match authority + gateway integration + barrel.
4. `test(model-gateway): prove capability and authority boundaries` — the registry test.
5. `docs(reports): record QFJ-P04.02 implementation evidence` — reports + roadmap.
