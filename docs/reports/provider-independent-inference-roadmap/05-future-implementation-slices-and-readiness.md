# Report 05 — Future Implementation Slices and Readiness

**Date:** 2026-07-21. **Documentation only — no provider implemented, no API called, no key used, no WhatsApp activated, no migration created. QFJ-P03 remains the active priority.**

## Future implementation slices (planning only)

| Slice                                                | Scope                                                                                                              | Dependencies              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| **QFJ-P04.01A** — Provider-Neutral Contracts         | repository-owned `ModelProvider` interface; bounded request/response + provenance; `FakeModelProvider` test double | QFJ-P04.01 gateway        |
| **QFJ-P04.01B** — Groq Cloud Adapter                 | `GroqProvider` behind the contract; sanitized requests; key injected at deploy time                                | A                         |
| **QFJ-P04.01C** — Local OpenAI-Compatible Adapter    | `LocalOpenAICompatibleProvider`; mTLS/allowlist transport to the local node                                        | A                         |
| **QFJ-P04.01D** — Hybrid Routing and Failover        | explicit, idempotent, non-duplicating fallback; single accepted reply per turn                                     | B, C                      |
| **QFJ-P04.01E** — Provider Operations and Governance | health, budgets, capacity, monitoring, kill switch, activation governance                                          | D                         |
| **QFJ-P04.04** — Evaluation parity                   | per-provider/per-model gates before activation                                                                     | A–E                       |
| **QFJ-P11.06** — Inference Deployment Profiles       | the five owner-selected profiles (config only)                                                                     | QFJ-P04.01A–E, QFJ-P04.04 |
| **QFJ-P12** — Local scaling                          | multi-node, multi-GPU, optimization, local specialists, LoRA/fine-tuning, Groq controlled fallback                 | QFJ-P11.06                |

## Dependencies and gating

- No slice touches provider code until QFJ-P04 (Model Gateway) is reached; QFJ-P03 remains the active priority and is unchanged.
- Any production provider/model activation requires QFJ-P04.04 evaluation approval.
- Deployment mode is an owner decision at QFJ-P11.06 (configuration only).
- No migration is required or allocated for this extension; a future provenance-persistence need follows the ADR-0039 migration-allocation rule.

## Readiness checklist (design-level)

- Provider-neutral contract defined; agents/transport never import provider types. ✅ (design)
- Five operating modes with explicit, idempotent, non-duplicating fallback. ✅ (design)
- Deployment/credential boundaries (VPS vs local PC) fixed. ✅ (design)
- Security/privacy/memory invariants formalized. ✅ (design)
- Evaluation parity across providers/models required. ✅ (design)
- Rollback to `HUMAN_ONLY` always available. ✅ (design)

## Confirmations

- **Roadmap extension only.** No provider implemented; no API called; no key used; no WhatsApp activated; no migration created; no SQL created; no external system accessed.
- **No new major roadmap phase; no renumbering.** Extends QFJ-P04.01, QFJ-P04.04, QFJ-P11, QFJ-P12.
- **Agent authority unchanged;** provider selection never alters it.
- **Current QFJ-P03 work remains the active priority** and was not changed by this task.

## Next owner decision

Approve this roadmap extension. Implementation is gated behind reaching QFJ-P04 and, for any provider activation, QFJ-P04.04 evaluation approval; deployment mode is chosen at QFJ-P11.06.
