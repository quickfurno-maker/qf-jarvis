# Approval and Execution Contracts

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-11

`ApprovalRequestV1` — the contract that asks. `ApprovalDecisionV1`, `ExecutionIntentV1`, `ExecutionResultV1` — the three that carry authority. Decision: [ADR-0014](../decisions/ADR-0014-governed-lifecycle-contracts.md).

---

## Jarvis asks. Core decides.

The path from a proposal to an effect in the world is **five separate contracts**, and the boundary runs between the first two and the last three:

| Contract             | Produced by                           | Says                                          |
| -------------------- | ------------------------------------- | --------------------------------------------- |
| `RecommendationV1`   | QF Jarvis                             | _This is what I think should happen, and why_ |
| `ApprovalRequestV1`  | QF Jarvis                             | _I am asking for the authority to do it_      |
| `ApprovalDecisionV1` | QuickFurno Core                       | _Here is the authority — or the refusal_      |
| `ExecutionIntentV1`  | QuickFurno Core                       | _Do exactly this, once, before this moment_   |
| `ExecutionResultV1`  | Reported by n8n; **recorded by Core** | _This is what actually happened_              |

Everything above the line is Jarvis stating a wish. Everything below it is authority, and Jarvis cannot construct any of it.

**The act of asking needed somewhere to live.** Without a contract for it, the only two shapes in the approval path were a _recommendation_ (Jarvis's) and a _decision_ (Core's) — and a system in that position invariably grows a shortcut: a recommendation with a `submitted` flag, or a decision with a `pending` outcome. Both put a piece of the authorization state inside Jarvis, which is the one place it may never be. So asking is its own contract, and it is deliberately powerless.

---

## `ApprovalRequestV1`

**Produced by:** QF Jarvis.
**Authoritative:** **No.** It is a request, and it has no field in which authority could be expressed.
**Consumed by:** QuickFurno Core — which answers it with an `ApprovalDecisionV1`, or does not answer it at all.

### It has no authority, and none can be added

`producingSystem` is the literal `qf-jarvis`. There is **no `outcome` field, no `decision` field, no `approved` field, no `decidedBy` field, and no `validUntil` field** — and because the shape is a `strictObject`, a caller cannot add one: an unrecognized key is a parse error, not a passthrough.

An approval request that has been granted is **not an approval request with a flag set**. It is an `ApprovalDecisionV1`, issued by Core, which is a different contract with a different issuer.

> **Jarvis may state what it wants, and why. It may never state what it got.**

### Fields

| Field                                       | Required | Notes                                                                                |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `approvalRequestId`, `recommendationId`     | Yes      | UUIDs. The recommendation this asks about                                            |
| `contractVersion`                           | Yes      | Literal `1`                                                                          |
| `proposedActionId`                          | Yes      | Which proposed action — **one**, not the recommendation as a whole                   |
| `actionFingerprint`                         | Yes      | Lowercase hex SHA-256 of the action **as it was worded when proposed**               |
| `requestedAuthority`                        | Yes      | The approval level Jarvis believes this needs. Never `none`                          |
| `risk`                                      | Yes      | The risk class. Never `informational`                                                |
| `createdAt`                                 | Yes      | RFC 3339 UTC                                                                         |
| `expiresAt`                                 | **Yes**  | Mandatory, and strictly after `createdAt`                                            |
| `producingSystem`                           | Yes      | Literal `qf-jarvis`                                                                  |
| `requestingAgent`, `requestingAgentVersion` | Yes      | So a badly-reasoned request is attributable to a **specific agent build**            |
| `summary`                                   | Yes      | What a human reads first. Bounded on purpose — an approver who scrolls stops reading |
| `policy`                                    | Yes      | A `PolicyReference`: `policyId` + mandatory `policyVersion`                          |
| `correlationId`                             | Yes      | UUID                                                                                 |
| `causationEventId`                          | No       | The event that caused the ask                                                        |

### Expiry is mandatory, and expiry is not approval

`expiresAt` is required. A request nobody answers **dies**; it does not ripen.

There is **no timeout-to-approve, and no field in which one could be expressed**. This is worth being blunt about, because the opposite behavior is a common and catastrophic convenience: _a queue that auto-approves what nobody got to is a queue that approves precisely the things nobody understood._ **Silence is never consent** ([execution-governance.md](../architecture/execution-governance.md) §2).

Expiry is validated against `createdAt`, never against the wall clock. Validation reads no clock — a request that was valid when it was made must not become invalid because it was replayed tomorrow ([ADR-0003](../decisions/ADR-0003-event-driven-integration.md)).

### The fingerprint binds the approval to the action the approver actually saw

`actionFingerprint` is a SHA-256 digest of the exact proposed action, as worded when it was proposed. An approval answers **that** action — not whatever `proposedActionId` happens to point at later.

Without it, an action edited after approval is a **silent escalation**: the approver said yes to a follow-up message and the system sends something else, under an approval that still validates. With it, the same edit is a **mismatch** — visible, refusable, and attributable.

**Stated honestly:** the schema checks that the value is _shaped_ like a SHA-256 digest. It does not recompute the hash, because contract validation performs no I/O and has no crypto dependency ([ADR-0012](../decisions/ADR-0012-runtime-contract-validation.md)). The producer computes it; the coordination layer verifies it in a later phase.

### Escalation is enforced in the request, not only in the decision

| Condition                       | The schema requires                                      |
| ------------------------------- | -------------------------------------------------------- |
| `risk` is `money-related`       | `requestedAuthority` is `stronger-approval` or `founder` |
| `risk` is `outbound-voice-call` | `requestedAuthority` is `stronger-approval` or `founder` |
| Any request                     | `requestedAuthority` is **never** `none`                 |
| `risk` is `informational`       | **No approval request may exist at all**                 |

A request that **under-asks** for a money-related action is how an approval quietly reaches a delegated approver who should never have seen it. Enforcing the floor at the moment of asking means the under-ask never gets as far as a queue.

Asking for `none` is not asking for approval. An action that genuinely needs none is informational — it proposes nothing, executes nothing, and does not travel this path.

### The requested authority is a floor, not a ceiling

`requestedAuthority` is what Jarvis _believes_ is needed. Core may decide a **stronger** authority is required. Core may **never** decide a weaker one is. The requested level is the floor; Core enforces its own policy above it ([execution-governance.md](../architecture/execution-governance.md) §9).

`policy` records the policy Jarvis observed when it asked — a **citation, never an authority**. If Jarvis observed policy v3 and Core is now on v4, Core's answer is the one that counts, and the mismatch is _visible_. That visibility is the entire reason to record what was observed.

### What is structurally absent

- **No contact details.** No field for a phone number or an email address. The recipient of anything is Core's to resolve.
- **No credentials.**
- **No execution fields.** No idempotency key, no executor, no delivery semantics, no intent expiry.

**A request cannot be mistaken for an intent, because it cannot carry the things an intent needs in order to act.**

---

## `ApprovalDecisionV1`

**Produced by:** QuickFurno Core.
**Authoritative:** **Yes.** This is the authorization becoming real.
**Consumed by:** Jarvis — which _reflects_ it and never anticipates it.

### It records a decision. It does not make one.

An approval becomes authoritative when **Core records it** — not when Jarvis constructs an object that says so.

Two structural facts do the work, and neither is a rule anyone has to remember:

**1. `issuer` is the literal `quickfurno-core`.** A decision issued by anything else does not parse. Jarvis cannot manufacture authority by manufacturing an artifact.

**2. `decidedBy` is a human _or_ a named, versioned policy — and there is no third variant.**

```ts
| { actorType: 'human';  actor: EntityReference }
| { actorType: 'policy'; policyId: MachineToken; policyVersion: number }
```

**An agent has no representation.** A schema-valid approval decision attributed to Jarvis, Kabir, Riya, Anisha, or Jitin **cannot be constructed** — it fails to parse, and it fails to compile. _"No agent self-approval, at any confidence, in any circumstance"_ stops being a rule and becomes a shape that does not exist.

The policy version is mandatory. _"The policy allowed it"_ is not an audit record if nobody can say **which policy, as it stood when**. A policy that authorizes automatically is attributable exactly as a human approver would be ([security-principles.md](../governance/security-principles.md) §8).

### Fields

| Field                            | Required | Notes                                         |
| -------------------------------- | -------- | --------------------------------------------- |
| `decisionId`, `recommendationId` | Yes      | UUIDs                                         |
| `contractVersion`                | Yes      | Literal `1`                                   |
| `issuer`                         | Yes      | Literal `quickfurno-core`                     |
| `decidedBy`                      | Yes      | Human or versioned policy                     |
| `decidedAt`                      | Yes      | RFC 3339 UTC                                  |
| `outcome`                        | Yes      | `approved` · `rejected` · `changes-requested` |
| `actionDecisions`                | Yes      | Per-action verdicts. Unique action ids        |
| `reasonCode`                     | Yes      | Stable machine code                           |
| `explanation`                    | No       | Bounded human text                            |
| `validUntil`                     | No       | If present, must be after `decidedAt`         |
| `correlationId`                  | Yes      | UUID                                          |

### Partial approval, and the contradiction that cannot be expressed

`actionDecisions` is how partial approval is stated explicitly: approve the follow-up message, reject the discount.

The schema refuses the dangerous middle ground:

- An `approved` outcome must approve **at least one** action — otherwise there is authorization with nothing to execute, an ambiguity Core would have to resolve by guessing.
- A `rejected` or `changes-requested` outcome must approve **no** action. _"Rejected actions cannot be treated as executable."_ A rejected decision that nonetheless carried an approved action is exactly the contradiction a bug — or an attacker — would look for.

### There is no timeout-to-approve

There is no field that could express one. An undecided recommendation **expires**, and expiry is represented by the _absence_ of this record, not by a value inside it. **Silence is never consent.**

---

## `ExecutionIntentV1`

**Produced by:** QuickFurno Core.
**Authoritative:** **Yes** — it is a narrow, expiring authorization to do one specific thing.
**Consumed by:** n8n (Phase 10).

### Jarvis cannot construct a valid one

`issuer` is the literal `quickfurno-core`. `executor` is the literal `n8n`.

There is **no `qf-jarvis` issuer**, and **no provider executor**. The two edges that do not exist — _Jarvis → n8n_ and _Jarvis → provider_ — are absent from the **type**, not merely forbidden by a rule in a document ([system-boundary.md](../architecture/system-boundary.md), "the four edges that do not exist").

### It is not a general permission

| Field                                                        | Why it is mandatory                                                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommendationId`, `approvalDecisionId`, `approvedActionId` | The chain back to a decision. An auditor must be able to prove this intent came from **exactly one** approval, against **exactly one** recommendation, approving **exactly one** action |
| `actionType`, `actionContractVersion`, `parameters`          | The exact action. No interpretation, no expansion                                                                                                                                       |
| `issuedAt`, `expiresAt`                                      | _"An authorization that made sense at 09:00 may be wrong at 17:00"_                                                                                                                     |
| `idempotencyKey`                                             | So a retry cannot double-send or double-charge                                                                                                                                          |
| `deliverySemantics`                                          | Literal `at-most-once`                                                                                                                                                                  |

_"An intent to message one client does not authorize messaging a cohort."_

### At most once — and why retry keys are banned inside `parameters`

`deliverySemantics` has exactly one permitted value. There is nothing to choose between.

**One execution intent may produce at most one provider call initiation.** A technical retry re-attempts _the same_ execution under the same idempotency key; **it does not dial again**. A legitimate later attempt — after a no-answer, a busy line, a "call me later" — is a **new decision**: a new recommendation, a new approval, a new intent, with its own consent check, attempt-limit check, expiry, and audit trail.

A system that cannot tell those apart will either **double-dial** (treating a new attempt as a retry) or **never follow up** (treating a retry as a new attempt). Both are wrong, and only one is visible from outside — which is why it is settled in the contract rather than in a retry handler.

So permission to try again **cannot be smuggled in as a parameter**. `parameters` refuses `retry`, `retries`, `autoRetry`, `maxAttempts`, `retryPolicy`, `redial`, `resend` and their spelling variants, at any depth. **A second external effect requires a second decision, not a flag.**

### What is absent

- **No status, no outcome.** No `sent`, no `delivered`, no `completed`. An intent describes what _may_ happen; what _did_ happen is an execution result. Collapsing the two is how a founder comes to believe a message arrived when it did not.
- **No credential, no phone number, no email address, no webhook secret.** `parameters` refuses all of them structurally.

---

## `ExecutionResultV1`

**Reported by:** n8n, or the QF Communications Runtime.
**Recorded by — and authoritative from:** **QuickFurno Core.**
**Consumed by:** Jarvis, to close the lifecycle and to learn.

### Reporting is not authority

`reportingSystem` may be `n8n` or `qf-communications-runtime`. Those systems _observe_ what a provider did and report it.

The result becomes **truth** when Core records it and emits the canonical event — whose `source` is always `quickfurno-core`. _"A provider's own view of a delivery is not truth until Core has recorded it."_ The payload and the envelope make two different claims, and this package keeps them apart.

`reportingSystem` cannot be `qf-jarvis`. Jarvis executes nothing, so it observes nothing to report.

### `indeterminate` — the field that matters most

Most result contracts have `success | failure`. **That is a bug**, and it is the expensive kind.

A two-valued outcome forces an ambiguous provider response — a timeout, a connection dropped mid-dial, a webhook that never arrived — to be recorded as one or the other:

- Recorded as **failure**, the system retries, and **someone's phone rings twice**.
- Recorded as **success**, a founder believes a conversation happened that may not have.

So ambiguity is a **first-class outcome**:

`succeeded` · `failed` · `cancelled` · `expired` · **`indeterminate`**

And the schema enforces what must happen next:

> An `indeterminate` result **must** carry a structured failure classified `requires-reconciliation`.

Not `retryable`. Not `not-retryable`. **Reconciliation.** The rule from [execution-governance.md](../architecture/execution-governance.md) §7 is enforced rather than hoped for:

> _"An ambiguous provider outcome is reconciled before another attempt is made — the answer to 'did that call connect?' is to find out, not to dial and see."_

**An indeterminate outcome can never be represented as a success**, because they are different enum members and the ambiguity cannot be carried inside a success-shaped record.

### Retryability is evidence, not permission

`retryClassification` says something _about the failure_. It does not authorize a second external effect. A retry re-attempts the same execution under the same idempotency key; a genuinely new attempt requires a **new Core-authorized intent**. Nothing in this contract can grant that.

### What it will not carry

No raw transcripts. No recordings. No complete unredacted provider payloads. No secrets.

`metadata` is bounded and governed and refuses all of them by key and by shape. Transcript and summary processing belongs to the QF Communications Runtime, on the far side of the boundary — it is not part of a generic execution result ([communication-model.md](../architecture/communication-model.md), [privacy-principles.md](../governance/privacy-principles.md)).
