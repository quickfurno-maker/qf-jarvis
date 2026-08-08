# ADR-0099 — RWC-P4B One-Model-Call Live Extraction and Durable Continuity CAS

**Status:** Accepted — RWC-P4B. Implemented on `rwc-p4b-live-extraction-continuity-cas`, **not merged**.
**Deciders:** Owner
**Relates to:** [ADR-0098](./ADR-0098-rwc-p4a-riya-conversation-evolution-semantics.md) · [ADR-0097](./ADR-0097-private-riya-web-ingress-adapter.md) · [ADR-0096](./ADR-0096-rwc-p2d-core-authorized-web-reply-materialization.md) · [ADR-0095](./ADR-0095-rwc-p2b-durable-postgres-riya-conversation-continuity.md) · [ADR-0094](./ADR-0094-rwc-p2c-private-riya-web-conversation-service.md) · [ADR-0093](./ADR-0093-rwc-p2a-riya-conversational-continuity-contract.md) · [ADR-0073](./ADR-0073-authoritative-prompt-binding.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md)

**Baseline.** RWC-P4A merged as PR #103 — merge commit `09fa82c41be16d951fe2f1f15e07ca9c02644810`. Migrations `0001`–`0011`, `0011` SHA-256 `80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93`, no `0012`. No migration is added by this slice.

## Context

RWC-P4A produced a pure reducer: given a conversation and a batch of observations, it decides what
the conversation now knows, where it has reached, and what to ask next. It is composed into nothing,
and it has no way to obtain a batch — it says so in its own package note, and leaves live extraction
to this slice.

Meanwhile the Riya web conversation service loads continuity, calls the runtime once, and returns
the state **exactly as it found it**. Every turn is therefore a first turn: the model sees only the
current message, no fact is ever recorded, and the durable `continuityRevision` counter that
RWC-P2A/P2B built has never been incremented by a conversation.

Closing that gap has one obvious shape and one dangerous one.

The dangerous shape is **two model calls** — one to reply, one to extract. It doubles cost and
latency, and worse, it produces two independent readings of the same sentence that can disagree
about what a person said. Nothing downstream could then tell which one the conversation is.

So the requirement is a single inference that answers both questions at once. The problem is that
the M4 adapter deliberately knows nothing about Riya, and must keep knowing nothing: it is the
adapter for every agent, and one agent's conversational vocabulary inside it would be carried by all
of them.

## Decision

### 1. A generic structured-output profile seam in M4

`model-reply-adapter` gains one OPTIONAL injected contract:

```ts
interface ModelReplyStructuredOutputProfile {
  readonly structuredSchema: ZodType;
  buildUserContent(plan: ReplyPlan): string;
  projectStructuredResult(value: unknown): ModelReplyStructuredProjection | undefined;
}
```

A profile may replace exactly two things: **the strict schema the answer must satisfy**, and **the
one user message that asks for it**. It replaces nothing else.

It cannot touch the system message, which stays the resolved prompt definition's bytes with no
prefix, suffix, appended policy or interpolation. It cannot touch provider routing, fallback, release
binding, prompt-digest matching, provenance validation, citation authorization or either state gate.
The reply it projects is **re-proved against the base `structuredReplySchema`** before anything else
sees it, so a profile chooses the shape of the answer but never what counts as a reply.

Nothing in the seam names an agent, a domain concept or a conversational state. A containment scan
enforces that on the contract file itself.

### 2. Absence changes nothing

With no profile configured, the adapter behaves exactly as it did: the same schema, the same
`plan.normalizedText ?? ''` user message, the same validation function, and the same result keys.
`profileDetail` is **absent from the result object**, not present holding `undefined` — an own key
holding `undefined` is a different shape to `Object.keys`, to a spread and to JSON.

The 87 pre-existing M4 specs pass unchanged, which is the actual proof.

### 3. The detail rides only on a fully accepted result

Whatever else a profile validated out of the same answer is surfaced as `profileDetail`, typed
`unknown` because M4 must not know what it is, and **only on a result that passed every gate**.

A pre-gateway state block, a gateway refusal, a provenance mismatch, an invalid structured answer, a
citation mismatch and a post-gateway state block all carry no detail. Detail beside a refusal would
be material extracted from an answer the adapter had already decided not to trust.

### 3a. And only when the ORCHESTRATION also succeeded

M4's gates are M4's. They run before M2's final double gate, and the authoritative state can change
in that window — a revision drifts, an operator takes over, a conversation is cancelled — after which
the orchestration refuses.

So `jarvis-runtime` applies a second rule on top of M4's: **a captured profile detail leaves the
runtime only when the orchestration result is `ok: true`.** Every refused path, including a thrown
turn, reports no observations at all.

This is not in tension with §12. A Core rejection arrives on a _successful_ orchestration; a state
gate firing after the model returned means the run itself was refused, and observations extracted
inside that window must not outlive it.

### 3b. Riya's answer is REPLY-only

The generic seam keeps all four `StructuredReply` kinds. The **Riya** schema accepts one:
`kind: 'REPLY'` with a required body.

Two reasons, pointing the same way. Mechanically, M4 builds a `ModelReplyDraft` only for `REPLY`;
for the other three, `draft` is `undefined` and M2 refuses the candidate as draft-invalid — so
offering them would advertise three answers the authoritative Riya path structurally cannot carry,
each one a guaranteed refusal after a paid inference. And by authority: escalating to a human,
declining to act and requesting clarification _as dispositions_ are policy, owned by Riya's behaviour
boundary and M2. P4B's model drafts text and reports observations; it does not select the action. A
clarifying question is still expressible — it is a `REPLY` whose body asks one, which is what the
question plan is for.

### 4. Riya's model vocabulary lives in its own leaf package

`@qf-jarvis/riya-model-interaction` holds the Riya-specific half and invokes nothing. It depends on
`model-reply-adapter`, `riya-agent`, `riya-conversation-continuity`, `riya-conversation-evolution`
and `zod` — and deliberately **not** on `agent-runtime`: the profile needs one field of `ReplyPlan`
and types it structurally rather than taking a hold on the business-neutral kernel.

It is not in the web service, because it is ONE Riya: a future WhatsApp surface reuses this contract
rather than copying a WEB-shaped schema.

### 5. What the model is shown

A content-minimised projection of the CURRENT conversation, serialized deterministically, bounded at
**8192 characters**, and refused rather than truncated when it does not fit:

```json
{
  "version": 1,
  "phase": "...",
  "known": { "<field>": { "value": "...", "provenance": "..." } },
  "summaryConfirmed": false,
  "message": "..."
}
```

Value and provenance travel **together** — a value without its origin would invite the model to
overwrite something a person confirmed as though it were its own earlier guess.

No `tenantId`, `conversationId`, `messageId` or `subjectRef`: the model has no use for identity, and
every identifier sent is one that can come back in an answer. No contact detail, consent,
`canSubmit`, lead, vendor, package, price or completion evidence. No history, transcript or recent
turns.

`missingFields` and `completeness` are omitted because both are DERIVABLE from what is sent, and a
derived copy invites the model to reason from something that could disagree with the reducer.

No instructions live in this payload. How Riya should behave belongs to the evaluated system prompt.

### 6. The model's provenance vocabulary is narrower than the reducer's

RWC-P4A accepts five origins because many producers may exist. A **model** producer may emit two:

| origin           | may a model claim it? | why                                                                                                                   |
| ---------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `user_stated`    | yes                   | the client's own words                                                                                                |
| `model_inferred` | yes                   | the model concluded it                                                                                                |
| `server_runtime` | **no**                | governed runtime seeding, not a model's decision                                                                      |
| `user_selected`  | **no**                | requires an actual UI selection event; prose is not a chip tap                                                        |
| `user_confirmed` | **no**                | RWC-P6's structured confirmation; a model minting it would upgrade its own interpretation into confirmation authority |

A `CLEAR` must additionally be `user_stated`: an inference may not withdraw a fact.

`parseRiyaModelProfileDetail` enforces **the same rule**, from the same predicate. It is the guard a
composition uses instead of casting the generic seam's `unknown`, so it must be at least as strict as
the schema that produced the value: it requires exactly the two own keys `version` and
`observationBatch`, re-proves the batch through RWC-P4A's canonical constructor, and then re-applies
the producer vocabulary. Without that last step a forged detail carrying a P4A-valid `user_confirmed`
would pass a guard the model itself could never have got past — and would then outrank a fact a
person actually agreed to. RWC-P4A itself is **not** narrowed; this is a producer rule.

### 7. The claimed question plan is checked, never trusted

The model returns the phase and question fields it believes come next. That claim is compared to what
the RWC-P4A reducer independently decides for the same batch — **exact phase, exact fields, exact
order**. `['budget','timeline']` and `['timeline','budget']` are different questions to ask.

A disagreement refuses the **whole** structured answer. Not the plan, not half the observations: a
model whose account of the conversation differs from the reducer's has not understood the
conversation, and keeping the part that looked fine would be picking a winner nobody chose.

The reducer remains the phase and provenance authority.

### 8. A fifth runtime capability, not a wider result

`processInboundForRiyaConversationEvolution({ envelope, continuity })` joins `processInbound` and
`processInboundForCoreAuthorizedReply`. Additive in exactly the way RWC-P2D's fourth method was:
`JarvisRuntimeResult` stays the same ten content-free keys, and a caller that wants observations
names a method that says so.

All three project from **one shared internal execution primitive**. The new method does not call
either older method internally — that would be a second run.

It needs the continuity because one inference has to behave as a multi-turn Riya. Passing it in,
rather than having the runtime load it, keeps the runtime free of persistence: the service that owns
the store owns the read.

It fails closed **as a REFUSED result, not a throw**, on a non-canonical continuity, a
tenant/conversation mismatch against the envelope, a `CONTACT`/`CONSENT`/`COMPLETE` phase, or a
missing evolution prompt binding. This package's taxonomy is that the only error it throws is a
construction-time wiring error, and a new method that threw would make one inbound path behave
unlike the other two.

### 9. A dedicated, evaluated evolution prompt — with no fallback

`riyaConversationEvolutionPromptBinding` is its own config field, requiring **both** `evaluationRef`
and `evaluationPromptDigest`, and the Riya-aware adapter binds it for `CLIENT` and **nothing else**.

There is deliberately no fallback to the ordinary CLIENT reply prompt. Borrowing it would send an
un-evaluated question out under an evaluated prompt's credentials. The run also uses its own task
class `RIYA_CONVERSATION_EVOLUTION`, so the registry resolves the evolution definition rather than a
reply-only one that happens to share the scope.

### 10. One call, captured without global state

The Riya path wraps the M4 port so `draftReply` delegates to `draftReplyDetailed` **once** and
returns only the M2 draft. The orchestrator sees exactly what it always saw; the detail is captured
on the way past.

The capture variable is **function-scoped inside one internal run**. A module-level or
instance-level one would let two concurrent turns see each other's observations.

### 11. Persistence order is owner-locked

The model and runtime run BEFORE the compare-and-set. Observations are a by-product of the same call
that produces the reply, and P4A cannot evolve facts nobody has observed yet.

### 12. Continuity persists independently of what Core decided

Once a validated batch exists, the evolution is eligible to persist even when the outcome is
`CORE_REJECTED`, `CORE_UNAVAILABLE`, `RETRY_LATER` or `HUMAN_REVIEW_REQUIRED`.

A client said what they said, and Core declining to send a reply does not unsay it. What gates
persistence is whether the structured answer passed M4's own gates — which is exactly what the
presence of a canonical batch means. When no model ran, or the answer failed a gate, there is **no
batch and no update**, and an empty one is never fabricated to fill the space.

### 13. The CAS policy: two attempts, one reload, no third

```
evolved = evolve(base, batch)
  changed === false        → no compare-and-set at all; final = base
  UPDATED                  → final = evolved
  NOT_FOUND                → repository-invariant (no create, no restart, no model retry)
  REVISION_CONFLICT        → reload ONCE
      absent / wrong key   → repository-invariant
      remerged.changed === false → final = latest, no second attempt
      UPDATED              → final = remerged
      NOT_FOUND            → repository-invariant
      REVISION_CONFLICT    → continuity-conflict
```

The reconciliation re-runs **nothing**: no model, no runtime, no Core, no re-extraction, no batch
mutation, no loop. The reducer is pure, so re-merging the SAME captured batch against a newer state
is a re-computation rather than a second observation — that purity is the entire reason one bounded
retry is safe.

There is no third attempt. An unbounded loop holds one client's turn open while other writers keep
moving the state, and this service will not spin waiting for a conversation nobody is watching to
converge.

A no-op skips the write entirely: spending a durable write to store what is already stored would
also bump a revision whose entire meaning is "this conversation changed".

### 13a. An authorized reply is bound to the snapshot the model saw

If the **first** compare-and-set returns `REVISION_CONFLICT`, the Core-authorized body produced from
the old base continuity is **withheld** — whether the reconciliation then writes or turns out to be a
no-op.

The failure this closes is concrete. Base is missing a location; the model asks which area the client
is in; Core authorizes that; a concurrent turn records the location; this turn's compare-and-set
loses; reconciliation succeeds and the final continuity now knows the location — and the turn returns
a reply asking for it.

Re-checking the question plan would not be enough. The body is free text and may restate any fact
from the old snapshot, so the only sound rule is that a reply belongs to the state it was written
against.

The observations still persist: a fact is a fact, and the reducer re-merged it against the winner.
Only the text capability is withheld, and **nothing is re-run to replace it** — no second model call,
no second Core decision, no generated stand-in, no third attempt, and no new disposition or wire
field. The V2 result has always permitted `PROCESSED` with no `authorizedReply`, and the private
ingress already treats the body's presence as the sole text gate.

### 14. `continuity-conflict` earns its place

RWC-P2C explicitly refused this error code because the service never called `compareAndSet`, and a
code for a path that could not happen would have implied a behaviour that did not exist. The service
now persists, so two writers racing one conversation is reachable. The vocabulary goes from four
codes to five, each with a fixed content-free message.

### 15. Initial continuity is corrected to the four blocking fields

A new conversation is created `MORE_DISCOVERY_REQUIRED` with `missingFields` exactly
`[serviceInterest, location, budget, timeline]`.

RWC-P2C used all seven. `propertyType`, `scope` and `consultationPreference` are genuinely optional
and never block a summary, so listing them made every conversation look permanently unfinished — and
disagreed with what the reducer recomputes on the very next turn. A spec merges an EMPTY batch into
the initial state and asserts the reducer reports no change, so the service's restatement and the
reducer's internal list cannot drift.

No migration. Existing rows with the old valid seven-field shape stay readable, and the first genuine
evolution normalizes one as part of its own single semantic revision. No bulk rewrite.

## Consequences

- One inbound Riya turn costs exactly **one** model-gateway invocation and at most one Core decision,
  and produces the reply and the observations from the same answer.
- The generic M4 adapter is reusable by a future agent that needs richer structured output, and still
  contains zero Riya semantics.
- The durable `continuityRevision` counter finally counts something.
- A conversation now remembers, so Riya stops re-asking what it was already told.
- A second Riya surface reuses `riya-model-interaction` rather than growing its own schema.

## What this does NOT implement

No QuickFurno handshake and no QuickFurno repository change. No migration and no `0012`. No managed
database access. The private ingress remains **NOT DEPLOYED / NOT LIVE**.

No durable logical message-id idempotency — ADR-0098's prerequisite stands unchanged, so the
QuickFurno caller must not auto-retry an ambiguous turn and one in-flight turn per web conversation
is still required at the gateway. That remains a final-handshake review item before production.

No `CONTACT`, `CONSENT` or `COMPLETE`; no summary confirmation event, completion evidence, consent,
`canSubmit`, lead, vendor, package, price or payment. No location validation or service-area lookup
(**RWC-P5**). No summary confirmation or submission (**RWC-P6**). No RAG (**RWC-P7**). No cross-channel
identity linking (**RWC-P8**). No transport, route, browser client or UI.

## Change-control rule

The following are owner-locked. Changing any of them requires a new ADR, not an edit to this one:

- **one gateway invocation per inbound turn** — no second extraction call, ever;
- the generic profile seam staying **agent-neutral**, and the re-proof of every projected reply
  against the base reply schema;
- the model provenance restriction to `user_stated` / `model_inferred`, and `user_stated` for a
  `CLEAR`;
- the **exact** question-plan agreement check, including field order;
- the dedicated evolution prompt binding with **no fallback**, requiring both `evaluationRef` and
  `evaluationPromptDigest`;
- persistence order — model and runtime before CAS — and the independence of persistence from the
  Core outcome once a batch is validated;
- **at most two** compare-and-set attempts with exactly one reload, and no third;
- withholding the authorized reply after ANY first-attempt `REVISION_CONFLICT`, and never
  regenerating one;
- a profile detail leaving `jarvis-runtime` only on an `ok: true` orchestration;
- the Riya model answer being **`REPLY`-only**, while the generic seam keeps all four kinds;
- `JarvisRuntimeResult` remaining the ten content-free keys.

**Next.** RWC-P5 — [ADR-0100](./ADR-0100-rwc-p5-core-service-availability-context.md) — composes a
Core-owned service availability snapshot into the same one model call, so only refs QuickFurno Core
lists may be emitted and no unavailable service/city pair can reach P4A. It changes nothing here:
still one gateway invocation, still one bounded CAS reconciliation with no reread.
