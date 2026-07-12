# ADR-0014 — Governed Lifecycle Contracts

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

The permanent rule is five sentences:

> Jarvis recommends. QuickFurno authorizes. n8n executes. Providers deliver. Results return to QuickFurno Core.

Phase 0 wrote it down. Phase 1 built a repository that could hold code obeying it. **Phase 2 is where it stops being prose and becomes a type.**

That distinction matters more than it sounds. A rule in a document is enforced by whoever remembers it, at the end of a long week, under a deadline, in a pull request nobody has time to read carefully. A rule in a schema is enforced by the parser — at 3am, on a payload nobody is watching, without getting tired.

The contracts in this ADR are the **authorized-effect chain** the whole architecture runs on. This ADR records how each one encodes its part of the boundary, and which invariants are enforced by the schema versus left to policy.

## Scope — what this ADR governs, and what it does not

This ADR was originally written when Phase 2 held six contracts. **It no longer does.** The package now holds a governed-contract system, and the decisions split cleanly into two families:

| Family                                                                                                                                                                                                                                                                                            | Question it answers                                                      | Governing ADR                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **The authorized-effect chain** — `RecommendationV1`, `RecommendationLifecycleRecordV1`, `ApprovalDecisionV1`, `ExecutionIntentV1`, `ExecutionResultV1`, `CommunicationStateRecordV1`                                                                                                             | _What happened, and who authorized it?_                                  | **This ADR**                                                                       |
| **Requests, communication authority, and control** — `ApprovalRequestV1`, `CommunicationRequestV1`, `CommunicationAuthorizationV1`, `CommunicationResultV1`, `HumanHandoffRequestV1`, `HumanHandoffRecordV1`, `ErasureRequestV1`, `ErasureRecordV1`, `PolicyVersionChangeV1`                      | _What is being asked, what is eligible, and how is the system governed?_ | **[ADR-0018](./ADR-0018-governed-request-communication-and-control-contracts.md)** |
| The complete client journey and vendor reassignment — `AssignmentBatchV1`, `ClientConfirmationV1`, `ClientReassignmentRequestV1`/`DecisionV1`, `AdditionalServiceRequestV1`, `LinkedLeadCreatedV1`                                                                                                | _Who may be offered this lead, and who decided?_                         | **[ADR-0015](./ADR-0015-complete-client-journey-and-reassignment-policy.md)**      |
| Agent memory and learning — `AgentRunRecordV1`, `AgentMemoryRecordV1`, `MemoryInvalidationRequestV1`, `ModelReferenceV1`, `PromptConfigurationReferenceV1`, `HumanCorrectionV1`, `RecommendationEvaluationV1`, `OutcomeFeedbackV1`, `DatasetExampleProvenanceV1`, `TrainingEligibilityDecisionV1` | _What may an agent remember, and what may ever be learned from it?_      | **[ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md)**                 |

**Every contract in the package is governed by exactly one of these four ADRs.** The split is by _decision_, not by file: ADR-0018 exists because _asking is not deciding_ and _eligibility is not authorization_ are genuinely new architectural decisions, not restatements of the ones below — and burying them inside this ADR would have made it a list rather than an argument.

The canonical event registry and versioning rules are [ADR-0013](./ADR-0013-canonical-event-envelope-and-versioning.md); runtime validation is [ADR-0012](./ADR-0012-runtime-contract-validation.md).

## Decision

**The authorized-effect chain, in which the authority boundary is structural rather than documented.**

### The literals that do the work

| Contract             | Literal                                                             | What it makes impossible                                    |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `RecommendationV1`   | `producingSystem: 'qf-jarvis'`                                      | Any other system producing a recommendation                 |
| `ApprovalDecisionV1` | `issuer: 'quickfurno-core'`                                         | Jarvis approving anything                                   |
| `ApprovalDecisionV1` | `decidedBy` is human **or** versioned policy — **no agent variant** | **Agent self-approval has no shape**                        |
| `ExecutionIntentV1`  | `issuer: 'quickfurno-core'`                                         | Jarvis manufacturing authority by manufacturing an artifact |
| `ExecutionIntentV1`  | `executor: 'n8n'`                                                   | The _Jarvis → provider_ edge                                |
| `ExecutionIntentV1`  | `deliverySemantics: 'at-most-once'`                                 | Any other delivery guarantee                                |
| `ExecutionResultV1`  | `reportingSystem` ∈ {n8n, runtime}                                  | Jarvis reporting a result it could not have observed        |
| Canonical envelope   | `source: 'quickfurno-core'`                                         | A non-Core system asserting a fact                          |

**Jarvis cannot construct a valid execution intent.** Not "is not allowed to" — _cannot_. The object does not typecheck and does not parse. That is the difference between a policy and an architecture.

### 1. A recommendation is inert, and has nothing to be otherwise with

No `approved` field, no `sent` field, no recipient address, no credential, no provider handle. And an action's `parameters` are **scanned**, so `{ "approved": true }` cannot be smuggled in as data.

`confidence` exists and is wired to nothing. **A 0.99-confidence recommendation to spend money requires exactly the same authorization as a 0.6-confidence one.** Confidence informs prioritization and evaluation; it never informs permission. Any design that shortens an approval path because a model was sure has misunderstood the system.

**Evidence is mandatory** — at least one item, always. _"'The model thought so' is not evidence."_ And evidence has exactly two shapes, neither of which is a free-text blob: a **canonical-event reference** a reviewer can check against Core's own records, or a **derived signal** with a stable code. There is nowhere for chain-of-thought to live, which is the point.

### 2. Not every recommendation proposes an action — a reconciliation worth recording

A blanket rule of _"every recommendation must propose at least one action"_ is intuitive, and it contradicts the approved architecture.

The lifecycle is explicit that most recommendations never reach a provider: _"It may be **informational** — 'verified lead rate in Pune dropped this week, here is the evidence' — and close as soon as a human has read it."_ And the approval matrix lists `Informational | an attention item with no proposed action | None — nothing executes`.

Forcing an action onto an informational item would make the **most common kind of recommendation unrepresentable**, and would push producers to invent a fake action to satisfy the schema — which is how a contract starts lying.

So the rule is **conditional**, and both halves are enforced:

| `risk`          | `proposedActions` | `requiredApproval`     |
| --------------- | ----------------- | ---------------------- |
| `informational` | must be **empty** | must be `none`         |
| anything else   | **at least one**  | must **not** be `none` |

Plus: **money escalates.** `money-related` requires `stronger-approval` or `founder` — _"never delegated by default."_

The conditional rule is stricter than the blanket one _and_ truer to the architecture.

### 3. Composite recommendations keep their contributors

`composite: true` requires `producingAgent: 'jarvis'` and a non-empty, unique list of **specialist** contributors.

> _"A composite recommendation with no attributable contributors is a Jarvis conclusion wearing a disguise, and it is a defect."_ — [agent-model.md](../architecture/agent-model.md)

Jarvis **owns the connecting, never the concluding**. Attribution keeps evaluation landing on the agent that made the judgment, so a wrong conclusion stays someone's to fix. And the converse is enforced: contributors may not appear on a non-composite recommendation, so _"do not force specialist attribution on a bounded recommendation produced directly by one specialist"_ is honoured without leaving the field ambiguous.

### 4. At-most-once, and the retry keys that are banned because of it

**One execution intent may produce at most one provider call initiation.**

A technical retry re-attempts _the same_ execution under the same idempotency key; **it does not dial again**. A legitimate later attempt — after a no-answer, a busy line, a "call me later" — is a **new decision**: a new recommendation, a new approval, a new intent, with its own consent check, attempt-limit check, expiry, and audit trail.

A system that cannot tell those apart will either **double-dial** (treating a new attempt as a retry) or **never follow up** (treating a retry as a new attempt). Both are wrong, and only one is visible from outside — which is exactly why it is settled in the contract rather than in a retry handler.

Therefore `parameters` **refuses retry-permission keys at any depth**: `retry`, `retries`, `autoRetry`, `maxAttempts`, `retryPolicy`, `redial`, `resend`, and their spelling variants. **A second external effect requires a second decision, not a flag.**

`idempotencyKey` is mandatory, and has a minimum length — because a short key is a colliding key, and a collision here means two different actions are treated as the same one.

### 5. Ambiguity is a first-class outcome

Most result contracts have `success | failure`. **That is a bug**, and it is the expensive kind.

A two-valued outcome forces an ambiguous provider response — a timeout, a connection dropped mid-dial, a webhook that never arrived — to be recorded as one or the other:

- Recorded as **failure**, the system retries, and **someone's phone rings twice**.
- Recorded as **success**, a founder believes a conversation happened that may not have.

So the outcomes are `succeeded` · `failed` · `cancelled` · `expired` · **`indeterminate`**, and the schema enforces what must happen next: an `indeterminate` result **must** carry a failure classified `requires-reconciliation`. Not retryable. Not not-retryable. **Reconciliation.**

> _"The answer to 'did that call connect?' is to find out, not to dial and see."_ — [execution-governance.md](../architecture/execution-governance.md) §7

**An indeterminate outcome cannot be represented as a success**, because the ambiguity has nowhere to hide inside a success-shaped record.

And `retryClassification` is **evidence, not permission**: it describes the failure; it authorizes nothing.

### 6. Communication: eighteen states, an opaque recipient, and no consent booleans

The **eighteen states, exactly and in order**, from the authoritative model. `execution submitted` is not `provider accepted`, and `provider accepted` is not `delivered` — collapsing them tells a founder a message arrived when it may not have.

**Opt-out is not a nineteenth state.** It is `rejected` plus a machine-readable reason. Adding an `opted-out` state would **fork the lifecycle**: a consumer could handle `rejected` while quietly ignoring `opted-out` — and that is the one refusal that must never be ignored.

**The recipient is an opaque Core reference.** There is nowhere to put a phone number, which is what degrades prompt injection from _"make the system call me"_ to _"make the system suggest something odd to a human who can see the evidence."_

**There are no consent booleans.** No `hasConsent`, no `optedIn`, no `withinQuietHours` — and a strict schema refuses them. Copying Core's consent state into a contract would turn a **courtesy check** into an **apparent permission**, and a stale copy of a permission is the most dangerous field in any system that reaches real people. Core enforces; the runtime re-validates at execution time.

**Authority requires a record.** `authorized`, `rejected`, `scheduled` require a Core decision id. `execution-submitted`, `provider-accepted` require an intent id. `delivered`, `read`, `answered`, `no-answer`, `busy`, `failed` require an **execution result id** — because _"no provider state becomes authoritative until Core records it."_ That requirement is how `delivered` stops being something a hopeful UI can simply assert.

### 7. Transitions are policy, not schema — and we say so

Both lifecycles have approved state diagrams, and it would be easy to encode them as transition matrices. **We do not.**

A lifecycle record is a **point-in-time fact**. Validating a _transition_ needs the previous state and the entity's history — a **stateful** question a **stateless** schema cannot answer. Encoding a matrix here would mean either inventing a `previousState` field Phase 0 never asked for, or pretending a stateless validator enforces a stateful rule.

**Transition validity is enforced by the coordination layer, in Phase 4, against stored history.** Written down explicitly, because a reader who believes the schema already enforces transitions **will not build the thing that actually does** — and that is a hole nobody would see by reading the code, since the shapes would still typecheck.

`previousState` is carried on the communication record as optional **evidence**, not as a validated edge.

### 8. Data minimization is structural

Governed containers refuse credentials, contact details, raw transcripts and recordings, full provider payloads, prompts, and chain-of-thought — **by key at any depth, and by value shape**. Evidence references facts rather than duplicating records. Errors name the field and never echo the value.

The scan **fails closed**: it will occasionally refuse a legitimate value that merely looks like a phone number. A wrongly-refused value is a validation error a developer fixes in minutes; a wrongly-accepted phone number is a privacy incident nobody notices.

## Why these contracts cannot execute anything

Stated plainly, because it is the property the entire system rests on:

1. They are **data**. No methods, no side effects, no I/O. Importing the package opens no socket, reads no environment, logs nothing — enforced by lint and asserted by test.
2. **Jarvis cannot construct a valid execution intent.** The issuer literal is Core; the executor literal is n8n.
3. **There is no provider to address.** No credential field, no endpoint, no phone number.
4. **An agent cannot approve.** The actor union has no agent variant.
5. **Authority requires a Core record**, and a Core record is something only Core can produce.

A fully compromised agent emitting a maliciously crafted recommendation has, at most, **proposed** something a human or a policy will then decline. That containment is the single strongest security argument for the whole boundary — and this is the phase where it stops being an argument.

## Alternatives considered

**1. One generic "lifecycle event" contract with a `kind` field and a loose payload.**
Rejected. It is fewer types and no safety: every authority rule collapses into runtime `if` statements nobody can review, and the payload becomes an untyped blob — the exact field where a credential or a phone number ends up. The whole value here is that illegal states are unrepresentable, and a generic envelope makes them all representable again.

**2. Booleans instead of the `indeterminate` outcome** — `succeeded: boolean`.
Rejected. See §5. This is the single most consequential design decision in the ADR, and it is the one most systems get wrong by default.

**3. Copying Core's consent state into the communication contract.**
Rejected, firmly. It would be _convenient_ — Jarvis could render a "cannot contact" badge without a round trip. And it would create a stale copy of a permission, which is precisely how a system ends up calling someone who withdrew consent yesterday. Jarvis's view of consent is a courtesy check, never a permission.

**4. A transition matrix in the schema.**
Rejected. See §7. It would give false confidence: a stateless validator cannot enforce a stateful rule, and believing it does means nobody builds the thing that can.

**5. `requiredApproval` derived automatically from `risk`.**
Rejected. The mapping is _policy_, and policy is Core's — Jarvis may not enforce or bypass it. What the schema enforces is the two invariants that are unambiguously stated in the approved matrix (money escalates; nothing that reaches a person is free), leaving Core to apply the rest. Deriving the whole mapping here would put a policy decision in a library, where changing it is a dependency bump rather than an attributable decision.

**6. Allowing Jarvis to construct a "proposed execution intent".**
Rejected, and it is the most seductive of these. It would be _convenient_ for the control plane to pre-build the intent Core will issue. It would also mean an object that looks exactly like an authorization exists inside Jarvis, and the distance between "proposed intent" and "intent" is one careless field rename. **A proposed action inside a recommendation is already the right artifact**, and it is inert by construction.

## Consequences

**Positive.**

- **The boundary is checked by the parser**, not by a reviewer's memory.
- **Agent self-approval is unrepresentable.** Not forbidden — _unrepresentable_.
- **Double-dialling is a schema error**, not a production incident.
- **Ambiguity has a home**, so nobody has to round it to success or failure.
- **A stale consent copy cannot exist**, because there is no field for it.
- **Evidence is checkable**, which blunts prompt injection: a fabricated justification does not survive the evidence panel.
- **Later phases inherit the rules for free** — Phase 4 cannot route an approval Jarvis wrote, because it cannot exist.

**Negative — accepted.**

- **The contracts are strict, so Core must adapt to them** rather than the reverse. That is the trade [phased-roadmap.md](../architecture/phased-roadmap.md) already made: _"the adapter absorbs the difference; the contract does not bend."_
- **Some invariants remain policy** — transitions, and most of the risk-to-approval mapping. Documented explicitly, so nobody mistakes the schema for the whole guard.
- **The governed scan will produce false positives** on values that look like phone numbers. Accepted deliberately: fail closed.
- **More types, more surface.** The alternative was fewer types and less safety.

## Risks

| Risk                                                                          | Mitigation                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Somebody adds an `agent` actor variant** "for policy automation"            | A policy already _is_ an actor variant, versioned and attributable. An agent variant would be agent self-approval with extra steps. **Review blocker**; tested                                 |
| **A `previousState` field grows into a transition matrix nobody enforces**    | It is documented as evidence, not an edge. Transition enforcement is Phase 4's, and this ADR says so                                                                                           |
| **Retry permission reappears under a name the scan does not know**            | The scan is a defence, not the defence. The real control is `deliverySemantics: at-most-once` and Core issuing a **new intent** for a new attempt. Extend the key list as new spellings appear |
| **Someone "simplifies" `indeterminate` away** because it complicates a switch | It is tested, and the test names the consequence. A green build on a two-valued outcome would mean the system can tell a founder a call connected when nobody knows                            |
| **Consent booleans get added for UI convenience**                             | Rejected here with the reason. **Review blocker**                                                                                                                                              |
| **The informational/actionable rule is misread as "actions optional"**        | Both halves are enforced _and_ tested: informational must propose nothing; everything else must propose something                                                                              |

## Follow-up

- **Phase 3** ingests canonical events idempotently on `eventId`, and proves it by deliberately redelivering them.
- **Phase 4** builds the coordination layer — including **lifecycle transition enforcement**, which this ADR explicitly leaves to it.
- **Phase 9** submits approval requests against `ApprovalDecisionV1` and reflects only what Core returns.
- **Phase 10** validates `ExecutionIntentV1` inside n8n: authenticity, integrity, freshness, bounds. Its exit criteria require proving that a retry does not double-dial and that an ambiguous outcome is reconciled.
- **Phase 11** adds Core's domain event contracts, with adapters absorbing any difference.
- Each phase gate re-reads the authority literals in this package. If any of them has been relaxed, that is a boundary change, and it needs a superseding ADR and the business owner's explicit decision.
