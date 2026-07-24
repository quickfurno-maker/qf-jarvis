# Report 05 — Activation Boundary, Limitations, and Non-Goals

**Slice:** QFJ-P04.01D — Hybrid Routing and Failover. **ADR:** [ADR-0048](../../decisions/ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md).

## Activation boundary (all separately owner-authorized, none done here)

This slice ships the routing policy and failover logic only. Using it against live providers later requires, at composition time:

1. **Activated providers** — Groq with its ZDR/data-controls attestation (ADR-0046) and/or the local provider with its endpoint/model/auth-TLS attestations (ADR-0047). Without a positive attestation a provider's `health()` fails closed and it is excluded.
2. **A chosen profile** — `HOSTED_FIRST` is the MVP default while Groq is primary; `LOCAL_FIRST` is available for a future workstation-primary deployment. Both are evaluation-approved (QFJ-P04.04) before a live switch.
3. **A validated policy** — `createHybridRoutingPolicy({...})` supplying the deterministic provider order per class, the fallback flag, the transient allowlist, and `maxTotalAttempts`.
4. **A gateway mode flip** to `ACTIVE` with `routingProfile` set.

No provider is contacted, no key/token is read, and no profile is activated in this slice.

## Non-goals — confirmed absent

This slice did **not**, and this report asserts it did not:

- activate any provider in production; make any live Groq or local-model call; use a real key/token; or change any provider account or data-control setting.
- add any adaptive scoring, cost optimizer, latency optimizer, model voting, A/B or percentage traffic, or autonomous dynamic profile.
- add `SHADOW`/`CANARY` traffic duplication or any parallel/speculative provider call (deferred to QFJ-P04.01E).
- add any agent runtime, Riya/Anisha prompt logic, memory, RAG, model tool-calls, MCP, web search, code execution, provider tools, or n8n.
- touch any database, schema, or migration; reserve or add **migration 0008**; or access a managed database.
- widen the existing gateway mode behaviour (routing is opt-in; a gateway with no `routingProfile` is byte-for-byte unchanged), deploy anything, or change the event-backbone root API (remains **39**).
- change migrations 0001–0007, the Groq or local adapters, or the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory.

## Standing boundary — reaffirmed

Routing selects inference only; the gateway and providers authorize and execute nothing. Riya is client-only, Anisha vendor-only, Jarvis the central coordinator, QuickFurno Core the final business authority, n8n execution-only. Kimi is excluded unless the owner reintroduces it.

## Limitations and exact next action

The routing policy is exercised only against deterministic injected transports here; the choice and activation of a live profile are gated on provider activation (ADR-0046/0047 attestations) and QFJ-P04.04 evaluation approval. Exact next action: owner review of the DRAFT PR, then (if accepted) a separately authorized expected-head guarded normal two-parent merge. The natural next slice is **QFJ-P04.01E (Provider Operations and Governance)** — SHADOW/CANARY rollout, provider-operations telemetry, and activation governance.
