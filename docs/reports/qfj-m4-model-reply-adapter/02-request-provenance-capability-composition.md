# Report 02 — Exact Request / Provenance / Capability Composition

**Slice:** QFJ-M4. **ADR sections:** [ADR-0057](../../decisions/ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) §C, §D, §F, §I.

## One-way composition with the existing gateway (§C)

The adapter depends on `@qf-jarvis/model-gateway`'s **stable public contracts** — `validateModelRequest` / `ModelRequest`, `ModelResponse`, `ModelRunProvenance`, and the closed `ModelAgentScope` / data-class / result-mode vocabularies — and on `@qf-jarvis/agent-runtime`'s `ModelReplyPort` / `ReplyPlan` / `ModelReleaseRef`. The dependency direction is strictly one-way; there is **no** reverse edge and **no** re-implemented router. The gateway owns provider-release resolution, capability matching, data/execution-class eligibility, rollout, routing, local/hosted selection, failover, timeout/retry/circuit, and provider-error normalization. The adapter selects **no** provider, hard-codes **no** provider/model id, invents **no** fallback, and mutates **no** rollout/capability/evaluation state — proven structurally (the adapter object exposes only `release`, `promptFamily`, `promptVersion`, `capabilityProfileRef`, `evaluationRef`, `draftReply`, `draftReplyDetailed`).

## Exact request binding (§D)

`buildGatewayRequest` produces the gateway's own **validated** `ModelRequest` (via `validateModelRequest`), deeply frozen. It is a `STRUCTURED` request carrying the versioned prompt contract and the strict reply schema, and a **closed scalar metadata set** binding every exact reference:

`conversationId, assignedActor, partyType, taskClass, releaseId, providerId, modelId, modelVersion, configDigest, executionClass, capabilityProfileRef, policyRevision, promptFamily, promptVersion, citationsDigest, citationCount, requestedAt` (+ `evaluationRef` when present).

Properties proven: exact actor/party/task/data-class; exact release/provider/model/version/config/execution; exact prompt (`promptId`/`promptVersion`) and capability/evaluation/policy; an exact **citation-reference digest** (a pure FNV-1a digest that changes when the plan citations change) plus the citation count; a **canonical requested-at instant** (rejected when non-canonical); **no wildcard and no `latest`** (a `*` or `latest` identity is rejected); **no arbitrary metadata** (the metadata key set is closed and every value is a scalar); and **no raw provider SDK object**. The request is **deterministic** — the same plan yields the same request identity.

## Prompt contract (§F)

The system message is an **exact versioned prompt contract** that preserves the authority boundary — Riya client-only, Anisha vendor-only, Jarvis coordinator, QuickFurno Core the final authority — and demands **reply/proposal only** with **exact citations**, forbidding direct execution, n8n, business mutation, and chain-of-thought. The prompt **identity** (`promptId` = `promptFamily`, `promptVersion`) is carried from the plan; there is no free-form, provider-specific prompt construction spread through business logic.

## Exact provenance validation (§I)

After a result returns, `provenanceMatches` requires the gateway `ModelRunProvenance` to match **exactly**: `response.runId` and `provenance.runId` equal the request run id; `provenance.purpose` equals the request purpose; `provenance.providerId/modelId/modelVersion` equal the plan release; and `provenance.promptId/promptVersion` equal the request prompt. Any observable mismatch → `model-provenance-mismatch`, fail-closed, before a `ModelReplyDraft` is returned. The release/config/execution identity that provenance does not expose is **bound into the request** and owned by the gateway's routing/rollout resolution; capability/evaluation/execution-class binding is re-checked at **plan validation** (a plan that does not match this port's exact model identity → `model-plan-invalid`).
