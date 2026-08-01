# ADR-0071 — Anisha Authoritative Runtime Composition

**Status:** Accepted — QFJ-S3-D-B
**Deciders:** Owner
**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration-foundation.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0066](./ADR-0066-shared-agent-runtime-execution-boundary.md) · [ADR-0068](./ADR-0068-riya-authoritative-runtime-composition.md) · [ADR-0069](./ADR-0069-bounded-runtime-and-proposal-identifiers.md) · [ADR-0070](./ADR-0070-anisha-vendor-journey-behaviour-boundary.md)

## Context

S3-D-A (PR #73, ADR-0070) built the Anisha vendor-journey kernel as a leaf package that nothing
imported. This ADR gives it reach — and does so without changing the generic orchestrator at all.

The one thing S3-D-B has to solve that S3-C-B did not: the orchestrator accepts exactly **one**
`BehaviourDecisionPort` (ADR-0068 §3), and there are now **two** business agents.

## Decision

### 1. One authoritative path, unchanged

```
createJarvisRuntime -> composeAndProcess -> createOrchestrator
                                         -> runAgentTurn        (exactly once)
                                              -> orchestrateInbound (exactly once)
```

No second runtime, orchestrator, seam, proposal path or model call. **No `agent-runtime` production
file changed**: the generic seam, both gates, the model-at-most-once rule, the
one-`PENDING_CORE_VALIDATION`-proposal rule and Core authority are all reused exactly as merged.

### 2. Riya configuration is preserved verbatim

`JarvisRuntimeConfig.behaviourInput?: ClientSalesBehaviourInputPort` is **not renamed, retyped,
aliased or generalised**. It is externally visible TypeScript API, and its generic-sounding name is a
naming debt from when Riya was the only agent. Renaming it for tidiness would be a breaking change
that buys nothing; the debt is recorded here and left alone.

One additive, non-breaking field is introduced:

```ts
readonly vendorJourneyBehaviourInput?: VendorJourneyBehaviourInputPort;
```

### 3. The vendor input contract

`VendorJourneyBehaviourInputPort.read({ conversationId, revision })` returns
`{ signals, context?, promptRef } | undefined`. Optional, read-only, async, revision-bound, called at
most once and only for a VENDOR turn assigned to Anisha, and only after the complete first gate.

It carries no actor, party type, takeover, pause, cancellation, privacy state, inbound or normalized
text, provider payload or message reference, prompt body, vendor identity, profile, document,
portfolio, verification body, lead, package catalogue, price, balance, credits, payment, subscription,
ranking, assignment, campaign data, Core outcome, authority state, metadata bag, callback or
send/execute/persist function. Money reaches Anisha as a band inside the signals (ADR-0070 §4), never
as an amount. Conversation control still comes from the ONE `AuthoritativeConversationStatePort`.

### 4. The Anisha adapter

`composition/anisha-behaviour-adapter.ts`, the vendor twin of the Riya adapter and the only other
layer allowed to know both `anisha-agent` and the generic seam. It reads the input port once, calls
`decideAnishaTurn` once, and maps the disposition. It creates no proposal, calls no model or provider,
sends nothing, persists nothing, routes nothing and assigns nobody.

Order inside `decide`: role precheck → input read → signals validation → `promptRef` validation →
authoritative-state read → decision. The precheck comes first so a client turn cannot cost a
vendor-input call, and the state read comes last so a malformed supplier answer is refused before any
further work.

### 5. The deterministic mux

`composition/behaviour-mux.ts` selects at most one adapter by **exact pair matching** on the
`(assignedActor, partyType)` the merged router already decided:

- `CLIENT` + `RIYA` → the Riya adapter, if configured;
- `VENDOR` + `ANISHA` → the Anisha adapter, if configured;
- anything else → `undefined`, the legacy default.

It reads the routing decision; it never makes one, so M1 stays the single assignment authority.

**No iteration, no "first one that answers", no registry, no string-keyed map, no dynamic discovery,
no service locator, no retry, no mutation — and above all no cross-agent fallback.** A selected
adapter returning `undefined` is the turn's answer; a selected adapter rejecting is the turn's answer.
The other adapter is never consulted on any path. "Ask each until one answers" would let a client turn
cost a vendor-input read, and let a vendor refusal be quietly answered by Riya — two failures that are
invisible in a passing suite and serious in a real conversation.

Consequence: **at most one behaviour-input read and at most one agent decision per turn.**

### 6. Disposition → M2 mapping

| Anisha disposition          | M2 kind             | Model | `replyBody` |
| --------------------------- | ------------------- | ----- | ----------- |
| `DRAFT_REPLY`               | `REPLY`             | 1     | present     |
| `CONTINUE_CLARIFICATION`    | `REPLY`             | 1     | present     |
| `PROPOSE_VENDOR_FOLLOW_UP`  | `FOLLOW_UP`         | 1     | present     |
| `REQUEST_VENDOR_ESCALATION` | `ESCALATE_TO_HUMAN` | **0** | absent      |
| `REFUSE`                    | `NO_ACTION`         | **0** | absent      |

**No new M2 kind.** `FOLLOW_UP` already exists from ADR-0068.

`CONTINUE_CLARIFICATION → REPLY`, not `REQUEST_CLARIFICATION`, for the reason ADR-0068 established:
the authoritative reply chain can carry vendor-facing text only under `REPLY`, so the other kind would
discard the clarifying question itself. The clarification meaning survives in `structuredIntent`.

### 7. Why `REQUEST_VENDOR_ESCALATION` maps to `ESCALATE_TO_HUMAN`

ADR-0070 kept the disposition **target-neutral** because a behaviour kernel cannot see which
coordinator or person executes. The generic M2 vocabulary has no Jarvis-coordination kind, so
`ESCALATE_TO_HUMAN` is used here as the existing **Core-review escalation category**.

This mapping produces exactly one `PENDING_CORE_VALIDATION` proposal for QuickFurno Core to review. It
does **not** execute a human handoff, send anything to anyone, bypass Jarvis, change assignment,
persist, or create a transport action. The executor remains outside this composition.

If governance later requires the M2 proposal itself to distinguish `JARVIS_COORDINATION` from
`HUMAN_HANDOFF`, that is a separate bounded M2 vocabulary change under a superseding ADR. It is
deliberately not done here.

### 8. Two guards

**Follow-up completeness.** When the mapped kind is `FOLLOW_UP`, `decision.context?.completeness` must
be `SUFFICIENT_FOR_CORE_REVIEW`, or the adapter throws. It reads `decision.context` — the frozen
canonical record `decideAnishaTurn` re-derived — and never the supplier's object. Reading the supplier
again would reintroduce exactly the boundary hole commit `d1d25c5` closed.

**Eligibility consistency.** The mapping table's expected model boolean must equal
`decision.modelReplyEligible`, or the adapter throws. If the two ever drift apart the mapping has
stopped describing the behaviour it claims to translate, and picking one would hide that.

### 9. `structuredIntent`

Exactly `taskClass`, `replyKind`, `behaviourVersion`, `vendorJourneyIntent`, `disposition`, plus
`contextCompleteness` when a context exists. Scalars only.

Absent by design: `promptRef`, `packageReadinessBand`, `vendorStageRef`, `onboardingStepRef`,
`verificationStatusRef`, `missingFields`, vendor identity, money, lead, package, payment,
subscription, raw text, model output, Core outcome, authority state and any metadata bag. A proposal
records **what was decided**, not the business data it was decided from — and copying a readiness band
onto a proposal would put money-adjacent data there for no decision-making reason.

### 10. Provenance and identities

The default `runtimeRef` moves `qfj.jarvis-runtime.s3cb` → **`qfj.jarvis-runtime.s3db`**. Not a
version bump for its own sake: S3-D-B materially changes what this composition _is_, and default
provenance should name the implementation that actually ran. An explicit
`config.provenanceRefs.runtimeRef` still overrides it untouched.

No other provenance change. Actor is the assigned actor on success — `ANISHA` for a served vendor turn
— and `SYSTEM` on refusal; authority stays `QUICKFURNO_CORE`; retention stays `DISCARDED`; correlation
still defaults to `envelope.messageId`. The per-turn vendor `promptRef` never enters provenance,
`structuredIntent`, observability or the Core command.

The three correlation-adjacent identities stay separate (ADR-0069): `runId` is `envelope.runtimeId`,
provenance correlation defaults to `envelope.messageId`, and `config.correlationId` belongs to the M3
Core adapter. A stale comment in `process-inbound.ts` still described `runId` as a concatenation —
untrue since ADR-0069 — and is corrected while touching the file. Behaviour is unchanged.

### 11. No new outcome, no new vocabulary

`JarvisRuntimeOutcome` is unchanged. With Core wired the existing mapping applies; with Core absent a
model-backed proposal is `MODEL_DRAFTED` and a no-model proposal is `NO_ACTION`, so an Anisha
escalation without a Core transport flows through the existing no-Core semantics. No
`ANISHA_ESCALATED`, `VENDOR_FOLLOW_UP`, `VENDOR_ACTION` or `JARVIS_COORDINATION` outcome was invented.
Observability events and fields are unchanged, and no vendor intent or business data was added to
them.

### 12. Dependency graph

```
jarvis-runtime ──► agent-runtime
       ├──► core-decision-adapter ──► agent-runtime
       ├──► model-reply-adapter ────► agent-runtime
       ├──► riya-agent ─────────────► agent-runtime
       └──► anisha-agent ───────────► agent-runtime
```

Acyclic. The two behaviour packages are siblings that never import each other. No new third-party
dependency; the lockfile gains only the workspace edge.

### 13. Public API

`jarvis-runtime` root **runtime** symbols remain exactly **6**; only three vendor-journey input TYPES
were added. `anisha-agent` remains exactly **14** and was not modified. Every other lock is unchanged.
`anishaBehaviourPort` and `behaviourMux` are internal and are not exported from any root.

## Rejected alternatives

- **A registry or discriminated-union port map.** Premature abstraction for two agents, a wider public
  surface, and it invites iteration — the one shape that breaks the zero-cross-read guarantee.
- **Two behaviour ports on the orchestrator.** Contradicts the one-seam invariant and would need an
  `agent-runtime` change.
- **Retyping `behaviourInput` to a generic union.** A breaking change to visible API for cosmetics.
- **A new M2 kind for Jarvis coordination.** Real, but a separate governed vocabulary change.
- **Falling back to the other agent when the selected one declines.** The failure this design exists
  to prevent.

## Consequences

A VENDOR turn now reaches Anisha through the one authoritative path, producing one
`PENDING_CORE_VALIDATION` proposal with the correct model-call count and provenance attributed to
`ANISHA`. A CLIENT turn behaves exactly as it did before S3-D-B.

## Phase status

**S3-D is complete as engineering work**: the behaviour kernel (S3-D-A) and the composition bridge
(S3-D-B) are both in place, and all five dispositions are reachable through `createJarvisRuntime`.

**No production source supplies `VendorJourneySignals`.** This PR defines and wires the seam and ships
**no supplier of any kind** — no database or Supabase reader, no QuickFurno API caller, no
event-backbone projection reader, no HTTP client, no environment-selected adapter, no static data and
no mock production default. Production stays inert unless a future composition caller explicitly
injects the port. **Production rollout remains OFF.**

## Non-goals

No production input source · no provider or live model call · no database, Supabase, Docker or
migration · no credential or environment read · no deployment or activation · no CANARY/ACTIVE/
FALLBACK · no WhatsApp · no n8n · no memory · no prompt text or registry · no send, deliver, execute
or persist · no vendor approval, verification, activation, ranking, assignment, package, recharge,
payment or complaint resolution — `CORE_ACCEPTED` means Core approved a proposal, never that anything
was applied.

## Change-control rule

One seam, one selected adapter, one behaviour read, one agent decision, at most one model call, one
proposal, one Core decision. Adding a business agent means adding an adapter and one exact pair to the
mux — never a loop, never a fallback. `agent-runtime` never imports a business agent, and the two
behaviour packages never import each other.
