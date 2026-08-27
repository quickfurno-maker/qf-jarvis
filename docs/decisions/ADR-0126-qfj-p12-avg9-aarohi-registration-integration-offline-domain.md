# ADR-0126 — QFJ-P12 / QVGE / AVG-9: the Aarohi REGISTRATION INTEGRATION OFFLINE DOMAIN

- **Status:** Accepted (offline domain only; runtime PLANNED / DISABLED)
- **Owner phase:** QFJ-P12 — Aarohi Vendor Growth and Acquisition
- **Overlay stage:** AVG-9 — Registration Integration
- **Certified qf-jarvis baseline:** `17cc8d86d1505209a07415ee5bb96c79cebb1263` (PR #167 / AVG-8 merge)
- **QuickFurno marketplace commit inspected:** `06b1e22cfa866cd3840c7ecb065b9d0c4acb8bca` (read-only)
- **Supersedes:** nothing
- **Related:**
  [ADR-0085](ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) (governing
  architecture and the authority ceiling),
  [ADR-0122](ADR-0122-qfj-p12-avg5-aarohi-instagram-conversation-offline-domain.md),
  [ADR-0123](ADR-0123-qfj-p12-avg6-aarohi-omnichannel-identity-whatsapp-handoff-offline-domain.md),
  [ADR-0124](ADR-0124-qfj-p12-avg7-aarohi-sales-brain-offline-domain.md),
  [ADR-0125](ADR-0125-qfj-p12-avg8-aarohi-commercial-truth-package-engine-offline-domain.md)

---

## Context

The canonical overlay sentence for this stage, in full:

> **AVG-9 — Registration Integration.** Guiding a converted prospect into QuickFurno registration.
> Registration is performed by Core; Aarohi assists and observes. No marketplace mutation occurs
> from this side.

AVG-7 established that a registration question stops at `REQUEST_CORE_PROCESS_CONTEXT`. AVG-9 is
what happens next, and the whole of the design is in the second sentence: **Core registers; Aarohi
assists and observes.** That distinction has to be structural rather than documented, because a
domain that could register somebody and merely promises not to is a domain that eventually will.

### The failure this stage is designed against

Not a failed registration. A **plausible** one.

Every marketplace has a signup flow with a shape a capable system can produce on demand: verify a
mobile number, upload a GST certificate, choose a package, pay, go live. Each step sounds right.
Each is the kind of thing a fluent drafter supplies when asked a question whose facts it does not
have — and every one of them, said to a real business in QuickFurno's name, is a procedural claim
nobody at QuickFurno authorised. A vendor who uploads the wrong document because Aarohi invented a
requirement has been misled by QuickFurno.

The second failure is quieter: **a local state standing in for Core evidence.** The acquisition-case
domain already contains `REGISTRATION_STARTED` and `REGISTERED`. Writing one of those down would
cost one function call and would produce, at no point, any evidence that a registration happened.

---

## Decision

### 1. Core exposes a registration WRITE and no registration-process READ, so nothing is mirrored

AVG-8 could mirror seven fields because Core's available-package read service offered seven fields.
AVG-9 audited the same repository for the equivalent and found the opposite shape.

At the inspected commit, QuickFurno's registration surface is:

- `services/vendorService.ts` → `registerVendor(input: VendorRegistrationInput)`, a **mutation**
  that inserts into `public.vendors`. Its input carries `business_name`, `owner_name`, `phone`,
  `email`, `whatsapp_number`, `gst_number`, office address fields and GPS coordinates.
- `app/vendors/register/page.tsx`, the onboarding UI.

There is no service, route or API that answers "what does registering involve": no
registration-process read, no requirements read, no step read, no registration-status read for a
party who has not registered. A repository-wide search for `registrationStatus`, `registration_step`,
`onboarding_step` and `RegistrationProcess` returns nothing.

Two conclusions follow, and the second is the load-bearing one.

**The write contract is not mirrored, and is banned by name.** `registerVendor`,
`VendorRegistrationInput`, `vendorService` and the sibling vendor services are in the containment
scan. Mirroring that input type would have handed a phone number, an email address and a GST number
to a package whose entire premise is that it holds no destination and no identity artefact.

**No process contract exists, so none is invented.** This contract carries a closed AVAILABILITY
token and an OPAQUE reference to Core-authored material. It holds no step, ordered stage,
requirement, document list, verification flag, duration, endpoint, form or field list. Saying
`CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE` and pointing at Core's own material is worth less than a
real process description and is worth infinitely more than a plausible one.

### 2. Availability is a three-member closed vocabulary with exactly one member that proceeds

```
CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE      → the only member that proceeds
CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE    → Core answered: it has none
CORE_PROCESS_CONTEXT_UNKNOWN                 → nobody asked, or nobody replied
```

The vocabulary is about availability and never about content: there is no `STEPS_KNOWN`,
`REQUIREMENTS_KNOWN` or `SIGNUP_READY` member, and a spec asserts no member contains those words.

The last two are separate because they are separate facts, and they produce separate refusals
(`..._NOT_AVAILABLE` and `..._UNRESOLVED`). The AVG-1 gate makes the same distinction for the same
reason: a reviewer wants to know whether Core said no or nobody asked.

The absence branch is `absentProcessContextRefusal`, a switch with **no default branch** over the two
non-proceeding members. A fourth availability token fails to compile until somebody decides what it
means — which is the AVG-1 role-map discipline, applied where the failure mode is a new token
silently inheriting permission.

### 3. The observation is a discriminated union, so a reference cannot outlive its availability

`coreRegistrationProcessRef` exists only on the `AVAILABLE` variant. A single optional field would
have permitted an observation that says Core holds no process context and then names one, leaving
the meaning to whoever read the code next. AVG-8's query scopes are shaped this way for the same
reason, and a spec asserts the other two variants refuse the reference.

### 4. Offline and injected, and the posture says so

`INJECTED_OFFLINE_CORE_REGISTRATION_PROCESS_CONTEXT` is **stamped** by the builder, never accepted
from a caller: the input schema has no `sourcePosture` field, and the parser re-stamps it on rebuild.
A spec drives `LIVE_CORE_READ`, `CORE_AUTHENTICATED`, `PRODUCTION_VERIFIED` and
`AUTHORITATIVE_LIVE_CORE` and refuses all four, and `processContextSourceAuthenticated: false` says
it again on every brief.

### 5. The AVG-7 plan is RE-DERIVED, and compared STRUCTURALLY

A caller could hand-write a plan that parses, says `REQUEST_CORE_PROCESS_CONTEXT`, and rests on
nothing. So the plan is not believed: AVG-7's own public evaluator is re-run over the supplied
conversation, interpretation and CURRENT Core observation, seeded only with the plan's own reference
and instant, and must reproduce the supplied plan exactly.

Where AVG-9 goes further than ADR-0125 is the comparison itself. AVG-8's `sameSalesTurnPlan`
enumerates AVG-7's top-level fields by hand, which means a governed field added to AVG-7 next year
would be compared by nobody and ignored silently — a widening that weakens a safety proof without
touching it. AVG-9 walks the keys of both objects, requires the key SETS to agree in both directions,
recurses into nested records and arrays, and compares leaves with `Object.is`. A new field is
compared the moment it exists.

Re-derivation carries three AVG-7 guarantees across for free: the interpretation must still be a
reading of the CURRENT turn, the causal chain `message ≤ reading ≤ plan` must still hold, and the
CURRENT AVG-1 existing-vendor gate must still admit exactly `NOT_REGISTERED`.

### 6. The CURRENT Core gate runs once, through AVG-7, and its refusal is surfaced rather than flattened

AVG-9 does **not** run `evaluateAcquisitionEligibility` a second time, and that is a deliberate
decision rather than an omission. The observation supplied to AVG-9 is the observation the
re-derivation runs the canonical gate over, and the equality proof means a caller cannot pair a stale
eligible observation with a plan built on a different one. A second copy of the gate would be a
second thing to keep correct and — as ADR-0125 records for AVG-6's duplicated guards — a guard that
masks its own mutation.

What AVG-9 adds is honesty about the outcome. ADR-0125 collapses every re-derivation failure into one
token; here the result carries AVG-7's own refusal, and `CORE_GATE_REFUSED` additionally carries
AVG-1's reason:

| CURRENT Core status                                                  | Result                                |
| -------------------------------------------------------------------- | ------------------------------------- |
| `NOT_REGISTERED`                                                     | the only status that proceeds         |
| `REGISTERED`, `ACTIVE`, `INACTIVE`, `DORMANT`, `FORMER`, `DUPLICATE` | refused, `EXISTING_CORE_RELATIONSHIP` |
| `PREVIOUSLY_CONTACTED`, `DO_NOT_CONTACT`                             | refused, `CORE_SUPPRESSED`            |
| `AMBIGUOUS`, `UNKNOWN`, `CORE_UNAVAILABLE`                           | refused, `CORE_TRUTH_UNRESOLVED`      |

A spec drives all twelve. No score, priority, package choice, identity recommendation or amount of
conversational enthusiasm is an input: there is no field through which one could be supplied, and the
seven accepted input fields are locked from the source.

### 7. The strategy is not enough, because two intents share it

AVG-7 routes both `REGISTRATION_PROCESS` and `PAYMENT_OR_ACTIVATION` to
`REQUEST_CORE_PROCESS_CONTEXT`, because both are questions whose answers are Core's. Checking the
strategy alone would let AVG-10's work walk into AVG-9 through a door the two stages share.

So the **re-derived intent** is checked as well, and a payment-or-activation plan is refused with its
own token. The two refusals are separate because the boundaries are separate: a commercial plan
arriving here is the AVG-8 boundary being crossed; a payment plan is the AVG-10 boundary.

The re-derived values are read rather than the supplied ones. They are proven identical by that
point, and reading the derived value is the honest way to say which is authoritative.

### 8. The context must answer the request, and belong to it

The observation is bound to the prospect **and** to the Core lookup the gate ran under, so the whole
brief rests on one Core moment rather than a mixture. And the causal chain is checked as semantic UTC
instants, never as spellings:

```
latest inbound message.observedAt
  ≤ interpretation.interpretedAt      (AVG-7)
  ≤ plan.plannedAt                    (AVG-7)
  ≤ processContext.observedAt         (AVG-9)
  ≤ brief.preparedAt                  (AVG-9, and again in the brief schema)
```

`09:00:00.500Z` sorts before `09:00:00Z` as a string while being half a second later; a spec builds
exactly that pair and asserts the string comparison would have accepted it. Both boundaries are
tested for equality, for both canonical spellings of one moment, and in both wrong directions.

When Core holds no process context there is no fallback, no default and no guess.

### 9. A closed BRIEF, and no sentence anywhere

Twelve fields, all of them references, instants, one literal outcome and one literal posture. There
is no `explanation`, `summary`, `instructions`, `guidance`, `registrationScript`, `signupScript`,
`pitch`, `salesCopy`, `body`, `message` or `replyText`, and a spec scans every key of a produced
brief for those shapes plus every step, requirement, destination and secret shape.

The roadmap says Aarohi "guides" a prospect into registration. The guiding belongs to a later
governed composition working from Core's own material; what AVG-9 provides is the thing that
composition must be grounded in and the proof it was allowed to exist at all. A prose field here
would be the un-grounded half arriving first — and in a registration conversation the un-grounded
half is a signup process nobody wrote.

### 10. The acquisition case is NOT advanced

`acquisitionCaseMutated: false`. No transition function is called, imported or named; the
containment scan bans `transitionAcquisitionCase`, `openAcquisitionCase`, `REGISTRATION_STARTED`,
`PAYMENT_PENDING`, `HANDED_OFF_TO_ANISHA` and `AWAITING_CORE_ACTIVATION` inside the AVG-9 contract.

The temptation was real and is worth naming: the acquisition-case lifecycle has a
`REGISTRATION_STARTED` state, and a prospect asking how to sign up looks exactly like a registration
starting. It is not. `REGISTRATION_STARTED` would be Aarohi's record of Aarohi's own belief, and
nothing downstream could tell it apart from Core's evidence once written. Only Core can establish
that a registration happened, so this stage records that Core's process context is available and
stops.

### 11. Nothing here is an action

Every one of these is a schema-pinned literal, complete in both directions (every `false` field is
named in the containment list and every listed name is a `false` field):

`registrationProcessInvented`, `registrationConfirmed`, `vendorRecordCreated`, `registrationMutated`,
`marketplaceMutated`, `acquisitionCaseMutated`, `paymentMutated`, `activationMutated`,
`anishaHandoffExecuted`, `processContextSourceAuthenticated`, `modelCallExecuted`, `promptResolved`,
`retrievalExecuted`, `communicationRequestCreated`, `approvalRequestCreated`,
`approvalDecisionCreated`, `communicationAuthorizationCreated`, `executionIntentCreated`,
`n8nExecutionRequested`, `providerSendRequested`, `channelSendRequested`, `sent`, `delivered`,
`productionMutation`, `businessEffect`.

And four pinned `true`: `assistanceContextOnly`, `requiresCoreRegistrationExecution`,
`registrationProcessContextReadyForFutureGovernedAssistance`,
`requiresCoreStatusRevalidationBeforeFutureOutboundUse`.

The first four `false` fields are four different claims and are kept apart deliberately: one invents
a workflow, one announces an outcome, one implies a record exists, and one would be Core's state
actually moving. A domain can commit any one without committing the others, and three of the four
would be committed silently.

### 12. Three reference roles, carried forward from ADR-0124 with one new judgement

Inherited references (`prospectRef`, `salesPlanRef`, `interpretationRef`, `coreLookupRef`) keep the
upstream opaque grammar untouched. A downstream stage may not narrow a grammar it does not own, and a
provider-native identifier is frequently a bare run of digits — a spec carries `919812345678` and
`www.example.com` end to end, from conversation to brief, and asserts they survive.

AVG-9-local references (`briefRef`, `processContextRef`) carry the contact shapes and the digit count.

The new judgement is `coreRegistrationProcessRef`. It NAMES Core material, which makes it look
inherited — but no certified upstream artifact carries it, and a caller invents it into an
AVG-9-local observation. It is therefore **local, and screened**. That is what refuses a signup URL:
the opaque character class already refuses a scheme and a slash, and the contact screen refuses the
bare-host spelling (`www.quickfurno.com`) that would otherwise survive it.

### 13. AVG-9 terminates at the brief

Nothing consumes it. No package or application imports `@qf-jarvis/aarohi-agent`, and a spec asserts
the first consumer will be a deliberate decision. Composition — AVG-7's plan, AVG-8's facts and
AVG-9's context reaching a governed model draft — is a separate slice with its own review.

---

## Mutation findings worth recording

Fifty-seven negative mutations were applied to real source, each followed by the full
`@qf-jarvis/aarohi-agent` suite and a SHA-256-verified byte-identical restore. No `git reset`, no
`git clean`: owner untracked files were never touched. **Fifty-three were caught. Four survived, and
all four are reported rather than hidden.**

**A harness defect came first, and is worth recording because it made the proof look stronger than it
was.** The runner initially invoked `npx.cmd` through `execFileSync`. Node cannot exec a `.cmd`
directly, so the spawn failed before vitest started — and a spawn that never runs throws exactly like
a suite that failed, crediting the first eight mutations with a catch none of them had earned. The
runner now executes `node node_modules/vitest/vitest.mjs`, distinguishes "the suite ran and specs
failed" from "the suite did not run", and reports the second as the stronger failure it is. This is
the same class of finding ADR-0125 records, arrived at from the opposite direction.

**Three survivors were real gaps in the assertions, and are now closed.**

- _The brief schema's own causality refine could be deleted._ The builder checks the same rule and
  returns before the schema ever sees it, so no spec was testing the schema. But
  `parseAarohiRegistrationAssistanceBrief` is a **second public entrance** and a brief arriving
  through it has no builder to stop it. A spec now hand-builds a brief that predates its own
  observation, feeds it to the parser, and asserts both boundary spellings are accepted.
- _The inherited reference grammars could be narrowed to the local screen._ Every fixture used
  dotted identifiers, so nothing noticed. This is precisely ADR-0124's cross-stage incompatibility
  arriving at the next boundary; a spec now carries a numeric and a host-shaped upstream token
  through the whole chain into a brief.
- _The supplied intent could be read instead of the re-derived one._ This one is subtler and is
  discussed below.

**One survivor was a masked mutation and was re-aimed rather than accepted.** Reading
`suppliedPlan.brief.intent` survives on its own, because the equality proof has already made the two
values identical — the mutation removes one of two enforcements of a single property, exactly as
ADR-0123 records for AVG-6's `S` and `T`. Two changes followed: a spec pins that the derived value is
what the source reads and that neither supplied field is read, and a compound mutation degrading
equality **and** substituting the supplied plan is now part of the campaign. It is caught by
twenty-five specs.

**Two survivors are structurally unreachable, and are reported rather than removed.**

- _Plan equality ignoring the nested POSTURE_ cannot be isolated, because AVG-7's posture schema pins
  every field as a `z.literal` and its parser re-stamps one frozen constant. Every plan that parses
  carries the identical posture. This is verified rather than asserted: a spec flips each field,
  deletes each field and adds an unknown one, and shows none parses.
- _Plan equality ignoring the key SETS_ cannot be isolated either, because both operands are produced
  by `parseAarohiSalesTurnPlan` / `evaluateAarohiSalesTurn`, which build from a strict schema and
  therefore emit exactly thirteen keys. A spec pins that key set.

Both are kept, because the day AVG-7 relaxes a literal or adds a field is the day they start
mattering, and a check deleted for being currently redundant is not there on that day. Padding the
count by deleting them would have made the proof look stronger than it is.

**One survivor is inert by construction, and was re-aimed at the enforcement.** Deleting a field from
the posture's TypeScript `interface` changes nothing: types are erased before the suite runs, and the
enforcement is the zod schema plus the frozen constant it parses. `pnpm typecheck` does not catch it
either, because the constant is not a fresh object literal at the assignment. The re-aimed mutation
deletes the field from the **schema**, at which point the constant fails to parse, the module fails
to load, and the suite reports it.

**One survivor was a weak roadmap assertion, and is now closed.** Rewriting the overlay's AVG-9
header from "offline implementation proof defined by ADR-0126" back to "planned and unimplemented"
survived, because the ADR is still named further down the file. Naming an ADR somewhere is not the
same as describing the stage; the spec now requires the header to say what AVG-9 is.

---

## What AVG-9 deliberately does not do

| Left out                                                                  | Owner                                      |
| ------------------------------------------------------------------------- | ------------------------------------------ |
| Performing a registration, or any `public.vendors` write                  | **QuickFurno Core**                        |
| Describing the registration workflow, its steps or its requirements       | **QuickFurno Core**                        |
| Payment, checkout, package order, credits, activation, Anisha handoff     | AVG-10                                     |
| Persistence, dashboards, admin APIs, analytics                            | AVG-11                                     |
| Any increase in autonomy                                                  | AVG-12                                     |
| Model calls, prompt resolution, retrieval, drafting the assistance itself | later composition through QF Model Gateway |
| Live Core reads, provider adapters, n8n routes, sends                     | **QFJ-P09**                                |

Dependencies are unchanged: `zod` alone. No devDependencies, no workspace dependency, no lockfile
change, and no dependency on the QuickFurno marketplace in either direction.

---

## Consequences

Aarohi can now record that a genuinely unregistered prospect asked how to register, that Core still
permits the acquisition path, and that Core holds process context to ground an answer — and still
cannot register anybody, describe registering, or claim that registering happened.

The value is narrow and worth stating plainly. When a governed model composition is eventually built,
it will attach to a domain where a registration step cannot be invented because there is no field to
invent one in, a payment conversation cannot arrive through the strategy it shares with registration,
a stale plan cannot answer a live question, and no brief can exist for a prospect Core has since
registered or suppressed. The model is the part that does not exist. The controls around it are what
this slice is.

**Runtime status is unchanged: PLANNED / DISABLED.** No package or application imports
`@qf-jarvis/aarohi-agent`, and a spec asserts that the first consumer will be a deliberate decision.

**Core owns registration. Aarohi assists and observes. No marketplace mutation occurs from this
side.**
