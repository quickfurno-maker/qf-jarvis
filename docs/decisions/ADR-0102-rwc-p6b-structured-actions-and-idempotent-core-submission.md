# ADR-0102 — RWC-P6B: structured actions, compare-and-set, and the idempotent Core submission

- **Status:** Accepted — RWC-P6B implementation on branch, NOT MERGED
- **Date:** 2026-08-09
- **Supersedes:** nothing
- **Depends on:** ADR-0101 (RWC-P6 semantics and contracts), ADR-0100 (RWC-P5 Core availability),
  ADR-0099 (RWC-P4B one model call and continuity CAS), ADR-0098 (RWC-P4A reducer), ADR-0094 (the
  private web conversation service), ADR-0095 (the durable continuity store)

## Context

ADR-0101 froze what the post-summary transitions MEAN and what the Core intake boundary LOOKS LIKE,
and deliberately shipped neither a caller nor an adapter. RWC-P6A delivered exactly that: two pure
packages, a type-only port, and a set of P6B rules written down in §14 and §17 so that the
composition could not quietly redefine the semantics it was composing.

This ADR is that composition. It adds no new semantics. Where a rule already exists in ADR-0101 it is
cited rather than restated, and every decision below is about ORDER, COUNTS and FAILURE MAPPING —
which is precisely what a composition is allowed to decide.

## Decision

### 1. A separate constructor in the existing service package, not a second service package

`createRiyaStructuredActionService` lives in `@qf-jarvis/riya-web-conversation-service` beside
`createRiyaWebConversationService`, and the two share nothing but the package.

Not a new package, because a structured action and a text turn operate on the same continuity through
the same store port, and splitting them would mean two packages owning one row.

Not the same constructor, because their collaborators genuinely differ. A text turn needs a runtime
and a `runtimeId`; a structured action needs a Core intake port and **no runtime at all**. Adding
`coreIntakePort` to the existing config would make every text-turn deployment supply a Core adapter it
never calls — and the day that adapter is missing, a conversation that only ever wanted to talk would
fail to construct. The existing config is unchanged, and a spec asserts it.

### 2. Zero model calls, zero runtime calls, zero generated text

No structured action reaches `JarvisRuntime`, a gateway, a prompt or a reply adapter, and none returns
client-facing text. The result carries a disposition, the authoritative continuity and at most a
closed machine reason.

This is the point of the whole slice rather than an omission. `user_confirmed` and `COMPLETE` are the
two strongest claims Riya can make about a conversation, and ADR-0101 §2 put them behind a structured
surface precisely so no inference could produce them. A composition that then asked a model to phrase
the acknowledgement would have re-opened the door one layer up. The QuickFurno shell presents the
outcome; the existing RWC-P2D conversational path is untouched.

### 3. Structured actions never initialize continuity

Every action loads, and an absent conversation is `NOT_READY / CONTINUITY_NOT_FOUND`.
`createInitialIfAbsent` is never called. A structured action is by definition a response to something
a client was SHOWN, so a conversation that does not exist cannot have shown it; creating one here
would manufacture the very state the action claims to be answering.

### 4. Exact revision, checked before any authority call

`loaded.continuityRevision === action.expectedContinuityRevision`, or `CONFLICT / STALE_REVISION`.
Checked immediately after the load and before any availability read, Core read, lookup, submit or
compare-and-set — so a stale action costs exactly one store read and reaches no external system.

### 5. Edit, confirm and contact get ONE compare-and-set, and no reconciliation

ADR-0101 §14 already fixed this for confirm; it applies to all three.

The RWC-P4B reconciliation exists because observations are facts that remain true against a newer
state, so re-merging them is a re-computation. A confirmation is not a fact about the world — it is a
statement about a SPECIFIC rendered summary. Re-merging it onto a state the client never saw would
mean confirming something else on their behalf, and an edit re-applied to a summary that has since
changed is the same error with a smaller blast radius. Contact joins them because it has nothing to
reconcile: one Core answer, one advance, and a conflict means somebody else moved the conversation.

So: one attempt. `REVISION_CONFLICT` → `CONFLICT / CONTINUITY_CONFLICT`, no reload, no second
authority read, no second attempt.

### 6. The classifier that turns one P6A refusal into one reason code

`riya-conversation-completion` raises `action-not-permitted` for several distinct situations, because
a pure reducer has no vocabulary for "not yet" versus "no". The composition does. So on that error —
and ONLY on that error — a three-branch classifier reads the state it already loaded and the snapshot
it already read:

1. `completeness === 'HUMAN_REVIEW_REQUIRED'` → `NOT_READY / HUMAN_REVIEW_REQUIRED`
2. the Core availability policy blocks the effective service/city/pair → `NOT_READY /
AVAILABILITY_CHANGED`
3. otherwise → `REFUSED / ACTION_NOT_PERMITTED`

It runs only after the refusal, it can only ever choose between reasons, and it grants nothing. The
authority remains P6A's.

### 7. One shared availability policy, never a second pair rule

The classifier and the submission precondition both call the SHARED predicates in
`@qf-jarvis/core-service-availability-read/policy` — the same three functions the model path and the
P6A reducers use. RWC-P6A moved them there for exactly this moment. There is no second
`isPairAvailable` in this repository and there must not be one.

### 8. Availability is read at most ONCE per action, and never during reconciliation

Edit, confirm and submit each read once. Contact reads not at all: whether Core holds a phone number
has nothing to do with which cities the business serves, and a read there would be an outbound call
that could only ever fail the action for an unrelated reason.

### 9. The Core intake state is read at most ONCE, and its identity is proved

`readCurrent({ tenantId, conversationId, subjectRef })`, parsed through the real
`parseCoreRiyaIntakeStateV1`, then ADR-0101 §17.3's exact three-way comparison. A mismatch is
`NOT_READY / AUTHORITY_MISMATCH` and stops the action dead — no second read to find a better state, no
lookup, no submit. Retrying a read that answered about the wrong conversation is how a composition
talks itself into believing the second answer.

### 10. Contact evidence is used and never kept

`advanceRiyaAfterContactReady` requires it and discards it (ADR-0101 §8). The composition passes the
parsed `evidenceRef` straight in and puts it in no result, no log and no state. Consent state does not
gate `CONTACT → CONSENT`: reaching the consent step is not the same as passing it, and the submission
is where consent is evaluated.

### 11. The idempotency key binds the business payload

SHA-256 over exactly the ADR-0101 §13 identity, in a fixed order:

```
JSON.stringify([1, tenantId, conversationId, subjectRef,
                serviceInterestRef, locationRef, propertyTypeRef, scopeSummary,
                budgetNote, timelineNote, consultationPreferenceRef])
```

with every absent optional as an explicit `null`, giving `riya-intake.<64 lowercase hex>`, re-proved
through the shared `idempotencyKeySchema` before use.

Excluded, deliberately: `continuityRevision`, `actionRef`, any timestamp, `intakeStateRef`,
`availabilitySnapshotRef`, `taxonomyVersion`, any evidence reference and any nonce. A retry of the
same business intake must derive the SAME key even though a conversational revision moved underneath
it — including a revision the client's own concurrent typing caused — and a materially changed
discovery must derive a different one. A nonce would make the key unique per attempt, which is the
exact opposite of what it is for.

The preimage is never logged, never stored and never returned. It is a description of a real person's
home.

### 12. Look up before mutating, always

One `lookupSubmission` with the derived key, before any submit. `lookup.idempotencyKey` must equal the
key queried (ADR-0101 §17.6) or the action stops with `AUTHORITY_MISMATCH` and does **not** submit.
`FOUND` never submits. Only a key-matching `NOT_FOUND` proceeds, and then to exactly one submit.

### 13. One submit, one result, one cross-check

`submit` is called at most once per action, ever. The result is parsed through the real parser and
`result.idempotencyKey === submission.idempotencyKey` is required before an `ACCEPTED` result's
evidence may be used (ADR-0101 §17.7). A mismatch is `AUTHORITY_MISMATCH` with no completion.

### 14. An indeterminate submit is recovered by asking, never by asking again

If the single submit does not yield a usable answer after a key-matching `NOT_FOUND`, ONE recovery
lookup with the SAME key is authorized — the only path on which the lookup count reaches two.
`FOUND` with a matching key is handled as an ordinary result; anything else is `NOT_READY /
SUBMISSION_INDETERMINATE`. No second submit, no third lookup, no sleep, no loop.

**Interpretation recorded explicitly:** "does not yield a usable answer" covers both a rejected
promise and a body that fails the canonical parser. ADR-0101 §14 names the transport-uncertainty case;
an unparseable body is the same fact — the mutation may already have happened and we cannot tell — and
the safe response to both is to ask Core what it recorded. The bounds are unchanged: still at most one
submit and at most two lookups.

A later explicit action may retry with the same deterministic key. Core remains the idempotency
authority (ADR-0092 §9); Jarvis builds no ledger and adds no table.

### 15. `ACCEPTED` is the only outcome that writes, and its conflict is the only one worth reconciling

`NOT_READY`, `REJECTED` and `HUMAN_REVIEW_REQUIRED` perform no compare-and-set at all. Core's reason
code is mapped to this service's closed vocabulary and never persisted, and discovery completeness is
never altered to reflect a Core decision.

`ACCEPTED` calls the pure `completeRiyaAfterCoreSubmission` and compares-and-sets once. On conflict —
and this is the ONE structured action allowed a reload and a second attempt — the Core business
mutation has already succeeded, so failing closed would leave a conversation permanently short of the
`COMPLETE` that Core has already recorded, and re-running the submission would create a second
enquiry. Reconciliation is therefore the only option that is neither.

Exactly one reload, and nothing else re-runs: no availability read, no Core state read, no lookup, no
submit.

- **latest is `COMPLETE`** — accept it as the answer only if its evidence equals the accepted evidence
  AND its business identity still hashes to the same key. Then `APPLIED` with the latest state and no
  second compare-and-set: another writer completed the same submission, and that is success.
  Otherwise `CONFLICT` — a `COMPLETE` carrying somebody else's evidence is not this action's outcome.
- **latest is `CONSENT`** — require `summaryConfirmed`, no completion evidence, and the same key. Then
  re-run the PURE completion against the latest state with the SAME evidence and attempt one second
  compare-and-set. If the key changed, the conversation is no longer the one Core accepted, so
  `CONFLICT` with no second attempt.
- **any other phase** — `CONFLICT`.

Two attempts, never three.

### 16. Failure mapping is bounded, and nothing external is wrapped

The existing `RiyaWebConversationError` vocabulary is reused unchanged: `invalid-input` for a
malformed action or config, `continuity-unavailable` for a store that could not answer,
`repository-invariant` for durable evidence that contradicts itself. External unavailability and
malformed external answers become dispositions, not exceptions — a Core outage is not a defect in our
records, and it must not read as a business refusal either. No raw error, host, key or payload from
the reader or the Core port ever escapes.

### 17. No ingress change, no migration, no adapter

The private ingress gains no route and no wire field and stays NOT DEPLOYED. Continuity needs no new
field — `phase`, `summaryConfirmed` and `completionEvidenceRef` already express everything. **No
`0012`.** The Core intake port still has no implementation in this repository; the final QuickFurno
handshake supplies it.

## Consequences

- `SUMMARY → CONTACT → CONSENT → COMPLETE` is now walkable end to end with zero model calls.
- A duplicate enquiry requires a deterministic key collision, a Core idempotency failure and a lookup
  that lied about its own key.
- An accepted submission whose CAS lost a race still reaches `COMPLETE`, without a second submission.
- Every structured action costs a bounded, countable number of external calls, asserted by spec.

## What this does NOT implement

No live QuickFurno adapter, no HTTP, no ingress route, no migration, no managed-database access, no
provider or n8n activation, no client-facing text, no RWC-P7 (RAG) and no RWC-P8 (cross-channel
identity).

## Change-control rule

Owner-locked. Changing any of these requires a new ADR:

- structured actions make **zero** model and **zero** runtime calls;
- structured actions **never** initialize continuity;
- edit, confirm and contact get **one** compare-and-set and no reconciliation;
- the idempotency key is deterministic over the frozen business identity, with no revision, action
  reference, timestamp, snapshot reference or nonce;
- **lookup before submit**, always; at most **one** submit per action; at most **two** lookups, and
  the second only as the authorized recovery;
- an accepted result is reconciled, never re-submitted;
- Core remains the business and idempotency authority; Jarvis writes no consent and creates no lead.
