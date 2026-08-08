# ADR-0098 — RWC-P4A Riya Conversation Evolution Semantics

**Status:** Accepted — RWC-P4A. Implemented on `rwc-p4a-riya-conversation-evolution`, **not merged**, and composed into nothing.
**Deciders:** Owner
**Relates to:** [ADR-0097](./ADR-0097-private-riya-web-ingress-adapter.md) · [ADR-0096](./ADR-0096-rwc-p2d-core-authorized-web-reply-materialization.md) · [ADR-0095](./ADR-0095-rwc-p2b-durable-postgres-riya-conversation-continuity.md) · [ADR-0094](./ADR-0094-rwc-p2c-private-riya-web-conversation-service.md) · [ADR-0093](./ADR-0093-rwc-p2a-riya-conversational-continuity-contract.md) · [ADR-0092](./ADR-0092-jrw-0b-governed-web-runtime-channel.md) · [ADR-0068](./ADR-0068-riya-authoritative-runtime-composition.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md)

**Baseline.** The private Riya web ingress merged as PR #102 — merge commit `291be78fa614e13125525647e66fb78af57ed7a9`. Migrations `0001`–`0011`, `0011` SHA-256 `80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93`, no `0012`.

## Context

RWC-P2A froze the continuity state and said, in its own package note, that it implements _no phase
reducer, no extraction and no provenance merge — RWC-P4 owns those_. Nothing has owned them since.

A read-only pre-implementation audit then found the harder problem: **the semantics RWC-P4 was meant
to inherit were not in this repository.** The RWC-P0B conversation contract
(`docs/contracts/riya-web-concierge-conversation-ux-contract.md`, commit `c73d795`) exists only on a
local branch that was never merged, and RWC-P1B — cited three times in tracked source as a source of
frozen truth — could not be found here at all.

The owner's review corrected the second half of that finding: **RWC-P1B was not phantom.** It existed
as _RWC-P1B — Contract Kernel_ in the historical QuickFurno RWC worktree (branch
`rwc-p1-server-scaffolding`, reported head `73690ccc188ee07bd75be86014371aeb0fee8699`), whose
implementation report records a pure phase reducer, a pure provenance reducer, a deterministic
fixture engine, a phase ask order and provenance tie behaviour — with no AI, no database and no
routes. The qf-jarvis-only audit could not see it because it was never in this repository.

So the semantics are real and were reviewed once. They are simply **not here**, and current
correctness must not depend on a branch in another worktree.

## Decision

### 1. Restate, do not import

The historical RWC-P0B and RWC-P1B decisions are carried forward as **source evidence**. Their
normative content is restated in this ADR and implemented natively in Jarvis.

Neither historical implementation is cherry-picked. The 1,012-line P0B UX document is not merged. No
QuickFurno Riya runtime code enters this repository, and no second Riya is created. After this slice,
current `main` is **self-contained**: no rule the reducer depends on lives only on a local or foreign
branch.

**Their ownership model is explicitly NOT carried forward.** P0B §14 assigned the merge to "the
server" and §39 assigned the requirement draft, conversation phase and field provenance to the
QuickFurno server session. **ADR-0092 §9 superseded that**: those belong to Jarvis. QuickFurno Core
remains business authority; the QuickFurno shell owns presentation and gateway mechanics only.

### 2. One Riya, so the rules are a leaf package

`@qf-jarvis/riya-conversation-evolution`, depending on `@qf-jarvis/riya-agent`,
`@qf-jarvis/riya-conversation-continuity` and `zod`. Nothing else, and nothing depends back on it
yet.

WEB and WhatsApp are the same Riya. Rules that lived inside the web service would become web rules,
and the WhatsApp surface would eventually get its own copy that drifted. The continuity package stays
a **contract**; `jarvis-runtime` stays **composition**; `agent-runtime` stays **business-neutral**.

### 3. RWC-P4A is pure; RWC-P4B owns the world

Input: one `RiyaConversationContinuityStateV1` plus one strict observation batch. Output: an evolved
state and a next-question plan.

No natural-language parsing, no model, no prompt, no clock, no randomness, no I/O, no database, no
`compareAndSet`, no Core call, no HTTP, no environment read. Determinism is not tidiness here — it is
what makes the RWC-P4B reconciliation path (reload, re-merge the SAME captured batch, retry once)
safe, because a re-run of the same inputs must produce the same answer.

### 4. The observation batch

`RiyaConversationObservationBatchV1 { version, observations[], skipProjectDetails }`, each
observation `{ field, operation: 'SET' | 'CLEAR', value?, provenance }`, `.strict()`.

At most one observation per canonical field; a **duplicate field refuses the entire batch** rather
than picking a winner, because whichever the reducer chose would be a rule nobody wrote down. `SET`
requires a value, `CLEAR` forbids one. No evidence quote or span, raw client text, confidence,
reasoning, chain-of-thought, `messageId`, channel, contact detail or business field — each is a
refusal, not a silently dropped key.

Evidence quotes are refused deliberately: a quote is a verbatim fragment of what a person said, and
retaining fragments is how a system acquires a transcript nobody decided to keep.

`skipProjectDetails` means the client **explicitly** declined optional detail collection. It is never
inferred from silence.

**The exported reducer re-proves the batch it is handed.** A TypeScript interface is not a runtime
trust boundary: `evolveRiyaConversation` is exported, so an untyped or JSON-fed caller can pass a
forged object that never met the constructor. It is therefore canonicalized through the REAL
`createRiyaConversationObservationBatch` before anything reads it, and everything downstream uses the
canonical result. The duplicate-field case is why this matters most — the constructor's contract is
that a duplicate refuses the ENTIRE batch, and merging a forged batch one observation at a time would
instead silently pick a winner. The schema is not duplicated inside the reducer, and a malformed
input becomes `invalid-observation-batch` rather than a raw `TypeError`.

### 5. Provenance records the ORIGIN of the fact, not the mechanism that read it

```
model_inferred (1) < server_runtime (2) < user_selected (3) == user_stated (3) < user_confirmed (4)
```

A model that parses the literal words _"budget is 8 lakh"_ has **not** inferred anything — the client
stated it, and the origin is `user_stated`. A model that concludes a budget the client never mentioned
has inferred it: `model_inferred`. A chip tap is `user_selected`; a governed seed or entry context is
`server_runtime`; a value shown to the client and agreed is `user_confirmed`.

Getting this backwards would make every extracted fact permanently one rank too weak. **Deciding which
category a given model output belongs to is the PRODUCER's job.** This package enforces the merge and
never re-derives provenance from who called it, what model ran, or how confident anything was — there
is no confidence field and no mechanism field.

**Same value.** Higher incoming rank strengthens the provenance and keeps the value. Equal or lower is
a semantic **no-op** — not a rejection, because nothing was refused; the state already says exactly
this. Repeating a fact is not news, and bumping a revision for it would make every restated sentence
look like a change and cost a compare-and-set for nothing.

**Different value.** Higher rank replaces. Lower rank is rejected (`lower-provenance`) and the existing
value stands. **Equal rank: the later observation wins** — two statements of equal standing about one
field are a person changing their mind, and the most recent is the one they meant. This covers
`user_stated → user_stated`, `user_selected ↔ user_stated`, `user_confirmed → user_confirmed` and
`model_inferred → model_inferred` alike.

**`user_confirmed` is never overwritten from below.** Only another confirmation may change it. RWC-P6's
structured summary edit is the canonical producer of `user_confirmed`; RWC-P4A invents no path that
upgrades arbitrary prose to it.

**`CLEAR` requires a user origin** — `user_selected`, `user_stated` or `user_confirmed`. A
`model_inferred` or `server_runtime` clear is refused as `clear-not-user-origin`, distinct from a rank
loss: withdrawing a fact is an act only the person who could have stated it may perform. The rank rule
still applies on top, so `user_stated` cannot clear a `user_confirmed` value but `user_confirmed` can.
Clearing removes the value **and** its provenance — provenance for an absent value would describe
nothing, and the contract refuses it.

Inputs are never mutated; the result is frozen; a rejected field does not corrupt the rest of the batch.

### 6. No second requirement draft

Only the canonical `NeedDiscovery` fields exist: `serviceInterestRef`, `locationRef`,
`propertyTypeRef`, `scopeSummary`, `budgetNote`, `timelineNote`, `consultationPreferenceRef`. No
`projectCity`, `budgetRange`, `requirementDraft` or parallel enum.

The merged discovery is rebuilt through the **real** `createNeedDiscovery` — reached by handing the
state constructor an input, which validates it with `createNeedDiscovery` itself. So every per-field
bound `riya-agent` owns still applies, and an oversized note or malformed opaque reference is refused
there rather than by a second set of bounds kept in step by hand.

### 7. Conversational completeness, which is not `canSubmit`

Summary-required: `serviceInterest`, `location`, `budget`, `timeline`. Optional: `propertyType`,
`scope`, `consultationPreference`.

- `HUMAN_REVIEW_REQUIRED` is **preserved**, never silently cleared: a person decided this conversation
  needs looking at, and a reducer that undid that the moment a field arrived would overrule a human.
- Otherwise, all four present → `SUFFICIENT_FOR_CORE_REVIEW` with **no** missing fields. The canonical
  constructor refuses "sufficient" plus a missing list, and an absent optional field is not a missing
  requirement — it is simply no longer blocking.
- Otherwise → `MORE_DISCOVERY_REQUIRED`, listing only still-unresolved **required** fields. Naming an
  optional field as missing would make the conversation look unfinished forever.

`consultationPreference` is opportunistic: stored if supplied, never a primary question, never
blocking. This is ADR-0067 discovery completeness and never becomes QuickFurno's business `canSubmit`.

### 7a. A prior summary confirmation is invalidated by an accepted value change

RWC-P4A **never creates** a confirmation — `false` can never become `true` here, and RWC-P6 remains
the only owner of confirming a summary. Reaching `SUMMARY` is not agreeing with one.

But it **must invalidate** one. A confirmation is about the exact facts the client reviewed, so an
accepted change to any discovery VALUE means the summary they agreed to no longer exists. Carrying
the flag forward would let a later phase act on an agreement to something that was since edited.

| what happened                                                    | `summaryConfirmed` |
| ---------------------------------------------------------------- | ------------------ |
| accepted `SET` with a **different** value (required or optional) | **false**          |
| accepted `CLEAR` of an existing value                            | **false**          |
| provenance strengthening on an **identical** value               | preserved          |
| same-value no-op                                                 | preserved          |
| rejected lower-provenance update                                 | preserved          |
| phase or completeness normalization with no value change         | preserved          |

The merge reports this as an internal `valueChanged`, deliberately narrower than `changed` and
deliberately not exported: strengthening a provenance changes nothing the client read, and throwing
their confirmation away for it would make every restatement re-open a settled summary.

### 8. Phases: the ceiling is SUMMARY

The nine frozen phases are unchanged. RWC-P4A may produce only `INTRO` … `SUMMARY`. It **never**
reaches `CONTACT`, `CONSENT` or `COMPLETE` — RWC-P6 owns those — and a state already in one is refused
with `phase-out-of-scope` rather than reinterpreted or regressed.

Phase is **derived** from what is known, not advanced one step at a time:

1. no service → `NEED`
2. service, no location → `LOCATION`
3. all four required present → `SUMMARY`
4. service + location, budget/timeline missing → the `PROJECT_DETAILS` question below
5. otherwise → `BUDGET_TIMELINE`

`INTRO` survives only a complete semantic no-op on an untouched state; a first meaningful turn with no
service known is `NEED`.

**Multiple fields in one turn are accepted atomically**, and **multiple phases may be skipped**. _"Need
modular kitchen in Pune, budget 8 lakh, start next month"_ reaches `SUMMARY` in one evolution. The
product rule is that this must not be longer than the form it replaces, so Riya never asks for
something she already has.

**Out-of-order answers are kept.** A later field supplied before the current primary is stored, and the
conversation returns to the earliest unresolved required phase and asks only that.

**`PROJECT_DETAILS` is optional and gets ONE opportunity per uninterrupted FORWARD progression.** It
never blocks the summary. It is exited when a property type or scope is supplied, when
`skipProjectDetails` is explicit, or when the same turn supplies budget or timeline (the client has
already moved downstream). Otherwise it **stays** — silence and a side question are not a skip, which
is what keeps the detour resilient without persisting a pending-question field.

"Per forward progression" is the honest bound, and it is bounded by what continuity V1 can express.
There is no persisted "opportunity consumed" bit and this slice deliberately does not add one, so
while the conversation stays at or beyond `BUDGET_TIMELINE` the detour is not re-entered — but if an
explicit user-origin correction clears a prerequisite and the phase regresses to `NEED`/`LOCATION`,
re-establishing it may offer the detour again. That is the right trade: the alternative is widening
persisted state to remember a question, and asking once more after the client rewrote their own
requirements is not the failure worth paying for.

### 9. One question per turn, with one permitted pair

`NEED` → `[serviceInterest]`. `LOCATION` → `[location]`. `PROJECT_DETAILS` → at most one open optional.
`BUDGET_TIMELINE` → `[budget, timeline]` when both are missing, otherwise the single one. `SUMMARY` →
`[]`.

Budget and timeline are the **only** two-field plan: they form one natural thought. No plan exceeds two
fields, and no contact or consent question exists in RWC-P4A at all. The plan is derived every time and
never persisted, and it carries **no prose** — how to phrase a question is the prompt's job, and a
sentence here would be a second place Riya's voice lived.

### 10. Exactly one revision increment per changed batch

`changed === false` → the state returned is the canonical original and `continuityRevision` is
untouched, so RWC-P4B can skip the compare-and-set entirely.

`changed === true` → `continuityRevision + 1`, **once**, however many fields moved. A revision counts
turns of the conversation that changed something, not fields; four facts learned from one sentence are
one such turn. A phase-only change and a provenance-strengthening-only change are both semantic changes
and bump once. Advancing past `Number.MAX_SAFE_INTEGER` is refused (`revision-exhausted`) rather than
silently repeating a revision, because a compare-and-set on a counter that stopped counting would
report success while losing every write after it.

RWC-P4A performs **no** compare-and-set. This rule exists so the P2B CAS contract is met exactly when
P4B does.

### 11. `ClientSalesSignals` are never fabricated

`hasPriorSalesContext`, `requestedHumanAssistance`, `requestedQuoteOrConsultation`,
`providedRequirementDetail`, `askedAboutReadiness`, `outOfSalesScope` and `missingDiscoveryFieldCount`
remain an **external validated input** (ADR-0067/0068), revalidated by the runtime's behaviour adapter.
Neither P4A nor P4B synthesises them from text. NeedDiscovery evolution and `ClientSalesSignals`
authority are separate concerns and are not merged.

### 12. Locked for RWC-P4B, implemented nowhere here

**One model call.** The audit proved the existing architecture supports it, and **Option A is
selected**: extend the single structured model result in a role-safe way so one inference produces both
the existing reply draft material and bounded Riya observations, while the orchestrator still receives
only the existing `ModelReplyDraft` projection. One gateway invocation **total** per request. No
extraction call plus reply call, no second router, no second runtime, and no Riya-specific code in
generic `agent-runtime`. Expected direction: a per-scope structured-schema binding in
`model-reply-adapter`, `jarvis-runtime` capturing the detailed result from the SAME invocation, and
strict reply projection and Core authorization unchanged.

**CAS policy.** Semantic no-op → no CAS, no bump. Changed → CAS `expectedRevision` → `+ 1`. On
`REVISION_CONFLICT`: **one** bounded reload and a **pure re-merge of the already-captured batch** — no
second model call, no second Core call, at most one second CAS attempt. A second conflict fails closed
through a bounded service error. `NOT_FOUND` after continuity was established is a repository
invariant; an unavailable store is continuity-unavailable. Never loop, and never retry model extraction
inside reconciliation.

### 13. Replay and logical message identity: a DEPLOYMENT prerequisite, not a state change

The audit correctly found that the private ingress's `(caller, requestId)` replay protection is not the
same as logical `messageId` idempotency, and that a nondeterministic extraction re-run under a fresh
`requestId` could produce a different second update.

That is **not** solved by quietly widening continuity V1. RWC-P4A adds no `lastAppliedMessageId`, no
processed-message history, no transcript ledger and no migration `0012`.

Until the final QuickFurno handshake adopts a durable logical-turn idempotency policy:

- the private ingress remains **NOT DEPLOYED / NOT LIVE**;
- the QuickFurno caller **must not** automatically retry an ambiguous Jarvis turn under a fresh
  `requestId`;
- **one in-flight turn per web conversation** remains required at the QuickFurno gateway;
- durable logical message-id idempotency is a **P4B / final-handshake review item before production**.

Replay therefore does not block this pure domain package, and the prerequisite is recorded here so
nobody deploys past it by accident.

## Consequences

- The phase, provenance and merge rules now exist in Jarvis, in one place, testable in isolation.
- Current `main` no longer depends on an unmerged or foreign branch for correctness.
- A future WhatsApp Riya reuses this package rather than growing a second reducer.
- RWC-P4B has a deterministic function to call and a CAS contract already shaped to fit.
- `riya-conversation-continuity` keeps the boundary it drew for itself.

## What this does NOT implement

No live extraction, model call, prompt, gateway binding or structured-schema change. No service,
runtime or ingress change. No `compareAndSet`, persistence, database, migration or managed-database
access. No `CONTACT`/`CONSENT`/`COMPLETE`, `summaryConfirmed`, completion evidence, consent,
`canSubmit`, lead, vendor, package, price or payment. No location validation or service-area lookup
(**RWC-P5**). No summary confirmation or submission (**RWC-P6**). No RAG (**RWC-P7**). No cross-channel
identity linking (**RWC-P8**). No QuickFurno repository change and no handshake.

## Change-control rule

The provenance ranking and its four merge rules (§5), the user-origin `CLEAR` restriction, the
`SUMMARY` ceiling (§8), the one-opportunity `PROJECT_DETAILS` rule, the single budget+timeline pairing
(§9), the confirmation-invalidation rule (§7a) and the exactly-one-increment revision rule (§10) are
owner-locked. Weakening any of them —
letting a lower provenance overwrite, admitting a third question field, reaching `CONTACT`, or bumping
a revision for a no-op — requires a new ADR, not an edit to this one.

**Next.** RWC-P4B: the one-model-call live extraction and the persistence composition.
