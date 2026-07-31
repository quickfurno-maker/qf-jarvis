# ADR-0066 — Shared Agent Runtime Execution Boundary

**Status:** Accepted — QFJ-S3-B
**Deciders:** Owner
**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0012](./ADR-0012-runtime-contract-validation.md) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · [ADR-0058](./ADR-0058-asynchronous-runtime-integration-boundaries.md)

## Context

S3-A was scoped as "create the Riya/Anisha/Jarvis runtime contracts". A reconciliation audit found
that **it was already done**. `@qf-jarvis/agent-runtime` (ADR-0054, accepted 2026-07-25) already owns
agent identity, the actor×party scope rule, the inbound envelope, the conversation-state machine,
proposal-only decisions at `PENDING_CORE_VALIDATION`, the closed reason vocabulary and the normalized
error type — with 39 root exports and 60 passing tests. ADR-0055 then added the 15-stage
`orchestrateInbound` pipeline, which already enforces takeover/pause/scope/freshness/privacy/data-class,
calls injected ports, double-gates before Core, and returns an immutable result.

Exactly one contract family was missing: **provenance**. A repository scan found no provenance record
and no `QUICKFURNO_CORE` authority marker anywhere in the package.

## Decision

### 1. No duplicate contracts were created

The S3-A specification would have introduced a second role enum
(`CLIENT_SALES`/`VENDOR_CUSTOMER_CARE`/`COORDINATION_ROUTING`), a second participant vocabulary
(`INTERNAL_USER` and `SYSTEM` as _party types_), and a second five-disposition result model. All three
were **rejected**.

- The merged model keeps `RUNTIME_PARTY_TYPES = CLIENT | VENDOR | UNKNOWN` and treats `HUMAN` and
  `SYSTEM` as **actors**, not party types. That separation is deliberate and is retained.
- The Riya-client-only / Anisha-vendor-only invariant stays expressed **once**, as
  `isActorPartyCompatible` / `assertActorPartyCompatible`. Two mechanisms enforcing the same boundary
  can drift apart, and a drifted role boundary is the most dangerous defect this package can have.
- `RUNTIME_CHANNELS` retains `WHATSAPP` as a channel **vocabulary**. It is not an integration, and
  removing it would break merged callers for a cosmetic rule.

### 2. Provenance — the one genuine gap

`createRuntimeProvenance` produces a frozen, content-free record: actor, contract version `1`, runtime
and policy references, optional opaque prompt/model/provider/release/config references, correlation id,
canonical instant, `authority: QUICKFURNO_CORE`, `modelOutputRetention: DISCARDED`.

Every field is an identifier, an enum, a bounded opaque reference or a canonical instant. The schema is
`.strict()`, so an unknown key is a **refusal**, not a passenger — which is what makes "no prompt, no
model output, no credential, no URL, no header, no HTTP status, no body, no provider message, no stack,
no cause" an enforced property rather than a promise.

`authority` and `modelOutputRetention` are stamped, never accepted from a caller. A caller cannot claim
a different authority or assert that output was retained.

### 3. The shared entry point is a composition, not a second pipeline

`runAgentTurn(orchestrator, input)` delegates the entire decision path to the merged
`orchestrateInbound` and adds provenance. It re-decides nothing.

This is deliberate. ADR-0055's change-control rule states that adding a processing stage or a port
field requires a superseding ADR — and re-implementing the ordering here would have created exactly the
second gate-and-assignment mechanism §1 rejects. Composition gives the pipeline order for free and makes
it impossible for the shared runtime to disagree with the orchestrator.

Consequently `runAgentTurn` **cannot** override actor×party compatibility, bypass human takeover or AI
pause, fabricate a Core decision, approve a proposal, persist a transition, or send anything. It has no
code path to do so, because it never makes those decisions.

**The merged `OrchestrationResult` was not changed.** Provenance is returned as a sibling field on a new
`AgentTurnResult`, so ADR-0055's governed shape is untouched and no superseding ADR is required.

### 4. Pipeline order

1–13 are inherited verbatim from `orchestrateInbound` (ADR-0055 §C): validate envelope · read
revision-bound context · enforce takeover / pause / scope / freshness / privacy / data-class · retrieve
exact knowledge · plan · invoke the injected model port · validate the draft · double-gate · build a
`PENDING_CORE_VALIDATION` proposal · obtain the injected Core decision · return an immutable result.

14. `runAgentTurn` stamps provenance for **every** outcome — including refusals.
15. It returns one frozen `AgentTurnResult`.

A refusal is attributed to `SYSTEM`. Attributing a blocked turn to Riya or Anisha would record an action
that never happened.

### 5. Decision ports stay provider-neutral

The injected `ModelReplyPort`, `CoreDecisionPort`, `ConversationContextPort` and `KnowledgePort` remain
as ADR-0055 defined them. They receive no credential, no database handle and no transport handle.
S3-B calls no provider; a later phase may implement a port over the Model Gateway.

At-most-once is inherited: `orchestrateInbound` calls each port at most once and never retries, and this
slice adds no call of its own on any path. When a gate blocks, **zero** port calls occur — proved with
counting fakes for both the AI-pause and human-takeover paths.

### 6. Public API

39 → **45** root runtime exports. Six additive symbols: `createRuntimeProvenance`,
`RUNTIME_PROVENANCE_VERSION`, `RUNTIME_PROVENANCE_AUTHORITY`, `RUNTIME_MODEL_OUTPUT_RETENTION`,
`runAgentTurn`, `SHARED_RUNTIME_VERSION`. One additive error code, `invalid-provenance`. No symbol was
removed or changed, no default export, and no provider-, transport- or storage-specific symbol reached
the root — asserted.

### 7. Placement and dependency direction

Everything lives inside `packages/agent-runtime`, which already depends only on `zod`. No new package,
no new dependency, no dependency on `model-gateway`, and therefore no cycle.

## Rejected alternatives

- **A new S3-A contracts package.** It would have duplicated eight of eleven contract families and
  created a second source of truth for the role boundary.
- **Threading provenance through `orchestrateInbound`.** Cleaner-looking, but it changes an
  ADR-0055-governed result shape and processing order, which that ADR's change-control rule reserves for
  a superseding decision.
- **The five-disposition result model** (`RESPOND`/`ROUTE`/`HANDOVER`/`PROPOSE_ACTION`/`REFUSE`). The
  merged `OrchestrationResult` plus `ORCHESTRATION_PROPOSAL_KINDS` already carries those semantics.

## Consequences

Later Riya, Anisha and Jarvis phases get one shared entry point that is provably unable to bypass the
authority model, and every turn — served or refused — now carries an auditable, disclosure-free
provenance record. Nothing is persisted, executed, sent or activated.

## Non-goals

No Riya sales behaviour, no Anisha service behaviour, no Jarvis routing prompts, no prompt text, no
memory, no tools, no transport, no WhatsApp, no n8n, no database write, no deployment, no provider call.

## Change-control rule

Adding a provenance field, changing either stamped literal, or giving `runAgentTurn` any decision of its
own requires a superseding ADR. Provenance never carries content; authority is always
`QUICKFURNO_CORE`; retention is always `DISCARDED`; the shared runtime composes the merged pipeline and
never replaces it; Riya stays client-only and Anisha vendor-only through the single merged mechanism.
