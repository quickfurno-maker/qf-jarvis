# Report 05 — Declared-vs-Approved Boundary, Limitations, and Non-Goals

**Slice:** QFJ-P04.02 — Model Capability Registry. **ADR:** [ADR-0050](../../decisions/ADR-0050-qfj-p04-02-model-capability-registry.md).

## Declared-vs-approved boundary (the central discipline)

- P04.02 records **configured/declared** technical capability. It never fabricates evaluation approval.
- A profile may carry an **opaque** `evaluationApprovalRef` for future filtering, but it is a reference — not evidence and not a boolean approval.
- **QFJ-P04.04** remains the authority for evaluation evidence (per-provider/per-model parity).
- **Registry presence alone never permits ACTIVE.** ACTIVE rollout still requires the QFJ-P04.01E approval binding; a registry match cannot substitute for it (proven: an ACTIVE run whose candidate release is not registered is refused pre-invocation).

## Operator prerequisites (all separately owner-authorized, none done here)

To use the registry against real releases later, at composition time: build a `ProviderReleaseRef` per configured release; build a `ModelCapabilityProfile` per release from evaluated/declared capability data; construct one `ModelCapabilityRegistry`; and set it on `ModelGatewayConfig.capabilityRegistry`. Activation of any release still requires provider attestations (ADR-0046/0047) and QFJ-P04.04 evaluation approval.

## Non-goals — confirmed absent

This slice did **not**, and this report asserts it did not:

- activate any provider or release; make any live Groq or local-model call; use a real key/token; change any provider console/data-control setting.
- perform model discovery, a `/models` call, model benchmarking, or evaluation/red-team execution.
- add a prompt library, training/fine-tuning, memory/RAG/knowledge retrieval, agents, WhatsApp/dashboard, or the Conversation Operations Center.
- add tools/MCP/web/code execution/provider tools or n8n.
- add a database/persistence, a schema, or a migration; reserve or add **migration 0008**; or access a managed database.
- widen the existing gateway behaviour (the registry is opt-in; a gateway with no registry is byte-for-byte unchanged) or the `GatewayEvent` contract; deploy anything; or change the event-backbone root API (remains **39**).
- change migrations 0001–0007, the Groq/local/routing/operations sources, or the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory.

## Standing boundary — reaffirmed

The registry selects no business outcome and grants no business authority. Riya client-only, Anisha vendor-only, Jarvis the central coordinator, QuickFurno Core final authority, n8n execution-only. The Jarvis Conversation Operations Center remains mandatory in later agent/WhatsApp/dashboard phases (all active conversations visible, searchable WhatsApp history, assignment/status/escalation/AI-pause/human-takeover, Core-owned authoritative conversation record, n8n transport/execution only) — deferred and **not** implemented here. Kimi excluded.

## Limitations and exact next action

The registry is populated from configured/declared data validated only against deterministic tests here; real evaluation evidence and approval come from QFJ-P04.04. This completes the QFJ-P04.02 capabilities slice. Exact next action: owner review of the DRAFT PR, then (if accepted) a separately authorized expected-head guarded normal two-parent merge; the next roadmap slices are QFJ-P04.03 (Governed Knowledge System), QFJ-P04.04 (Evaluation and Red-Team Framework — the authority for ACTIVE approval), and QFJ-P04.05 (No-Op RAG Provisioning).
