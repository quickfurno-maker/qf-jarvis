# ADR-0067 — Riya Client-Sales Behaviour Boundary

**Status:** Accepted — QFJ-S3-C-A (behaviour foundation; runtime composition deferred to S3-C-B)
**Deciders:** Owner
**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration-foundation.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0066](./ADR-0066-shared-agent-runtime-execution-boundary.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md)

## Context

The whole-roadmap sweep found only six genuinely missing bodies of work. Riya's client-sales
behaviour is the first, and the first that is not blocked on owner authorisation.

Everything Riya needs already exists: identity and the actor↔party scope rule (ADR-0054), the
15-stage orchestration pipeline and its ports (ADR-0055), the ModelReplyPort implementation over
Model Gateway (ADR-0057), the end-to-end composition root (ADR-0059), and provenance (ADR-0066).
What did not exist was any notion of _what a client-sales turn is_.

## Decision

### 1. Placement — a new leaf package

`@qf-jarvis/riya-agent`, depending on `@qf-jarvis/agent-runtime` and `zod`. One-way:

```
riya-agent  ->  agent-runtime public contracts
```

The three alternatives were rejected. There is no existing behaviour/domain package to extend — a
search for sales-intent, need-discovery or lead-qualification semantics found nothing anywhere.
`jarvis-runtime` is a **content-free composition root** (ADR-0059); putting furniture-sales semantics
inside it would mix business behaviour into infrastructure. And `agent-runtime`, `model-gateway`,
`model-reply-adapter` and `core-decision-adapter` are generic infrastructure that must stay
provider- and business-neutral.

The package does **not** depend on `model-reply-adapter` or `model-gateway`. It decides; the merged
composition root injects and invokes. That is why "Riya never calls a model" is structural rather
than procedural — there is no import through which it could.

### 2. Fixed role

`RIYA_ACTOR = 'RIYA'` and `RIYA_SUPPORTED_PARTY = 'CLIENT'` are constants, not parameters. The turn
input has no `actor` field at all, so a caller cannot ask this package to act as Anisha or on a
vendor conversation.

### 3. Sales-intent vocabulary — eight closed values

`INITIAL_SERVICE_DISCOVERY` · `REQUIREMENT_DISCOVERY` · `QUOTE_OR_CONSULTATION_INTEREST` ·
`SALES_FOLLOW_UP` · `PROJECT_READINESS_CLARIFICATION` · `HUMAN_SALES_ASSISTANCE_REQUEST` ·
`UNSUPPORTED_NON_SALES_REQUEST` · `INSUFFICIENT_CONTEXT`

The vocabulary describes what a turn **is**, never what QuickFurno **sells**. Service categories,
cities, property types and price bands are deliberately absent: they belong to QuickFurno Core, they
change on a business cadence rather than a release cadence, and encoding them here would create a
second catalogue that silently drifts from the real one.

Classification is **deterministic** and reads a closed set of booleans and one bounded count — never
client text. Natural-language interpretation stays with the model behind the merged ModelReplyPort;
deciding what kind of turn this is, is a policy question and therefore has to be reviewable rather
than hidden inside a prompt.

Ordering is by **safety, not likelihood**: out-of-scope and human requests outrank every commercial
signal. An agent that talks past "I want to speak to someone" is the failure this ordering prevents.

**There is no confidence field.** A probability may never override role, routing or policy.

### 4. Need discovery — a snapshot, never a second source of truth

Bounded opaque references for service interest, location, property type and consultation preference;
bounded short text for scope, budget and timeline; a closed completeness state; a closed
missing-field list.

Two deliberate omissions:

- **No contact details.** The inbound envelope and Core already carry identity. Copying a phone
  number or email here would duplicate personal data into a second place that then has to be erased
  twice, and this record must never be the reason an erasure misses something.
- **No precise location.** `contracts/common/prohibited-content.ts` already states the rule — a
  latitude/longitude pair never crosses the canonical boundary, a city or area identifier is carried
  instead. `locationRef` is exactly that.

`SUFFICIENT_FOR_CORE_REVIEW` while fields are still listed as missing is refused: it is the one
combination that would be a lie.

### 5. Proposal semantics — meaning over merged machinery

Riya adds two sales meanings and maps them onto **existing** generic kinds:

| Riya meaning          | Merged kind  |
| --------------------- | ------------ |
| `SALES_FOLLOW_UP`     | `FOLLOW_UP`  |
| `HUMAN_SALES_CONTACT` | `ESCALATION` |

No new kind was needed, so none was added; `RUNTIME_PROPOSAL_KINDS` stays at five. Every proposal is
built by the merged `createProposal`, which stamps `PENDING_CORE_VALIDATION` and independently
re-checks actor↔party scope — so the boundary holds even if this package is refactored badly.

A proposal has no field an executable instruction could occupy: it carries an id, a version, a kind,
an actor, a party type, a conversation id and an authority status. Nothing else.

### 6. Model-reply boundary and call budget

This package invokes nothing. A decision carries `modelReplyEligible`, and the merged pipeline
decides what to do with it. `false` is returned — before any intent is even classified — for AI
pause, human takeover, a non-CLIENT party, and a turn owned by another actor.

Gate order is load-bearing and mirrors the merged pipeline's own precedence: pause and takeover
outrank everything, then the role boundary, then intent.

**What this package does and does not guarantee.** Zero model calls from `riya-agent` itself is
structural: there is no gateway, adapter, port or transport import through which a call could be
made. `modelReplyEligible` is an eligibility DECISION, not a call-budget enforcer — one boolean on
one decision object does not, and cannot, enforce process-wide at-most-one invocation. That budget
remains owned by the merged `orchestrateInbound` pipeline and the `ModelReplyPort` /
model-reply-adapter contracts (ADR-0055/0057), which are also where pause, takeover and
role-violation zero-call behaviour is authoritative at runtime. This package adds no retry, no
fallback and no refresh.

### 7. Prompt boundary

One bounded, versioned, opaque `promptRef`. No prompt text, no registry, no template — S3-I resolves
the reference. Anything resembling prose is rejected by the reference grammar, so prompt text cannot
be smuggled through this field.

### 8. Provenance, persistence and execution

The package supplies an actor and an opaque `promptRef`; `createRuntimeProvenance` (ADR-0066) stamps
`authority: QUICKFURNO_CORE` and `modelOutputRetention: DISCARDED`, and neither is settable from
here. The decision has no `authority` or `modelOutputRetention` field to override.

Nothing is written, scheduled, assigned, sent or executed. There is no persistence API, no transport
import and no tool surface.

## Rejected alternatives

- **A module inside `jarvis-runtime`.** It is a content-free composition root; business semantics
  there would blur the infrastructure boundary ADR-0059 established.
- **Service/city/property enums.** Would duplicate a Core-owned catalogue on the wrong cadence.
- **A model-backed classifier in this package.** Would put a model call inside behaviour and make the
  zero-call guarantees procedural rather than structural.
- **Depending on `@qf-jarvis/contracts`** for bounded-text helpers. A 369-export data-contracts
  dependency for three lines of zod is heavier coupling than the reuse is worth; the sweep confirmed
  it carries no furniture-domain vocabulary to reuse.

## Phase status

This ADR records **S3-C-A: the Riya behaviour foundation**, and S3-C overall is therefore
**partial**. `@qf-jarvis/riya-agent` is a leaf package that nothing yet imports: no production
runtime or composition module invokes `decideRiyaTurn`, so eligible CLIENT turns do not reach Riya
behaviour through `jarvis-runtime` / `orchestrateInbound` today.

The remaining work is a narrow, separate **S3-C-B composition bridge**: route eligible CLIENT turns
into `decideRiyaTurn` on the authoritative path, map its disposition onto the existing reply and
`PENDING_CORE_VALIDATION` proposal flow, keep provenance stamped through the merged composition, and
create no parallel runtime path. Deliberately deferred rather than bundled here, so the behaviour
kernel and the wiring that gives it reach are reviewed as separate, individually revertible changes.

Production rollout remains OFF. Nothing in this ADR activates a provider, a mode or a deployment.

## Consequences

Riya can classify a client-sales turn, record what has been discovered, and request Core-validated
proposals — without any ability to act. `RUNTIME_PROPOSAL_KINDS` and every merged API lock are
unchanged.

## S3-D handoff

Anisha mirrors this package's **structure**, not its content: fixed actor/party constants, a closed
intent vocabulary, a content-minimised discovery contract, a deterministic decision with the same
gate order, and proposal meanings mapped onto existing generic kinds. What must differ is the
vocabulary itself — vendor-care intents are about issues, status and fulfilment, not qualification —
and the mapping target, since escalation semantics differ between a sales lead and a vendor issue.
The role constants invert to `ANISHA`/`VENDOR`, and `isActorPartyCompatible` enforces it identically.

## Non-goals

No prompt text · no model call · no router, state machine, proposal authority or ModelReplyPort · no
memory · no tools · no WhatsApp · no n8n · no database · no persistence · no deployment · no vendor
ownership.

## Change-control rule

Adding a sales intent, a discovery field, a disposition or a proposal meaning requires an ADR
amendment. Riya stays client-only; the actor and party constants stay constants; classification stays
deterministic and confidence-free; every action-like result stays `PENDING_CORE_VALIDATION`; prompt
text never enters this package.
