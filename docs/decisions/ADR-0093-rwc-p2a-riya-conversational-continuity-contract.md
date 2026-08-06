# ADR-0093 — RWC-P2A Riya Conversational Continuity Contract

**Status:** Accepted — RWC-P2A. Contract-only; no database, no transport, no web service, no live extraction.
**Deciders:** Owner
**Relates to:** [ADR-0092](./ADR-0092-jrw-0b-governed-web-runtime-channel.md) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md) · [ADR-0068](./ADR-0068-riya-authoritative-runtime-composition.md) · [ADR-0076](./ADR-0076-qfj-p08-b-tenant-scoped-authoritative-state.md) · [ADR-0077](./ADR-0077-qfj-p08-b-durable-postgres-conversation-state.md)

## Context

JRW-0B made `WEB` a legal runtime channel. JRW-0A had already found the larger gap: **Jarvis has no
conversational memory at all.** `qf_jarvis.conversation_runtime_state` holds seven gating columns and
a revision — no text — and the governed contracts refuse transcripts by key and by value shape.

So every Riya turn is currently the first turn. RWC-P4 cannot extract requirements into something
that does not exist, and RWC-P2C cannot serve a web conversation that forgets everything between
requests.

This slice answers one question and builds nothing else: **what is the minimum non-authoritative,
content-minimised state Jarvis may carry from one Riya turn to the next?**

**Baseline.** PR #97 (JRW-0B) merged as `dd1dd963c2c7c699d94ea386058d192ac02883f4`, containing
reviewed head `66883be4a98e1b23f10ba86f62b722343ea2b578`.

## Decision

### 1. One Riya, and therefore no channel field

`@qf-jarvis/riya-conversation-continuity` carries **no channel**. WEB and WhatsApp are the same
governed Riya (ADR-0092): the same behaviour kernel, the same `RIYA` identity, the same `CLIENT`
scope, the same model policy, the same prompt binding rules, the same governed-knowledge path and the
same `PENDING_CORE_VALIDATION` authority boundary.

Before RWC-P8's explicit Core-authorized link, the two surfaces stay separate by having **separate
conversation identities** — not by channel-specific Riya state. A channel field here would be the
first field of a second Riya wearing a shared name, and every later phase or provenance rule would
have to decide whether it applied to one surface or both.

### 2. Identity is `tenantId` + `conversationId`, never `conversationId` alone

ADR-0076 §3 removed the global-uniqueness assumption for `conversationId` and forbade a
conversation-only unique index. A continuity state keyed on the id alone would merge two tenants'
conversations into one. Both identifiers use the canonical runtime identifier grammar
(`[A-Za-z0-9._:-]`, 1–128), whose excluded characters mean an email address, an E.164 number or a
sentence cannot become an identifier here.

There is no `userId`, phone, email, browser token, cookie, `providerMessageRef`, `subjectRef`,
`vendorId` or `leadId`.

### 3. `continuityRevision` is its own counter

It is **not** the conversation-control revision from ADR-0076/0077, and the two must never be
collapsed into one integer.

That revision versions the whole _safety_ state — `humanTakeover`, `aiPaused`, `cancelled`,
`dataClass`, `partyType`, subject status — and M3's compare-and-set and M4's post-gateway gate
compare it. If one counter served both domains, a human takeover would bump the discovery revision
and a discovery update would bump the number every safety gate compares. Two unrelated things would
then invalidate each other, and the failure would look like flaky concurrency rather than a design
error.

It starts at **0**, as ADR-0055 records the orchestration revision must, and is bounded by
`Number.MAX_SAFE_INTEGER` rather than a low ceiling a long-lived conversation eventually hits.

Migration `0008` is **not** extended, and no continuity column is added to
`conversation_runtime_state`.

### 4. Exactly the nine RWC-P0B phases

`INTRO` · `NEED` · `LOCATION` · `PROJECT_DETAILS` · `BUDGET_TIMELINE` · `SUMMARY` · `CONTACT` ·
`CONSENT` · `COMPLETE`

Restated verbatim, not re-derived. Deliberately absent: `PREFERENCES`, `CONFIRM`, `MATCH`, `PROJECT`,
`DETAILS`, `DISCOVERY`, `QUALIFICATION`, `FOLLOW_UP`, and anything `WEB_`- or `WHATSAPP_`-prefixed.
"Project / Details / Match" is UI vocabulary and belongs to the surface.

`CONTACT`, `CONSENT` and `COMPLETE` are labels for where the conversation has reached. They record
nothing about whether contact details were captured, whether consent was given, or whether a lead
exists.

### 5. Exactly five provenance sources, with recorded precedence

`model_inferred` · `server_runtime` · `user_selected` · `user_stated` · `user_confirmed`

```
model_inferred (1) < server_runtime (2) < user_selected (3) == user_stated (3) < user_confirmed (4)
```

`user_selected` and `user_stated` rank **equally**: choosing a chip and typing the same thing are the
same act of telling us, and ranking one above the other would let a surface affordance change how
much a client's own words counted.

The ranks are recorded **internally and are not exported**, and nothing in this package uses them.
Recording the order is a contract decision; acting on it is a merge, and the merge is RWC-P4's. An
exported comparison helper would be the first half of a reducer this slice must not contain — and the
second half would arrive as an obvious convenience.

They are written down now rather than left to the next slice because "which source wins" decides
whether a model inference can silently overwrite something a client confirmed. That is not a detail
to re-derive under implementation pressure.

### 6. `NeedDiscovery` is REUSED, not duplicated

The state embeds the ADR-0067 `NeedDiscovery` and re-proves it through the real
`createNeedDiscovery`. There is no second requirement draft, no second catalogue, and no city,
category or property enum. A parallel draft would immediately become a second source of truth about
the same project — and the two would diverge on the first field somebody updated in one place.

Discovery fields, values and completeness are unchanged by this slice.

### 7. Provenance must account for exactly the values that are there

For each of the seven discovery fields:

- a **present** value with no provenance → refuse;
- an **absent** value with provenance → refuse;
- a field listed in `missingFields` that also carries a value → refuse;
- an unknown key or a source outside the closed set → refuse.

Nothing is inferred or repaired. Defaulting an unaccounted value to `model_inferred` would be this
package inventing the very thing provenance exists to record, and a provenance with no value is
usually the fossil of a field the client corrected away — keeping it would let a later merge
resurrect a claim that is no longer stated.

The state and its provenance map are deeply frozen, and the map is copied so a caller cannot mutate
it afterwards.

### 8. `summaryConfirmed` is a conversational fact, not consent

Before a summary has been shown (`INTRO`…`BUDGET_TIMELINE`) it must be `false`. At `SUMMARY` it may
be either. At `CONTACT`, `CONSENT` and `COMPLETE` it must be `true` — a `CONTACT` phase with an
unconfirmed summary describes a conversation that skipped the step it depends on.

There is **no `consentGiven` field, and no field that could hold one.** Consent is Core's, and the
`CONSENT` phase label records only where the conversation is.

### 9. `COMPLETE` requires opaque completion evidence

`phase === 'COMPLETE'` ⟺ `completionEvidenceRef` is present. RWC-P0B locked that `COMPLETE` is
reached only through a governed confirmation outcome and that no ordinary phase path submits; this
slice has no phase reducer, so the invariant is enforced on the state rather than on a transition.

The reference is opaque and bounded by the identifier grammar, so a lead payload, an email, a phone
number or free prose cannot be smuggled through it. It means _a trusted later composition supplied
evidence that the governed confirm boundary completed_. It does **not** mean Jarvis authorized or
created anything. RWC-P6 owns the real canonical submission integration.

### 10. Operational continuity is NOT ADR-0016 agent memory

This is the distinction that keeps both contracts honest.

|            | ADR-0016 agent memory                                     | RWC-P2A continuity state                                       |
| ---------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| Scope      | one agent, **across** conversations                       | one tenant + **one** conversation                              |
| Derivation | derived from canonical events; `sourceEventIds` non-empty | not derived from an event stream                               |
| Literals   | `rebuildable: true`, `authoritative: false`               | none of them                                                   |
| Authority  | never authoritative                                       | authoritative **only** for the current conversational workflow |
| Lifetime   | rebuildable, safe to clear                                | working state for one conversation                             |
| Training   | explicit `TrainingEligibilityDecisionV1` only             | never training data                                            |

None of ADR-0016's literals appear here, and that is deliberate. Borrowing `rebuildable: true` and an
invented `sourceEventIds` would disguise working state as memory: it would claim to be derived from
events it was never derived from, and it would let a reader conclude ADR-0016's deletion guarantees
apply to it. They do not.

**ADR-0016 is not weakened and not amended.** Any future cross-conversation memory must use it
independently. A continuity state is never reused as a belief in another conversation, never a
customer profile, never a CRM record, and never copied directly into long-term agent memory.

### 11. No transcript, and no second summary blob

No `conversationSummary`, `rollingSummary`, `memorySummary`, `lastMessages`, `history`, `transcript`,
`recentTurns` or `contextWindow`.

Bounded conversational context remains Jarvis's responsibility, and `NeedDiscovery` already carries
it in structured form — `scopeSummary`, `budgetNote`, `timelineNote`. A second free-text blob would
be a transcript with a friendlier name. Adding one later requires separate review proving
`NeedDiscovery` is insufficient, and settling its deletion, retention and data-class behaviour and
its ADR-0016 compatibility.

### 12. Ownership boundaries this contract holds

**Jarvis** owns conversation phase, structured discovery progress, field provenance, the
`summaryConfirmed` fact and bounded conversational continuity — authoritative for the current
workflow and nothing more.

**A later QuickFurno web/server gateway** owns only session mechanics: the opaque browser token,
same-origin, CSRF, rate limiting, request size, per-turn idempotency, one in-flight turn per web
conversation, and the token → routing mapping. It does not own Riya's phase, `NeedDiscovery`,
provenance, a transcript, or a Riya memory database.

**QuickFurno Core** owns business truth: consent, opt-out and suppression; customer and contact
identity; city and service catalogue validity; vendor availability; package and pricing truth; lead
creation and assignment; vendor matching; preferred-vendor state; business `canSubmit`; canonical
submission and its idempotency.

No field here is named — or semantically equivalent to — `consent`, `consentGiven`, `optOut`,
`suppression`, `canSubmit`, `leadId`, `assignment`, `vendorAvailability`, `packagePrice`, `pricing`,
`customerIdentity`, `phone`, `email` or `name`. A spec asserts each is refused.

### 13. No reducer, and the phases that own what comes next

This slice implements **no** `determineNextPhase`, `advancePhase`, `nextPrimaryField`,
`isReadyForSummary`, `isReadyForContact`, `computeCanSubmit`, `mergeProvenance`, `mergeField` or
`applyFieldUpdate`.

- **RWC-P4** owns live extraction, phase-machine evolution, provenance merge, user-correction
  override, pending-primary-question behaviour and the one-question-per-turn policy.
- **RWC-P5** owns City Context. `NeedDiscovery.locationRef` stays opaque, and there is no
  `projectCity`, `projectArea`, `browsingCity`, `userOverrodeCity` or vendor-availability inference.
- **RWC-P6** owns consent, the summary card and canonical submission.
- **RWC-P8** owns explicit Web → WhatsApp identity linking.

RWC-P1D, RWC-P1E and RWC-P1F remain **PARKED**; only P1B's frozen semantic decisions are carried
forward. **RUI-3A has not started.** Live Riya remains **OFF**.

## Consequences

- No database, adapter, SQL, migration or managed-database access. Migrations remain `0001`–`0010`,
  byte-identical; there is no `0011`, and no migration number is pre-reserved for RWC-P2B.
- No HTTP, route, web service or QuickFurno repository change.
- Nothing in the repository imports the package. It is a contract with its proof, and composing it
  is RWC-P2B/P2C.
- The public surface is five runtime values. The schemas, the precedence ranks, the discovery-field
  mapping and the validators are internal.

## What this does NOT implement

Phase transitions · extraction from prose · provenance merge · persistence · a durable store · a web
conversation service · HTTP · a browser session token · City Context · consent recording · lead
creation · Web → WhatsApp linking · RAG · a provider · live Riya.

## Change-control rule

Adding a channel field, a transcript, a rolling summary, a contact, consent or `canSubmit` field, a
second requirement draft, a phase or provenance reducer, or any persistence to this package each
require a superseding ADR. So does exporting the precedence ranks — recording an order and acting on
it are different decisions, and this ADR made only the first.

Whether RWC-P2B needs a durable schema is a **separate owner review**, and this slice deliberately
does not pre-decide it.
