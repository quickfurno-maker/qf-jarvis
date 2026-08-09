# ADR-0101 — RWC-P6 Summary Confirmation, Contact, Consent and Core Submission

**Status:** Accepted — RWC-P6 architecture. **P6A** implemented on `rwc-p6a-completion-and-core-intake-contracts`, **not merged**. P6B not started.
**Deciders:** Owner
**Relates to:** [ADR-0100](./ADR-0100-rwc-p5-core-service-availability-context.md) · [ADR-0099](./ADR-0099-rwc-p4b-one-model-call-extraction-and-continuity-cas.md) · [ADR-0098](./ADR-0098-rwc-p4a-riya-conversation-evolution-semantics.md) · [ADR-0097](./ADR-0097-private-riya-web-ingress-adapter.md) · [ADR-0096](./ADR-0096-rwc-p2d-core-authorized-web-reply-materialization.md) · [ADR-0095](./ADR-0095-rwc-p2b-durable-postgres-riya-conversation-continuity.md) · [ADR-0094](./ADR-0094-rwc-p2c-private-riya-web-conversation-service.md) · [ADR-0093](./ADR-0093-rwc-p2a-riya-conversational-continuity-contract.md) · [ADR-0092](./ADR-0092-jrw-0b-governed-web-runtime-channel.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md)

**Baseline.** RWC-P5 merged as PR #105 — merge commit `e351cd5ee6462545476c104f62a2cfa5c7e32d94`, reviewed head `08a4929c2303b214272c7580f96ad57237be9033`. Migrations `0001`–`0011`, `0011` SHA-256 `80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93`, no `0012`. **No migration is added by this slice.**

## Context

RWC-P6 crosses the most sensitive boundary in the Riya journey: the point where a conversation stops
being a conversation and becomes a real enquiry about a real person's home.

Four merged slices arranged the ground for it, and each left the same door closed. RWC-P2A froze the
nine phases and gave continuity `summaryConfirmed` and `completionEvidenceRef` while pointedly
refusing any field for contact, consent or a lead. RWC-P4A stops at `SUMMARY` and can set
`summaryConfirmed` false but never true. RWC-P4B forbids the model from claiming `user_confirmed`.
RWC-P5 refuses to upgrade a Core-validated reference to it. All four defer here.

They defer because the question is not technical. `user_confirmed` means _the client was shown this
and agreed it is right_, and a model reading prose cannot say that — it can only say that someone
typed something that sounded like agreement. Consent is stronger still: the authority matrix reads
_Consent — READ for every agent, Core final authority, PROHIBITED to change for all agents_, and
ADR-0092 §9 assigns customer identity, lead creation, business `canSubmit` and canonical submission
idempotency to Core.

So P6 cannot be built by asking a model "did they confirm?" and storing a boolean. It has to be built
so that Jarvis structurally cannot answer those questions at all.

## Decision

### 1. RWC-P6 is delivered in two internal parts. This is not a roadmap change.

- **P6A** — completion semantics and Core intake contracts. Pure reducers, pure contracts, a port
  with no implementation. **This PR.**
- **P6B** — the structured-action service capability, the compare-and-set composition, the
  deterministic idempotency key and the Core submission flow.

No QFJ phase, no new roadmap number, no RWC renumbering. Splitting it means the semantics can be
reviewed and frozen before anything composes them — which is the same order RWC-P4A/P4B used, for the
same reason.

### 2. Confirmation is structured. Prose never produces it.

`summaryConfirmed` becomes true in exactly one place: a structured action on the summary surface.
Never from an inference, never from a model reading "yes that's right", never from a channel adapter
guessing. A future WhatsApp surface may produce the same structured action only from deterministic,
auditable channel evidence — an interactive-reply payload, not a sentence.

### 3. Confirmation strengthens every PRESENT value to `user_confirmed`

A confirmation says the client was shown the summary values that exist and agreed they are right, so
each of them is re-observed at its own current value with provenance `user_confirmed`.

No absent field gains provenance: the client did not agree to a blank.

This has a consequence worth stating, because it is the reason to prefer it. RWC-P4A never overwrites
`user_confirmed` from below, so after a confirmation a later model inference cannot silently replace a
fact the client explicitly approved. Only another confirmation or a structured edit can. The
alternative — leaving a confirmed value marked `model_inferred` — would let the next guess overwrite
something the person had just signed off.

### 4. Structured edits are stamped `user_confirmed`, and the payload cannot say otherwise

`RiyaSummaryEditV1` has **no** `provenance` field and **no** `skipProjectDetails`. A caller able to
choose provenance would be a caller able to write `user_confirmed` for a guess; and declining optional
project-detail collection is a conversational act observed during a turn, not something an edit
performs.

Duplicated fields refuse the whole action — the same rule RWC-P4A applies to a duplicated observation,
because whichever one was chosen would be a rule nobody wrote down.

### 5. RWC-P4A remains the only discovery reducer

Every edit and every confirmation builds a canonical P4A observation batch and calls the real
`evolveRiyaConversation`. Nothing in P6 merges a field, ranks a provenance, recomputes completeness or
decides a phase from discovery. P4A therefore keeps owning precedence, `CLEAR` semantics, missing
fields, confirmation invalidation on an accepted value change, and phase regression — all of them
observable through the P6 surface and asserted there as outcomes.

### 6. RWC-P5 authority is mandatory, and the pair rule now has ONE copy

A structured edit reaches `serviceInterest` and `location` **without a model**, so it would otherwise
bypass the checks RWC-P5 does inside the model profile. Both the asserted reference and the
**prospective final pair** are therefore validated — the same two checks, in the same order, as the
model path.

The three predicates moved from `riya-model-interaction` to
`@qf-jarvis/core-service-availability-read/policy`, beside the contract that defines the snapshot.
Two copies of _may this service be offered in this city?_ would not diverge on the day they were
written; they would diverge on the day one was corrected. The P5 root keeps exactly its four runtime
values — a predicate is not a contract — and every existing P5 spec passes unchanged.

Editing is permitted only at `SUMMARY`. Editing from `CONTACT` or `CONSENT` would mean inventing a
transition back, and this slice was not given one.

### 7. Human review is not overruled

A discovery marked `HUMAN_REVIEW_REQUIRED` cannot be confirmed, cannot advance past `CONTACT` and
cannot complete. A person decided the conversation needs looking at, and P6 does not convert that to
`SUFFICIENT` on its way past.

### 8. Contact and consent stay Core's, structurally

`@qf-jarvis/core-riya-intake` reads Core's current view: contact `MISSING | READY`, consent
`MISSING | GRANTED | DECLINED | OPTED_OUT`. Every non-`MISSING` state **requires** an opaque Core
evidence reference, and `MISSING` **forbids** one — a bare "granted" is a claim, and evidence of an
absence is not a thing.

`DECLINED` and `OPTED_OUT` are separate states. Declining one intake is not withdrawing from contact
altogether, and collapsing them would either over-apply a refusal or under-apply an opt-out. Opt-out
is the stronger stop and must never be ignored.

**Jarvis stores no raw phone, email or name; no consent wording; and no consent boolean.** Continuity
has no field for any of them and must not acquire one. `subjectRef` — already on the turn, the
envelope and the privacy gate, with a grammar that excludes `@`, `+` and whitespace — is the only
customer identity that crosses.

The pure reducer takes the contact evidence, **requires** it, and then **discards** it. Its job is to
prove the caller had a governed answer rather than a hopeful boolean; a copy retained in Jarvis would
be a second place the same fact lives, with its own erasure obligation and its own chance to go stale.

### 9. The submission request carries no authority

`producingSystem` is the literal `qf-jarvis`. There is no outcome, no `canSubmit`, no consent claim,
no lead reference and no decided field — `ApprovalRequestV1`'s lesson applied to the customer journey:
_Jarvis may state what it wants and why; it may never state what it got._

It carries the canonical `NeedDiscovery`, re-proved through the real `createNeedDiscovery`, and
**not** field provenance: after a structured confirmation every displayed value is already
client-confirmed conversationally, and Core does not need Jarvis's merge bookkeeping to own its own
decision.

`availabilitySnapshotRef` and `taxonomyVersion` are **submission-time** evidence. They are not the
snapshot the client saw when they confirmed — continuity does not store that, and this contract does
not pretend otherwise.

### 10. A dedicated P6 evidence reference. Nothing is repurposed.

**`ClientConfirmationV1` is not reused.** It is assignment-domain evidence for reassignment and
additional-category confirmation, and its `statementCode` is an open machine token — so reinterpreting
it would be both easy and silent, and would leave "what did the client actually agree to?"
unanswerable six months later.

**`CommunicationAuthorizationV1` is not reused.** It answers whether an outbound message may be SENT
to a recipient, and explicitly refuses to carry a consent snapshot because eligibility is re-evaluated
at execution time. That is a different question from consenting to an enquiry.

`eventId`, `recommendationId`, `decisionId` and `linkedLeadId` are likewise not borrowed for the
convenience of their shape. P6 defines its own opaque grammar — `[A-Za-z0-9._:-]`, 1–128 — which is
deliberately the same shape continuity's `completionEvidenceRef` accepts, since a P6 evidence
reference is the only value that may ever be written there.

### 11. Four outcomes, and `ACCEPTED` is the only door to completion evidence

`ACCEPTED | NOT_READY | REJECTED | HUMAN_REVIEW_REQUIRED`. `ACCEPTED` requires the completion evidence
and carries no reason; the other three forbid evidence and require a bounded machine reason code —
a token to count, never a sentence, because a sentence explaining a refusal would describe a real
person's circumstances.

There is no transport outcome in this vocabulary. This package has no transport, and letting "we could
not reach Core" arrive as `REJECTED` would turn an outage into a refusal a client is told about.

### 12. `COMPLETE` only on Core's word

`CONSENT → COMPLETE` writes the Core-issued reference into continuity's `completionEvidenceRef` —
the only value that may ever go there, and required there by a rule continuity has enforced since
RWC-P2A. `NOT_READY`, `REJECTED`, `HUMAN_REVIEW_REQUIRED` and any indeterminate transport outcome all
hold at `CONSENT`.

### 13. Idempotency binds the business payload, not the click

The key is derived in P6B and required by the contract. Its identity is the contract version, the
tenant, the conversation, the subject and the **canonical discovery values**.

It deliberately does **not** include the continuity revision, an action reference, a timestamp, the
availability snapshot reference or a nonce. A retry of the same business intake must derive the same
key even though an irrelevant conversational revision moved; a materially changed discovery is a
different submission and must derive a different one.

Preferred form: `riya-intake.<64 lowercase hex>`, which a spec proves already satisfies the shared
`idempotencyKeySchema`. **Core enforces idempotency** — ADR-0092 §9 assigns it there — so Jarvis
builds no ledger and adds no table.

### 14. RWC-P6B, locked now so P6A cannot drift

The structured-action service will expose internal trusted capabilities carrying `tenantId`,
`conversationId`, `expectedContinuityRevision`, a bounded action reference and `subjectRef` where Core
identity is needed. No raw text. **Zero model calls for every structured action.**

Concurrency, per action:

- **Summary edit** — one availability read, then CAS. Owner review in P6B decides whether one remerge
  or immediate conflict is safer.
- **Summary confirm** — bound to the EXACT displayed revision. On stale revision or CAS conflict,
  **fail closed**: do not confirm a newer summary the client never saw, and never remerge onto one.
- **Contact** — read Core state; verify its identity triple (§17.3); `READY` plus evidence advances;
  one CAS.
- **Submission** — read Core state; verify its identity triple (§17.3); contact must be `READY` and
  consent `GRANTED`; `DECLINED` or
  `OPTED_OUT` stops it; P5 availability revalidated; derive the key; **look up any prior result before
  any recovery** and check the returned key against the one queried (§17.6); submit once only when
  none exists; **never resubmit on transport uncertainty**; check a direct result's key against the
  request (§17.7); after an accepted result, CAS the pure `COMPLETE` transition, and on conflict never
  call submit again — reconcile the same accepted result only while the canonical submission identity
  still matches, otherwise fail closed. At most one reload, no loops.

### 15. The private ingress does not change, and stays off

No wire field for confirmation, edit, contact, consent or submission. The final QuickFurno handshake
maps UI actions into the internal capability later. The ingress remains **NOT DEPLOYED / NOT LIVE**.

### 16. No migration

`phase`, `summaryConfirmed` and `completionEvidenceRef` already express everything P6 needs, and the
deliberate absence of contact, consent and lead fields is the design rather than a gap. **No `0012`.**

### 17. An answer from Core must prove it is an answer to THIS question

Added by the PR #106 owner correction. Nothing above is withdrawn; these three rules close the ways a
well-formed Core answer could still be the wrong one.

**17.1 — the current intake state is scoped by tenant AND conversation AND subject.** The read input
is `{ tenantId, conversationId, subjectRef }` and the state echoes all three.

**17.2 — `conversationId` is mandatory, because `DECLINED` is intake-specific.** §8 makes declining
one intake different from opting out altogether; that is only coherent if consent is keyed to an
intake. The same subject may hold `GRANTED` on one conversation and `DECLINED` on another, and a
subject-only read cannot tell those apart — it would return one and let the composition act on it as
the answer to the other. Contact may be subject-level inside Core; the composed state is still
attributed to one conversation, and the port is **not** split to reflect that.

**17.3 — RWC-P6B exact-matches the state's identity before using it.** All three of

```
state.tenantId       === action.tenantId
state.conversationId === action.conversationId
state.subjectRef     === action.subjectRef
```

must hold before `READY`, `GRANTED`, `DECLINED`, `OPTED_OUT`, any `evidenceRef` or `intakeStateRef`
may be read. Any mismatch **fails closed**: no phase advance, no submission, and **no second Core call
to go looking for a better state**. `stateRef` is opaque and is not this proof — Jarvis never parses
identity out of it.

**17.4 — every lookup result echoes its `idempotencyKey`, including `NOT_FOUND`.** A bare `NOT_FOUND`
cannot say which key was not found. Ask for A, let a stale cache or a buggy adapter answer `NOT_FOUND`
for B, and the artifact carries nothing to catch it with: the composition concludes A was never
submitted and submits it again — the mechanism that exists to prevent a duplicate enquiry has produced
one.

**17.5 — on `FOUND`, `lookup.idempotencyKey === lookup.result.idempotencyKey`.** Enforced by the
parser, not left to each caller. A wrapper naming one submission around a result answering another is
two submissions being conflated, and the completion evidence inside belongs to somebody else.

**17.6 — RWC-P6B additionally requires `lookup.idempotencyKey === the key it queried`.** The parser
proves internal agreement; it cannot know what was asked. On mismatch: **fail closed** — do not
submit, do not retry under another key, and do **not** read it as `NOT_FOUND`.

**17.7 — after a direct submit, `result.idempotencyKey === request.idempotencyKey`** must hold
**before** an `ACCEPTED` result's completion evidence is usable.

**17.8 — any identity or key mismatch fails closed** and can never cause a submit, a phase advance or
`COMPLETE`.

**17.9 — `@qf-jarvis/contracts` `idempotencyKeySchema` is the single runtime authority.** Used for the
request key, the result key and the lookup key alike; no local restatement anywhere. §13 already
placed idempotency enforcement in Core, and its grammar belongs in the same one place: a duplicate
would agree on the day it was written and diverge on the day one copy was corrected, and a
compatibility spec can only prove today's agreement. `@qf-jarvis/contracts` is therefore a **production**
dependency of `core-riya-intake`, imported at its public root and never deep-imported.

## Consequences

- A summary can be confirmed with authority that is structurally impossible for a model to mint.
- A conversation reaches `COMPLETE` only carrying evidence Core issued.
- Raw contact, consent wording and consent booleans have nowhere to live in Jarvis — enforced by
  containment scans, not by convention.
- One copy of the Core availability pair rule serves both the model path and the structured path.
- P6B can be composed against frozen semantics, with no discretion left about what confirmation means.

## What this does NOT implement

P6A adds **no** service capability, no compare-and-set composition, no Core port call, no idempotency
hashing, no submission or lookup flow, no contact or consent read composition, no client reply, no
model call, no live QuickFurno adapter and no ingress change. Those are P6B and the handshake.

No QuickFurno repository change. No migration, no `0012`. No managed database access. No provider or
n8n activation. No RWC-P7 (RAG) and no RWC-P8 (cross-channel identity).

## Change-control rule

Owner-locked. Changing any of these requires a new ADR, not an edit to this one:

- confirmation is **structured only**; a model or prose may never produce `summaryConfirmed` or
  `user_confirmed`;
- confirmation strengthens **every present** value, and no absent one;
- **one structured confirmation is exactly one revision**;
- RWC-P4A remains the **only** discovery reducer;
- RWC-P5 authority applies to structured edits and to confirmation, through **one** shared policy;
- human review is never overruled;
- contact and consent remain **Core-owned**; no raw contact, no consent wording, no consent boolean in
  Jarvis;
- the contact evidence is **required and discarded**; only Core submission evidence is persisted, and
  only at `COMPLETE`;
- `ClientConfirmationV1` and `CommunicationAuthorizationV1` are **not** reused;
- the submission request carries **no authority**, and Core owns idempotency;
- **no automatic resubmission** after an ambiguous transport outcome;
- the Core intake state is scoped by **tenant, conversation and subject**, and P6B exact-matches all
  three before using it;
- every lookup result — `NOT_FOUND` included — is **attributed to its idempotency key**, and every key
  cross-check failure **fails closed**;
- `idempotencyKeySchema` in `@qf-jarvis/contracts` is the **only** idempotency grammar;
- structured actions use **zero** model calls;
- the private ingress stays unchanged and off; no migration.

**Next.** RWC-P6B: the structured-action service capability, CAS, and the idempotent Core submission
composition.
