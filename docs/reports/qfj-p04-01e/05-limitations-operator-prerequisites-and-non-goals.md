# Report 05 — Limitations, Operator Prerequisites, and Non-Goals

**Slice:** QFJ-P04.01E — Provider Operations and Rollout Governance. **ADR:** [ADR-0049](../../decisions/ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md).

## Operator prerequisites (all separately owner-authorized, none done here)

This slice ships the rollout controller and policies only. Rolling a real release out later requires, at composition time:

1. **Activated providers** — Groq with its ZDR/data-controls attestation (ADR-0046) and/or the local provider with its endpoint/model/auth-TLS attestations (ADR-0047). A provider without its attestation fails closed and is refused.
2. **A stable release** and, for any exposure, a **candidate release** (`ProviderReleaseRef`) bound by a **`RolloutApprovalAttestation`** (opaque evaluation reference + exact release/digest binding + mode/canary ceilings).
3. **An evaluation approval** for ACTIVE — QFJ-P04.04 supplies the real evaluation evidence; ACTIVE fails closed without a bound, permitting approval.
4. **A governed promotion** through `OFF → SHADOW → CANARY → ACTIVE` via `controller.transition(...)` with monotonic revisions; an emergency `controller.emergencyDisable(...)` at any time.
5. **A gateway wired** with `rolloutController` (and optionally `rolloutObservability`).

No provider is contacted, no key/token is read, and no release is activated in this slice.

## Non-goals — confirmed absent

This slice did **not**, and this report asserts it did not:

- activate any provider or release in production; make any live Groq or local-model call; use a real key/token; or change any provider account or data-control setting.
- implement the full evaluation (QFJ-P04.04); make any compliance/legal claim.
- add automatic promotion, self-approval, an A/B platform, a dynamic cost/latency optimizer, model voting, or parallel/speculative provider calls (shadow is a single sequential non-returning call).
- add a remote ops API, a CLI, or any environment/persistence access; add a database, schema, or migration; reserve or add **migration 0008**; or access a managed database.
- add any agent runtime, Riya/Anisha prompt logic, memory, RAG, model tool-calls, MCP, web search, code execution, provider tools, or n8n.
- widen the existing gateway behaviour (rollout is opt-in; a gateway with no controller is byte-for-byte unchanged) or the `GatewayEvent` contract; deploy anything; or change the event-backbone root API (remains **39**).
- change migrations 0001–0007, the Groq/local/routing sources, or the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory.

## Standing boundary — reaffirmed

The controller and providers hold no business authority; the rollout selects inference only. Riya is client-only, Anisha vendor-only, Jarvis the central coordinator, QuickFurno Core the final business authority, n8n execution-only. Kimi is excluded unless the owner reintroduces it.

## Limitations and exact next action

The controller is exercised only against deterministic injected transports here; any live promotion to ACTIVE requires provider activation (ADR-0046/0047 attestations) and QFJ-P04.04 evaluation approval bound to the exact release/model/version. Sequential shadowing adds latency and is a non-production default pending a latency evaluation. Exact next action: owner review of the DRAFT PR, then (if accepted) a separately authorized expected-head guarded normal two-parent merge. This completes the QFJ-P04.01 model-gateway sub-phase (A–E); the next phase is QFJ-P04.02+ (knowledge/evaluation foundations), with QFJ-P04.04 supplying the evaluation evidence that ACTIVE promotion requires.
