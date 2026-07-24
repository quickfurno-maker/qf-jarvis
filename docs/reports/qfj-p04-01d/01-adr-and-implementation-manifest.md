# Report 01 — ADR and Implementation Manifest

**Date:** 2026-07-24. **Slice:** QFJ-P04.01D — Hybrid Routing and Failover. **ADR:** [ADR-0048](../../decisions/ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md).

> Implemented on a feature branch / DRAFT PR. Not complete, not merged. Merge is separately authorized after owner review.

## Baseline

- Locked base `main`: `932574150ff25f5d67eb6a20fd0ca3a3fc2368b5` (QFJ-P04.01C merged via PR #42, two-parent merge of `55a948f` + `6aaa754`).
- Feature branch: `qfj-p04-01d-hybrid-routing-failover`, from that exact SHA.
- ADR-0048 committed first: `0220dd5` (`docs(adr): define QFJ-P04.01D hybrid routing`).

## What this slice adds

An explicit, immutable, validated **hybrid-routing policy** and a **bounded failover matrix** over the existing Groq (HOSTED) and local (LOCAL) providers, behind the unchanged `ModelProvider` contract. Routing is **opt-in**: a gateway with no `routingProfile` behaves exactly as the foundation (its 191 prior tests are unchanged). When a policy is present, provider selection is deterministic (execution class first by profile, then configured order) and the single fallback is gated by why the primary failed.

**No live Groq or local-model call, no real key/token, no external network in tests/CI. No agent, no n8n, no RAG, no memory, no schema, no migration.** Routing selects inference only and authorizes/executes nothing.

## Changed-file manifest

**Added — routing (`packages/model-gateway/src/routing/`):**

| File                       | Responsibility                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `routing-reasons.ts`       | Closed, safe vocabularies: profiles, exclusion reasons, fallback-decision reasons, transient allowlist |
| `hybrid-routing-policy.ts` | `createHybridRoutingPolicy` — validated, frozen policy; execution-class preference per profile         |
| `routing-plan.ts`          | `buildRoutingPlan` — deterministic eligibility + ordering; frozen content-free summary                 |
| `failover-policy.ts`       | `decideFallover` — the bounded failover matrix (pure decision)                                         |
| `attempt-ledger.ts`        | `AttemptLedger` — one shared per-run budget; at most one fallback / one accepted response              |

**Modified — additive integration (opt-in; default path unchanged):**

| File                          | Change                                                                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway.ts`              | Optional `routingProfile` on `ModelGatewayConfig`; a `serveHybrid` branch (plan → ledgered primary → gated single fallback) taken only when a policy is present; a `runProviderLedger` helper. The foundation path is untouched.             |
| `src/observability/events.ts` | Added a safe `routing-decided` event type and optional content-free fields (`profile`, `dataClass`, `fallbackReason`)                                                                                                                        |
| `src/index.ts`                | Root barrel re-exports the routing composition + safe observability types (policy/factory, reason vocabularies, `RoutingPlanSummary`, `AttemptLedgerSnapshot`) — the mutable ledger, plan/provider refs, and failover internals stay private |

**Added — tests:** `src/tests/hybrid-routing.test.ts` (50 tests: policy, plan, failover, ledger, gateway integration).

**Added — docs:** `docs/decisions/ADR-0048-*.md`; this `docs/reports/qfj-p04-01d/` set; a narrow `docs/architecture/qf-jarvis-roadmap-v3.md` status update.

## Package / public-API impact

- **No new dependency; no new export subpath** (`exports` map remains `.` and `./testing`); lockfile unchanged.
- The root barrel is **deliberately widened** with the routing composition surface and safe observability types only. `buildRoutingPlan`, `decideFallover`, and the `AttemptLedger` class are **not** exported — they are internal to the gateway. `FakeModelProvider` remains absent from the production root.

## Files that must NOT change — verified unchanged

- `@qf-jarvis/event-backbone` package-root barrel — unchanged; public-API lock remains **39** symbols.
- Migrations 0001–0007 — byte-identical (SHA-256 asserted in the containment test); **migration 0008 absent** and unreserved.
- The Groq adapter (P04.01B) and the local adapter (P04.01C) — unchanged (integrated only through the neutral contract).
- The protected untracked directory `docs/reports/qfj-managed-reconciliation-0002-0005/` — untouched.

## Commit plan (staged)

1. `docs(adr): define QFJ-P04.01D hybrid routing` — **committed** (`0220dd5`).
2. `feat(model-gateway): add hybrid routing policy` — reasons + policy + plan.
3. `feat(model-gateway): enforce bounded failover` — failover + ledger + gateway wiring + events + barrel.
4. `test(model-gateway): prove hybrid privacy and attempt bounds` — the routing test.
5. `docs(reports): record QFJ-P04.01D implementation evidence` — reports + roadmap.
