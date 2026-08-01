# ADR-0068 — Riya Authoritative Runtime Composition

**Status:** Accepted — QFJ-S3-C-B
**Deciders:** Owner
**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration-foundation.md) · [ADR-0056](./ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0066](./ADR-0066-shared-agent-runtime-execution-boundary.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md)

## Context

S3-C-A built the Riya behaviour kernel and deliberately stopped short of wiring it. Nothing imported
`@qf-jarvis/riya-agent`, so a client-sales turn arriving at `createJarvisRuntime` was answered by the
same generic `REPLY` path as everything else. This ADR connects the two — and records the three
things that connection turned out to require, none of which were visible from either side alone.

## Decision

### 1. One path, unchanged

```
createJarvisRuntime
  -> composeAndProcess
       -> createOrchestrator
       -> runAgentTurn            (exactly once)
            -> orchestrateInbound (exactly once)
```

`composeAndProcess` previously called `orchestrateInbound` directly, which meant the composition root
never obtained the S3-B provenance sibling. It now calls `runAgentTurn`, which delegates to the same
pipeline once and stamps provenance. This is a substitution, not an addition: the two are never both
called for one turn, and no second pipeline, orchestrator or proposal path exists.

### 2. The M1/M2 proposal-vocabulary correction

Two proposal vocabularies exist and are deliberately not merged:

|     | Vocabulary                                                                                       | Used by                                                 |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| M1  | `RUNTIME_PROPOSAL_KINDS` — `AGENT_ASSIGNMENT`, `REPLY`, `FOLLOW_UP`, `ESCALATION`, `TOOL_INTENT` | `createProposal` → `RuntimeProposal`                    |
| M2  | `ORCHESTRATION_PROPOSAL_KINDS`                                                                   | `createOrchestrationProposal` → `OrchestrationProposal` |

The authoritative path uses **M2 only**. ADR-0067 §5 mapped Riya's sales meanings onto M1 and
concluded no new kind was needed — true of M1, and incomplete, because M2 contained neither
`FOLLOW_UP` nor `ESCALATION`.

`ORCHESTRATION_PROPOSAL_KINDS` therefore gains exactly one value:

```
REPLY · FOLLOW_UP · ESCALATE_TO_HUMAN · REQUEST_CLARIFICATION · NO_ACTION
```

`FOLLOW_UP` was added rather than mapped away because every alternative would have told QuickFurno
Core something other than what Riya decided. `REPLY` omits the follow-up commitment.
`REQUEST_CLARIFICATION` asserts information is still missing — the exact opposite of the
`SUFFICIENT_FOR_CORE_REVIEW` precondition that gates the disposition. `NO_ACTION` asserts nothing
should happen. A vocabulary that forces a lie is the wrong vocabulary.

`RUNTIME_PROPOSAL_KINDS` is untouched. `createRiyaProposal` and `proposalKindFor` remain exported and
unchanged, and are **not called** by this composition: a second construction would mean one turn
produced two proposals, one of them revision-unbound and invisible to Core.

### 3. A generic behaviour seam, not a Riya seam

`agent-runtime` must not import `riya-agent` — that would invert the dependency direction and create
a cycle. So the orchestrator gained an optional, type-only port that names no agent and no business
concept:

```ts
BehaviourDecision        { modelReplyEligible, proposalKind, structuredIntent }
BehaviourDecisionRequest { conversationId, partyType, assignedActor, revision }
BehaviourDecisionPort    { decide(request): Promise<BehaviourDecision | undefined> }
```

The request is deliberately not the envelope: a behaviour decision has no business with the provider
message reference or the normalized text, and passing them would invite exactly the natural-language
classification this seam exists to keep out of the runtime. The decision carries no reply body, actor,
party type, authority state, Core outcome or executable instruction — each is owned elsewhere, and a
second source would be a second authority.

The Riya-specific adapter lives in `jarvis-runtime`, the one layer allowed to know both sides.

### 4. Insertion point

The behaviour port is called **after the complete first gate and before knowledge retrieval**:

```
1-2   read ctx1, validate the envelope against it
 -    assignAgent
3-7   FIRST GATE   cancelled -> takeover -> aiPaused -> non-AI actor
                   -> privacy -> HUMAN_ONLY -> LOCAL_ONLY
7b    BEHAVIOUR DECISION                                  <- the new stage
8-11  knowledge, plan, model, draft validation            ONLY when modelReplyEligible
 -    SECOND GATE  re-read context, cancellation, revision/party drift, gate again
                                                          on BOTH paths
12    one createOrchestrationProposal, PENDING_CORE_VALIDATION
13    Core decision through the injected port
14-15 one immutable result
```

After the first gate, because a paused, cancelled, privacy-blocked or out-of-scope conversation must
not trigger a business-state read at all. Before the model, because otherwise `modelReplyEligible`
could not suppress anything. Making stages 8–11 conditional strictly _reduces_ what happens on refusal
paths; it cannot cause a gate to be skipped, because the conditional lies entirely between the two
gates.

### 5. Disposition mapping

| Riya disposition              | M2 kind             | Model calls | `replyBody` | Core      |
| ----------------------------- | ------------------- | ----------- | ----------- | --------- |
| `DRAFT_REPLY`                 | `REPLY`             | 1           | present     | consulted |
| `CONTINUE_DISCOVERY`          | `REPLY`             | 1           | present     | consulted |
| `PROPOSE_SALES_FOLLOW_UP`     | `FOLLOW_UP`         | 1           | present     | consulted |
| `REQUEST_HUMAN_SALES_CONTACT` | `ESCALATE_TO_HUMAN` | **0**       | absent      | consulted |
| `REFUSE`                      | `NO_ACTION`         | **0**       | absent      | consulted |

`CONTINUE_DISCOVERY` maps to `REPLY` rather than `REQUEST_CLARIFICATION` because the authoritative
reply chain can carry client-facing text only under `REPLY`: `STRUCTURED_REPLY_KINDS` forbids a body
on any other kind, and the M4 adapter builds an M2 draft only for `REPLY`. Choosing
`REQUEST_CLARIFICATION` would have discarded the clarifying question itself — the very thing the
disposition exists to produce. The discovery _reason_ is preserved in `structuredIntent`, so nothing
is lost.

Every zero-model path still runs the second gate and still produces a Core-validated proposal. A
refusal is not a shortcut.

`structuredIntent` carries `taskClass`, `replyKind`, `behaviourVersion`, `salesIntent`, `disposition`,
and `discoveryCompleteness` when a snapshot exists. It carries no `promptRef`, note, scope summary,
service/location/property/consultation reference, budget, timeline, PII, model output or raw text — a
proposal records _what_ was decided, and Core already holds the material it was decided from.

### 6. Core command reply-body rule

`proposedReplyBody` is forwarded for `REPLY` **and** `FOLLOW_UP`, and dropped for
`ESCALATE_TO_HUMAN`, `REQUEST_CLARIFICATION` and `NO_ACTION`. Without this, a follow-up proposal's
drafted acknowledgement would have been silently discarded before reaching Core.

### 7. The behaviour input boundary

`ClientSalesBehaviourInputPort` supplies validated `ClientSalesSignals`, an optional `NeedDiscovery`,
and an opaque `promptRef`, keyed by conversation and revision. It carries no actor, party type,
takeover, pause, cancellation, inbound text, provider payload, prompt body, metadata bag or catalogue.
Conversation control continues to come from the ONE authoritative source (ADR-0059 §C).

The adapter re-validates everything it is handed — signals through `isClientSalesSignals`, the
discovery snapshot through `createNeedDiscovery`, the prompt reference through the opaque grammar —
and throws on any contradiction, including a `FOLLOW_UP` whose snapshot is not
`SUFFICIENT_FOR_CORE_REVIEW`, and any disagreement between the mapping table and riya-agent's own
eligibility. The orchestrator catches a rejected port, skips the model entirely, and refuses. A
boundary that trusts its input is not a boundary, and repairing a contradictory input would be worse
than refusing it.

### 8. Provenance

`runAgentTurn` stamps a record for **every** outcome, served and refused, so a blocked turn is as
auditable as a served one. The actor is the merged rule's: the assigned actor on success — `RIYA` for
an eligible CLIENT turn — and `SYSTEM` on refusal, because attributing a refusal to an agent would
record an action that never happened. `authority` stays `QUICKFURNO_CORE` and `modelOutputRetention`
stays `DISCARDED`; both are literals, not inputs.

References are opaque and identifier-safe. `release.modelId` is **never** used: a real catalogue
identifier such as `openai/gpt-oss-20b` contains `/` and violates the grammar, so an unsafe reference
fails the turn closed rather than being quietly rewritten. `releaseRef` and `configRef` default to
`release.releaseId` and `release.configDigest`, which are already identifier-safe; `modelRef` and
`providerRef` must be supplied explicitly if wanted. The per-turn Riya `promptRef` stays an input to
`decideRiyaTurn` and never enters provenance, `structuredIntent`, observability or the Core command.

### 9. Dependency direction

```
jarvis-runtime ──► riya-agent ──► agent-runtime
       ├──► core-decision-adapter ──► agent-runtime
       └──► model-reply-adapter ────► agent-runtime
```

Acyclic. `agent-runtime` gains no dependency and remains generic.

### 10. The legacy default

When no behaviour input port is configured — as in every deployment today — the orchestrator uses
`{ modelReplyEligible: true, proposalKind: 'REPLY', structuredIntent: { taskClass, replyKind } }`,
which is byte-identical to the pre-S3-C-B pipeline. The same applies when a port returns `undefined`,
and when the turn is not a CLIENT turn assigned to Riya. Defining a seam is not activating it.

## Rejected alternatives

- **Calling `decideRiyaTurn` from `jarvis-runtime` around the orchestrator.** A wrapper outside the
  pipeline cannot see the gates, so pause, takeover and privacy would have been re-implemented — a
  second gate mechanism free to drift from the merged one.
- **Importing `riya-agent` into `agent-runtime`.** Inverts the dependency direction and makes generic
  infrastructure depend on one business agent.
- **Mapping `PROPOSE_SALES_FOLLOW_UP` onto an existing kind.** Cheaper, and false. See §2.
- **Emitting two proposals for the follow-up disposition** (a `REPLY` plus a `FOLLOW_UP`). One turn,
  one proposal; Core would otherwise have to reconcile two records of a single decision.
- **Adding a `JarvisRuntimeOutcome` value for a no-model proposal.** `NO_ACTION` already existed and
  was documented as reserved for exactly this case.
- **Deriving provenance references from `release.modelId` by stripping unsafe characters.** A
  provenance record that quietly rewrites its own references is worse than one that declines to claim.

## Consequences

All five Riya dispositions are reachable through `createJarvisRuntime`, each producing exactly one
`PENDING_CORE_VALIDATION` proposal with the correct model-call count and a provenance record. The M2
vocabulary grew by one value; every root API symbol set is unchanged.

**S3-C phase completeness.** The composition bridge is complete and proven by tests that drive the
real composition root. What remains outside this repository is the production data source: no system
currently supplies `ClientSalesSignals`, because those are business facts QuickFurno Core owns. This
PR defines and wires the seam; it does not switch it on.

## Non-goals

No production activation · no prompt text or registry · no memory · no WhatsApp · no n8n · no tools ·
no persistence, database, Supabase, Docker or migration · no credential or environment read · no
provider or network call · no send, deliver, execute, assign, schedule or webhook · no CANARY, ACTIVE
or FALLBACK · no deployment · no S3-D Anisha.

## Change-control rule

The one authoritative path stays one path. Adding an M2 proposal kind, a behaviour-port field, a
structured-intent key, or a second model invocation requires an ADR amendment. `agent-runtime` never
imports a business agent. Behaviour input never carries conversation control, prompt text or a
catalogue. Provenance references stay opaque and are never normalized to fit.
