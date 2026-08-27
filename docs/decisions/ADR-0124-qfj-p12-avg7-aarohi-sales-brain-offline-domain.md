# ADR-0124 — QFJ-P12 / QVGE / AVG-7: the Aarohi SALES BRAIN OFFLINE DOMAIN

- **Status:** Accepted (offline domain only; runtime PLANNED / DISABLED)
- **Owner phase:** QFJ-P12 — Aarohi Vendor Growth and Acquisition
- **Overlay stage:** AVG-7 — Aarohi Sales Brain
- **Certified baseline:** `60b4ba4d2653c7c7013c68436bb544645018e53e` (PR #165 / AVG-6 merge)
- **Supersedes:** nothing
- **Related:**
  [ADR-0085](ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) (governing
  architecture and the permanent split),
  [ADR-0111](ADR-0111-qfj-p12-avg2-aarohi-discovery-enrichment-domain.md),
  [ADR-0112](ADR-0112-qfj-p12-avg3-aarohi-scoring-outreach-eligibility-domain.md),
  [ADR-0113](ADR-0113-qfj-p12-avg4-aarohi-outreach-workspace-domain.md),
  [ADR-0122](ADR-0122-qfj-p12-avg5-aarohi-instagram-conversation-offline-domain.md),
  [ADR-0123](ADR-0123-qfj-p12-avg6-aarohi-omnichannel-identity-whatsapp-handoff-offline-domain.md)

---

## Context

The canonical overlay sentence for this stage, in full:

> **AVG-7 — Aarohi Sales Brain.** The conversation and objection-handling behaviour for acquisition.
> Bounded by the same sales-ethics prohibitions as Anisha, and by the rule that the brain proposes
> and Core disposes — no commercial commitment originates in the model.

Every clause is load-bearing, and the last one is the constraint the rest of this ADR is arranged
around.

### The sequencing decision this ADR is written under

The owner's sequence is locked: **finish Aarohi AVG-7 through AVG-12 as offline domains, then full
Aarohi certification, then QFJ-P09 real QuickFurno execution integration, then staged activation.**
AVG-7 is therefore a behaviour proof, not an integration.

### The failure this stage is designed against

A sales brain fails in a particular way, and it is not by being unhelpful. It fails by being
**fluent**. Asked a question whose answer it does not have, a capable system supplies one:
a price that sounds right, a lead volume that sounds encouraging, a deadline that moves the deal
along. Every one of those is a commercial commitment nobody authorised, made to a real business, in
QuickFurno's name.

The second failure is quieter. A prospect says "please stop contacting me" in the same message as
"how much is it?", and a system optimising for the sale answers the second question.

Neither failure is fixed by a better prompt. Both are fixed by an arrangement in which the brain has
no field to put a price in and no path from a rejection to a sales reply.

---

## Decision

### 1. A "sales brain" that makes no model call, and the reason that is not a compromise

The precedent is already in this repository. `@qf-jarvis/anisha-agent` decides **deterministically**
whether a model boundary may later be used, and calls no model itself; `@qf-jarvis/riya-agent` is the
same shape. The governed model waist is `@qf-jarvis/model-gateway` and the governed prompt mechanism
is `@qf-jarvis/prompt-registry`.

AVG-7 imports neither, depends on neither, names no provider, holds no prompt text and performs no
retrieval. Its package dependency list is unchanged: `zod` alone.

This is not deferral for its own sake. The thing worth proving first is the **behaviour boundary a
model would later sit behind** — which questions may reach a draft at all, which must stop at a Core
fact, and what a rejection outranks. A boundary proved after the model is attached is a boundary
proved too late, because by then there is a fluent component with an opinion about every case the
boundary was supposed to decide.

So the interpretation is **INJECTED**: a strict, closed, bounded structure a future gateway response
could be parsed into, treated as an untrusted advisory throughout.

### 2. No direct classification of message text

AVG-5 already holds bounded raw inbound body inside its offline conversation snapshot, and AVG-7
receives that snapshot because it must bind the current turn. It does not copy the body anywhere,
expose it on any artifact, accept a caller-supplied body, or classify it.

A keyword classifier would have been easy and would have been wrong twice over: it would become
accidental product behaviour that nobody reviewed, and it would be the component a future model
replaces — meaning the boundary would be re-proved against a different classifier than the one that
ships. Conversation understanding is model-backed later, through the gateway. What AVG-7 proves is
everything that happens **after** interpretation.

### 3. The interpretation is bound to the CURRENT turn, and the caller cannot say which that is

`createAarohiSalesBrainInterpretation` takes the canonical AVG-5 conversation and **stamps** all five
bindings — prospect, conversation, thread, participant and message — from the latest inbound turn.
There is no input field for a message reference, a turn index, a `latest: true` flag or a body hash.
The conversation decides what "latest" means, which is the only definition that cannot be argued
with, and AVG-5 has already certified that sequence as canonically ordered by semantic UTC instant
then message reference.

`evaluateAarohiSalesTurn` asks again, and separately: all four conversation bindings, **then** the
message reference. Both questions are needed. References are opaque and channel-local, so a matching
message reference on its own proves nothing; and every binding matching except the message reference
is precisely the stale-replay case.

**Appending a newer turn makes an existing reading stale by construction**, and a stale reading is
refused with its own code rather than replayed. A conversation that has moved from "does this fit my
business?" to "stop contacting me" must not be answered from the first reading.

### 4. Time causality, as semantic instants

Two links, both checked, neither by string comparison:

```
latest message observedAt  ≤  interpretation interpretedAt  ≤  plan plannedAt
```

The canonical grammar makes milliseconds optional, so `09:00:00.500Z` sorts before `09:00:00Z`
lexicographically while being half a second later, and `09:00:00Z` and `09:00:00.000Z` are one moment
written twice. AVG-5 shipped a comparator that compared the strings and had to be corrected; this
file is written with the fix, and specs assert both directions because only one of them is wrong per
comparison. No clock is read: both instants are caller-asserted, and comparing them is comparing two
stated facts.

### 5. Closed vocabularies, and what is deliberately not in them

Eight intents, eight objection kinds, six strategies. The intent vocabulary contains no
`APPROVED_TO_CONTACT`, `CONSENT_GRANTED`, `VENDOR_ACTIVE`, `PAYMENT_CONFIRMED`,
`REGISTRATION_CONFIRMED`, `PACKAGE_ELIGIBLE` or `READY_TO_SEND`, because each of those is a business
STATE only Core can hold. Somebody typing "I've already paid" is a thing they typed.

The objection kinds are conversational categories and nothing more. `PRICE_OR_PACKAGE` does not mean
a price exists; `LEAD_QUALITY` does not mean the leads are good or bad; `TRUST_OR_VERIFICATION` does
not mean anybody's verification status is known; `PRIVACY_OR_CONTACT` does not mean consent or
suppression changed.

No strategy is a reply. None of the six contains SEND, APPROVED, AUTHORIZED, DRAFTED or ANSWER.

### 6. The policy is total, deterministic, and stated once

Both vocabularies are mapped into one small class set by **total** `Record`s, so a member added later
fails to compile until somebody classifies it — the failure mode being an intent added next year
silently inheriting `ORDINARY` and becoming draftable without a decision. Precedence is then stated
once, over the classes rather than over sixty-four pairs:

1. **Contact risk, from EITHER signal** → `REQUEST_CORE_CONTACT_POLICY_REVIEW`
2. **Commercial, from either signal** → `REQUEST_CORE_COMMERCIAL_CONTEXT`
3. **Core process** → `REQUEST_CORE_PROCESS_CONTEXT`
4. **An uncategorised objection** → `REQUEST_HUMAN_REVIEW`
5. **An unclear intent** → `PREPARE_CLARIFYING_REPLY_BRIEF`
6. **Ordinary** → `PREPARE_NONCOMMERCIAL_REPLY_BRIEF`

No model, no score, no confidence, no threshold to tune.

### 7. A rejection outranks selling, and the mixed signal is the whole point

Step 1 reads **both** vocabularies, and it runs first. A message that is commercially interesting and
also asks not to be contacted is a message asking not to be contacted. Letting the commercial branch
win a mixed signal is exactly how a system ends up selling to somebody who said stop, so
`COMMERCIAL_TERMS` + `PRIVACY_OR_CONTACT` and `REJECTION_OR_STOP` + `PRICE_OR_PACKAGE` both stop.
It cannot be outvoted by interest, priority, score or any amount of identity evidence, because none
of those is an argument about consent.

The stop is **local and honest**. The brief sets `stopSalesPendingCoreReview`,
`requiresCoreContactPolicyRevalidation` and `requiresCoreConsentRevalidation`, and
`futureModelDraftEligible` is false. It does **not** record that the prospect opted out: there is no
`optedOut`, `doNotContact` or `suppressed` field anywhere, `consentEstablished` and
`suppressionMutated` are pinned false, and consent and suppression remain Core's. Reading a message
is not a way to change them — it is a reason to ask Core again.

### 8. Commercial questions stop at "Core facts required" — the AVG-8 boundary

AVG-8 owns Commercial Truth and the Package Engine. AVG-7 therefore contains no package catalog, no
price, no amount, no currency, no discount, no offer, no entitlement, no lead-credit value, no
billing term, no pricing logic and no "best package" selection — in code, in tests or in docs.

A commercial question returns `REQUEST_CORE_COMMERCIAL_CONTEXT` with
`requiresCoreCommercialContext: true` and `futureModelDraftEligible: false`. The eligibility flag is
false for a specific reason: **a model asked to answer a price question whose facts are missing will
supply them.** Fluently, and from nowhere.

A spec asserts the strongest available form of this: the **only number anywhere in a plan is the
contract version**. A price, an amount, a discount percentage, a lead count and a revenue figure are
all numbers, so counting them is tighter than naming the fields they might arrive in.

### 9. Registration, payment and activation stop at "Core process truth required"

AVG-9 owns registration integration; AVG-10 owns payment, activation and the Anisha handoff. AVG-7
returns `REQUEST_CORE_PROCESS_CONTEXT` and claims nothing: `registrationMutated`, `paymentMutated`,
`activationMutated` and `anishaHandoffExecuted` are pinned false, `completeCoreActiveHandoff` is
neither imported nor named, and no acquisition case is read or moved
(`acquisitionCaseMutated: false`).

### 10. A reply BRIEF, and why there is no field that can hold a sentence

The brief carries closed strategy and obligation tokens only. There is no `replyText`, `body`,
`message`, `templateText`, `naturalLanguageExplanation` or `modelPromptText` — and no `promptRef`
either, because prompt binding belongs to the later governed composition rather than to this proof.

This is the load-bearing structural choice. A string field on a sales artifact is where a price, a
guarantee or an invented deadline eventually appears, and no schema can tell those apart from an
innocent sentence once the field exists. The safest first proof is semantically closed.

`futureModelDraftEligible` means exactly one thing: **a later governed composition MAY ask QF Model
Gateway for a draft.** It does not mean a model was called, a prompt was resolved, a reply exists, a
reply is safe, a reply is approved, or a send is allowed. It is true only for the two `PREPARE_*`
strategies and false for every strategy still waiting on a fact Core has not supplied.

Eligibility to draft later is also not permission to claim anything: on the ROI objection —
the case where a fluent system would reassure with a number — `guaranteeLeadVolume`,
`guaranteeRevenue` and `guaranteeConversion` are all false on the plan that carries the eligibility.

### 11. The CURRENT Core gate is re-run, every time

`evaluateAcquisitionEligibility` is delegated to AVG-1 and not restated, so the status map lives in
one place. Exactly `NOT_REGISTERED` proceeds, with an explicit fail-closed branch afterwards because
"unreachable" is a claim about today's call graph. A spec drives all sixty-four signal pairs against
each of `DO_NOT_CONTACT`, `REGISTERED`, `ACTIVE` and `UNKNOWN` and gets nothing: interest is not an
input to the gate, and a stale earlier `NOT_REGISTERED` grants nothing at all.

### 12. The public parser certifies exactly what the evaluator produces

AVG-5's owner review found a builder checking an invariant its parser did not. AVG-6's owner review
found a downstream builder trusting a parsed artifact as a policy proof. Both lessons are applied
here **up front**:

- The strategy on a brief must equal `salesStrategyFor(intent, objectionKind)` — the same function
  the evaluator calls. A hand-built plan re-labelling a rejection as an ordinary reply brief is
  refused at the public boundary, not merely inside a builder somebody could route around.
- Every obligation flag must equal the total `SALES_STRATEGY_OBLIGATIONS` map entry for that
  strategy. There is one invariant with two callers, and no second opinion for a forgery to satisfy.
- `coreStatus` is `z.literal('NOT_REGISTERED')`, so a plan cannot even be written down for a
  suppressed prospect.

### 13. AVG-7 stops at the plan

No downstream artifact is built here, and that is a decision rather than an omission. AVG-4 already
owns the outreach workspace; actual model drafting and composition are separately bindable later. A
downstream builder introduced in the same slice would have had to re-derive this plan from the
conversation, the interpretation and the Core observation to avoid the AVG-6 defect — which is a
second proof, and belongs to the slice that actually needs it.

### 14. One containment scan was narrowed, and the trade is stated

Through AVG-6 this package's spec banned the bare substrings `price` and `discount` in production
source. AVG-7 writes both — as `priceOriginatedByBrain: false` and `discountOriginatedByBrain: false`,
which is how a prohibition becomes machine-checkable rather than prose.

Those are **declarations of absence**, and this is the third time the same argument has applied
(AVG-5's `metaApiCalled`, AVG-6's `whatsappSendRequested`). The ban moved to the shapes a commercial
VALUE would actually arrive in — `pricing`, `unitprice`, `listprice`, `amountdue`, `currency`,
`discountpercent`, `discountcode`, `entitlement`, `invoice`, `checkout`, `quota` — plus a shape ban
on any field literally called `price`, `discount` or `amount`. In exchange the posture is asserted
field by field, which is a stronger check than the substring ever was. New bans were added at the
same time for the two waists and for retrieval: `model-gateway`, `model-gateway-composition`,
`model-reply-adapter`, `prompt-registry`, Mastra, provider SDK names, `renderPrompt`, `systemPrompt`,
`embedding` and `vectorStore`.

### 15. Three mutation findings worth recording

Eighty-three negative mutations were applied, and three initially SURVIVED. Each was a real gap in
the assertions rather than a weak mutation, and each was closed by strengthening the boundary.

**A schema can be widened quietly.** `.strict()` refuses keys a schema does not KNOW about; it says
nothing about the keys it does know about. A mutation adding `quotedValue: z.number().optional()` to
the public interpretation schema therefore passed everything, because every spec tested a list of
field names somebody had thought of. The three public schemas now have their field lists asserted
directly, so widening one fails a test rather than a review.

**A masked check is not a proved check.** The mutation removing "does this strategy follow from these
two signals?" changed nothing, because every forgery the specs tried also carried the wrong
obligation flags and died on those instead. The case that isolates it is a brief that is INTERNALLY
CONSISTENT and still wrong: an ordinary reply brief, with the ordinary obligations, for a message
read as a rejection. That is the dangerous forgery, and it is now a spec — along with the whole
sixty-four-pair matrix of brief swaps.

**Banning database clients leaves the SQL.** A mutation writing `CREATE TABLE sales_plan (...)` into
the domain source was caught by nothing: the containment scans banned `postgres` and `supabase` and
never banned a statement. A schema statement sitting in a pure domain package is one import away from
being run by something that does have a connection, so SQL shapes are now banned outright.

---

## What AVG-7 deliberately does not do

| Left out                                                                                  | Owner                                                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Price, package, discount, offer, entitlement, any commercial fact                         | AVG-8                                                          |
| Registration integration                                                                  | AVG-9                                                          |
| Payment, activation, Anisha ownership handoff                                             | AVG-10                                                         |
| Persistence, dashboard, admin APIs, analytics, conversation memory                        | AVG-11                                                         |
| Any increase in autonomy                                                                  | AVG-12                                                         |
| Model calls, prompt resolution, retrieval, drafting                                       | later composition through QF Model Gateway and Prompt Registry |
| Shared executable channel adoption, `CommunicationRequestV1`, n8n route, provider adapter | **QFJ-P09**                                                    |

There is no database, migration, store, cache, scheduler, environment read, secret, HTTP client,
provider SDK, embedding or vector store. Dependencies are unchanged: `zod` alone.

---

## Consequences

Aarohi can now decide what KIND of reply would be safe to think about next, and still cannot say
anything.

The value is narrow and worth stating plainly. When a governed model composition is eventually built
on QF Model Gateway, it will attach to a domain that already refuses to answer a price question, already
stops on a rejection it found inside a commercially interesting message, already re-runs the Core gate
on every turn, already refuses a reading of a message that is no longer current, and already states
every prohibition as a machine-checked literal. The model is the part that does not exist. The
controls around it are what this slice is.

**Runtime status is unchanged: PLANNED / DISABLED.** No package or application imports
`@qf-jarvis/aarohi-agent`, and a spec asserts that the first consumer will be a deliberate decision.

**No commercial commitment originates in the brain, and none can, because there is nowhere to put
one.**
