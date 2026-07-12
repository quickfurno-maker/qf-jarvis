# Communication Contract

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-11

Channels, the eighteen authoritative states, and the three contracts that carry a communication from request to result. Authoritative source: [communication-model.md](../architecture/communication-model.md). Decision: [ADR-0014](../decisions/ADR-0014-governed-lifecycle-contracts.md).

---

## Naming a channel is not implementing one

`whatsapp` · `sms` · `email` · `voice`

There is **no WhatsApp client here, no SMS gateway, no SMTP, and no telephony or SIP connection** — and there never will be in this repository. Jarvis holds no provider credential and has no transport.

These are the channels a **governed request** may name. The transport chain sits entirely on the far side of the boundary:

```
n8n → QF Communications Runtime → WhatsApp adapter or QF Voice Runtime
    → external provider → recipient
```

---

## The eighteen states — exactly eighteen, exactly these

| #   | Machine value             | Label                   |
| --- | ------------------------- | ----------------------- |
| 1   | `draft`                   | Draft                   |
| 2   | `authorization-requested` | Authorization requested |
| 3   | `rejected`                | Rejected                |
| 4   | `authorized`              | Authorized              |
| 5   | `scheduled`               | Scheduled               |
| 6   | `execution-submitted`     | Execution submitted     |
| 7   | `provider-accepted`       | Provider accepted       |
| 8   | `delivered`               | Delivered               |
| 9   | `read`                    | Read                    |
| 10  | `answered`                | Answered                |
| 11  | `no-answer`               | No answer               |
| 12  | `busy`                    | Busy                    |
| 13  | `failed`                  | Failed                  |
| 14  | `follow-up-requested`     | Follow-up requested     |
| 15  | `human-handoff-required`  | Human handoff required  |
| 16  | `completed`               | Completed               |
| 17  | `cancelled`               | Cancelled               |
| 18  | `expired`                 | Expired                 |

Machine values are lowercase kebab-case and stable. Display labels are separate, and are **never derived from the machine value at runtime** — deriving one from the other means a display change silently becomes a behavior change.

A test asserts the list is exactly these eighteen, in this order.

### Collapsing any of them is a defect, not a simplification

`execution submitted` is **not** `provider accepted`, and `provider accepted` is **not** `delivered`.

A UI showing one green tick for all three tells a founder a message arrived when it may not have — _"a false statement about the world, which is exactly what this architecture exists to prevent."_

The concrete failure, worth keeping in mind because it is the one that will actually happen:

> The founder clicks **Call vendor**. The interface shows a confident tick. Core actually **refused**, because the vendor is on do-not-contact. The founder now believes a conversation happened. Nothing did — and every subsequent decision rests on a fiction the interface invented.

### The three states Jarvis may never originate

**`authorized`, `delivered`, `completed`.**

Authorization comes from Core. Delivery comes from the provider, is reported through n8n, and **Core records it**. Jarvis _reflects_ all three; it originates none of them. The constant `STATES_JARVIS_MAY_NOT_ORIGINATE` is exported so a future coordination layer can assert this rather than remember it.

---

## Opt-out is a rejection with a reason — not a nineteenth state

There is deliberately **no `opted-out` state**, and adding one would be a mistake.

An opt-out is a **reason Core refused**. So it is represented as:

```jsonc
{
  "state": "rejected",
  "reasonCode": "recipient-opted-out",
  "approvalDecisionId": "…", // the refusal is a decision Core recorded
  "explanation": "QuickFurno Core refused: the recipient is on do-not-contact.",
}
```

Inventing a nineteenth state would **fork the lifecycle**: a consumer could handle `rejected` while quietly ignoring `opted-out` — and that is the one refusal that must never be ignored.

The well-known refusal codes are published as `COMMUNICATION_REJECTION_REASONS`, covering the mandatory controls Core _must_ refuse on, from any originator, **including the founder**: consent withdrawal, opt-out, do-not-contact, unverified identity, quiet hours, expired intent, attempt limits, security concerns, and legal or policy restrictions. They are **not a closed enum** — Core owns the refusal taxonomy, and Phase 2 has not integrated with Core.

---

## `CommunicationStateRecordV1`

| Field                | Required    | Notes                                                       |
| -------------------- | ----------- | ----------------------------------------------------------- |
| `communicationId`    | Yes         | UUID                                                        |
| `contractVersion`    | Yes         | Literal `1`                                                 |
| `channel`            | Yes         | One of the four                                             |
| `state`              | Yes         | One of the eighteen                                         |
| `recordedAt`         | Yes         | RFC 3339 UTC                                                |
| `recipient`          | Yes         | **Opaque Core entity reference**                            |
| `purposeCode`        | Yes         | The approved purpose. Core validates it                     |
| `previousState`      | No          | Evidence of where this came from — **not** a validated edge |
| `approvalDecisionId` | Conditional | See below                                                   |
| `executionIntentId`  | Conditional | See below                                                   |
| `executionResultId`  | Conditional | See below                                                   |
| `reasonCode`         | Yes         | Why this state was recorded                                 |
| `explanation`        | No          | Bounded human text                                          |
| `correlationId`      | Yes         | UUID                                                        |

### The recipient is a reference, never a person

`recipient` is an opaque Core entity reference. The entity-id character set excludes `@` and `+`, so an **email address** and an **E.164 phone number** will not parse.

This is what degrades prompt injection from _"make the system call me"_ to _"make the system suggest something odd to a human who can see the evidence"_. A request naming an attacker's number is **refused rather than dialled** — because there is nowhere to put a number ([security-principles.md](../governance/security-principles.md)).

**Stated honestly: the regex is a guardrail, not the control.** A purely numeric string is accepted, because Core owns its identifier scheme and may legitimately use numeric ids — assuming otherwise would invent a fact about a system Phase 2 has not integrated with. The real control is that this is a **reference**: Core resolves the actual contact from its own records, against consent it owns, at execution time. A reference that resolves to nothing is refused by Core; it is not dialled.

### There are no consent booleans

You will not find `hasConsent`, `optedIn`, or `withinQuietHours`. There is no field to put them in, and a strict schema rejects them.

Copying Core's consent state into a contract would turn a **courtesy check** into an **apparent permission** — and a stale copy of a permission is the most dangerous field in any system that reaches real people. Jarvis's derived view of consent _"is a courtesy check, never a permission — and never authoritative in either direction."_ **Core enforces, and the runtime re-validates at execution time.**

### A state becomes authoritative only when Core has the record to prove it

| State                                                          | Requires                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `rejected`, `authorized`, `scheduled`                          | `approvalDecisionId` — these exist only because Core decided                       |
| `execution-submitted`, `provider-accepted`                     | `executionIntentId` — Core dispatched it                                           |
| `delivered`, `read`, `answered`, `no-answer`, `busy`, `failed` | `executionResultId` — **no provider state is authoritative until Core records it** |

Requiring the result id is how `delivered` stops being something a hopeful UI can simply assert.

**A draft is not a message. A script is not a call.** Neither is authorization, and neither sends anything.

### Transitions are policy, not schema

The approved model includes a state diagram. This contract does not encode it as a matrix, for the same reason as the recommendation lifecycle: a single record is a **point-in-time fact**, and transition validity is a **stateful** question about history.

`previousState` is carried as optional **evidence**, not as a validated edge. **Transition enforcement is the coordination layer's job in a later phase** — said plainly so nobody assumes this schema already did it.

---

## Three contracts, three authorities

A governed communication passes through three artifacts, and each one is produced by exactly the party entitled to make that claim:

| Contract                       | Produced by                       | Says                                                    |
| ------------------------------ | --------------------------------- | ------------------------------------------------------- |
| `CommunicationRequestV1`       | QF Jarvis                         | _I am asking for this to be sent_                       |
| `CommunicationAuthorizationV1` | **QuickFurno Communication Core** | _Eligibility checked — authorized, or refused, and why_ |
| `CommunicationResultV1`        | **QuickFurno Core**               | _This is what actually happened to it_                  |

### A founder's approval does not override an opt-out

This is the sentence the split exists to make enforceable, so it is stated plainly:

> **A communication needs BOTH a human approval AND Core's eligibility check. Neither substitutes for the other.**

`ApprovalDecisionV1` records that a human or a named policy **approved an action**. `CommunicationAuthorizationV1` records that the Communication Core **validated the recipient's eligibility** — consent evidence, preferences, suppressions, STOP/START state, do-not-contact status, approved purpose, attempt limits, quiet hours.

They are different questions. A founder can approve a message to a client who has opted out, and **the message must still not be sent**. Merging the two contracts into a single "approved" would make that unenforceable, because there would be only one flag to check — and it would be the wrong one.

---

## `CommunicationRequestV1`

**Produced by:** QF Jarvis.
**Authoritative:** **No.** It asks. It does not authorize, and it does not send.
**Consumed by:** QuickFurno Core, which answers it with a `CommunicationAuthorizationV1` — or does not answer it at all.

**This object cannot reach a person.** It names no phone number, no email address, no provider, and no destination of any kind.

### Fields

| Field                                       | Required | Notes                                                                 |
| ------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `communicationRequestId`, `communicationId` | Yes      | UUIDs. The second is the governed communication this request opens    |
| `contractVersion`                           | Yes      | Literal `1`                                                           |
| `producingSystem`                           | Yes      | Literal `qf-jarvis`                                                   |
| `requestingAgent`, `requestingAgentVersion` | Yes      | Attributable to a specific agent build                                |
| `recipient`                                 | Yes      | **Opaque Core entity reference.** Never a number, never an address    |
| `purposeCode`                               | Yes      | The approved purpose. Core validates it against policy                |
| `proposedChannel`                           | Yes      | **Proposed**, not chosen. Core may refuse the channel, or the request |
| `content`                                   | Yes      | A **reference** to an approved template or script, and its version    |
| `requestedTiming`                           | Yes      | `immediate` · `scheduled` · `window`. A request, never a schedule     |
| `createdAt`, `expiresAt`                    | **Yes**  | Expiry is mandatory and strictly after `createdAt`                    |
| `priority`                                  | Yes      | Business impact and time sensitivity                                  |
| `requiredApproval`                          | Yes      | **Never `none`**                                                      |
| `policy`                                    | Yes      | The policy Jarvis observed. A citation, never an authority            |
| `summary`                                   | Yes      | Bounded human text                                                    |
| `correlationId`, `causationEventId`         | Yes / No | The thread back to the source event                                   |

### The three things it deliberately cannot say

**1. _"This is allowed."_** There is **no consent field**. No `hasConsent`, no `optedIn`, no `withinQuietHours`, no `suppressed` — and the strict schema means none can be added.

Copying Core's consent state into a Jarvis contract turns a **courtesy check** into an **apparent permission**, and _a stale copy of a permission is the most dangerous field in any system that reaches real people_. The concrete failure: a communication is scheduled for Thursday, the recipient withdraws consent on Wednesday, and the snapshot taken on Tuesday still says yes. **Unknown or stale consent is not permission.** The Communication Core decides, and the runtime re-validates at execution time.

**2. _"This was sent."_** There is **no delivery claim** — no status, no `delivered`, no `sentAt`. A request is not a delivery. What happened is a `CommunicationResultV1`, recorded by Core.

**3. _"Send it to this number."_** There is **no destination**. `recipient` is an opaque Core entity reference, and the entity-id character set excludes `@` and `+`, so an email address and an E.164 number **will not parse**. This is what degrades prompt injection from _"make the system call me"_ to _"make the system suggest something odd to a human who can see the evidence"_ ([security-principles.md](../governance/security-principles.md)).

### Content is a reference, never a body

`content` names an **approved template or script and its version**. There is **no message body field**.

A free-text body is where a compromised agent — or a careless one — writes something nobody approved, and where personal data arrives by accident. Both are versioned, because _"the template allowed it"_ is not an audit record if nobody can say **which template, as it stood when**.

The obvious escape hatch is closed too. `variables` is a **governed container**: the always-forbidden set (credentials, contact details, raw provider content, model internals) applies and cannot be opted out of, and it additionally refuses `body`, `message`, `text`, `content`, and `script` — because **a message body smuggled in as a variable is still a message body**. Contact-shaped _values_ are refused as well, so a recipient's name is Core's to substitute, not Jarvis's to supply.

The template registry lives in the QF Communications Runtime, on the far side of the boundary. Phase 2 carries the reference; Phase 10 tests the runtime that resolves it; **Phase 11A is the first time one is ever resolved for a real person** ([ADR-0017](../decisions/ADR-0017-live-communication-sequencing.md)).

### What the schema enforces

| Rule                                                                       | Why                                                                                                                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expiresAt` is mandatory, strictly after `createdAt`                       | An unanswered request expires. It is never sent late, and never auto-approved                                                                                   |
| `requiredApproval` is **never** `none`                                     | A communication reaches a real person. There is no such thing as one needing no approval                                                                        |
| `voice` requires `stronger-approval` or `founder`                          | _"Production outbound voice requires explicit human approval on every call."_ Not a delegated approver, and never a policy acting alone                         |
| `voice` must reference a **script**, not a template                        | A call is spoken from a script; a message is rendered from a template. Crossing them means the thing that reaches the person is not the thing that was reviewed |
| Any other channel must reference a **template**                            | Same reason, in the other direction                                                                                                                             |
| A `scheduled` time must fall strictly before `expiresAt`                   | A request that asks to be sent after it has expired asks for nothing                                                                                            |
| A `window` must open before `expiresAt`, and `notBefore` before `notAfter` | A window that never opens is not a window                                                                                                                       |

---

## `CommunicationAuthorizationV1`

**Produced by:** the **QuickFurno Communication Core**. `issuer` is the literal `quickfurno-core`.
**Authoritative:** **Yes.** Only this can authorize a communication.
**Consumed by:** Jarvis, which reflects it — and n8n, in a later phase, which cannot act without it.

This is the artifact that makes _"Core is the consent authority"_ mean something operationally rather than rhetorically. The request asks; **this answers**.

### Fields

| Field                                       | Required    | Notes                                                            |
| ------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `communicationId`, `communicationRequestId` | Yes         | The request this answers                                         |
| `contractVersion`                           | Yes         | Literal `1`                                                      |
| `issuer`                                    | Yes         | Literal `quickfurno-core`                                        |
| `outcome`                                   | Yes         | `authorized` · `rejected`                                        |
| `authorizedChannel`                         | Conditional | **Required** when authorized. **Forbidden** when rejected        |
| `approvalDecisionId`                        | Conditional | **Required** when authorized. **Forbidden** when rejected        |
| `decidedAt`                                 | Yes         | RFC 3339 UTC                                                     |
| `reasonCode`                                | Yes         | Why. For a rejection, this is the field that carries the opt-out |
| `explanation`                               | No          | Bounded human text                                               |
| `policy`, `correlationId`                   | Yes         | Which policy, as it stood when — and the thread                  |

**The channel Core authorizes may not be the channel that was proposed.** That is Core's call, and the field exists so the difference is recorded rather than assumed away.

### An authorization must name the approval it rests on

When `outcome` is `authorized`, `approvalDecisionId` is **mandatory**. An authorization that names no approval decision is **Core authorizing a message nobody agreed to send** — and the schema refuses it.

> **Eligibility is not approval. Both are required.**

The mirror rule is enforced too: a **rejected** authorization must **not** name an approval decision, because it did not rest on one. Core refused it — whether or not a human had approved it.

### Refusal reasons are machine-readable, and countable

An opt-out is not a nineteenth state (see above). It is a `rejected` outcome with a structured reason. These are the refusals the architecture **names**, exported as `COMMUNICATION_REFUSAL_REASONS` so a consumer can check for them explicitly rather than pattern-matching on a string it hopes is stable:

| Reason code             | Meaning                                       |
| ----------------------- | --------------------------------------------- |
| `recipient-opted-out`   | The recipient opted out                       |
| `consent-withdrawn`     | Consent existed and was withdrawn             |
| `do-not-contact`        | The recipient is on do-not-contact            |
| `suppressed`            | Core is suppressing this recipient            |
| `stop-received`         | A STOP was received and honoured              |
| `purpose-not-approved`  | The purpose is not one Core permits here      |
| `attempt-limit-reached` | The attempt limit for this recipient is spent |
| `quiet-hours`           | Outside the hours Core permits                |
| `identity-unverified`   | The recipient's identity is not verified      |
| `channel-not-eligible`  | Not this channel, for this recipient          |

**Every one of these is a refusal that must never be silently retried.** The list is not a closed enum — `reasonCode` is open, and Core owns its own refusal taxonomy. These are the ones that must be individually countable.

### There is no `validUntil`, and no consent snapshot

Neither field exists, and their absence is the point.

This record says what Core decided **when it decided**. It is **not a permission slip that travels forward in time**. A scheduled communication whose recipient withdraws consent before the scheduled moment is **not sent** — the runtime re-validates against Core at execution time, and Core's answer _then_ is the one that counts.

**A consent snapshot with a future expiry is precisely the stale permission that lets a withdrawn consent be ignored.** So there is nowhere to put one.

---

## `CommunicationResultV1`

**Reported by:** n8n, or the QF Communications Runtime.
**Recorded by — and authoritative from:** **QuickFurno Core.** `issuer` is the literal `quickfurno-core`.
**Consumed by:** Jarvis, to close the lifecycle and to learn.

Reporting is not authority. n8n and the Runtime _observe_ a provider and _report_; Core **records**, and that recording is what makes it true. _A provider's own view of a delivery is not truth until Core has recorded it_ ([execution-governance.md](../architecture/execution-governance.md) §6).

### Fields

| Field                                                       | Required    | Notes                                                                 |
| ----------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `communicationResultId`                                     | Yes         | UUID                                                                  |
| `contractVersion`                                           | Yes         | Literal `1`                                                           |
| `communicationId`, `executionIntentId`, `executionResultId` | Yes         | The governed communication, and the execution chain behind it         |
| `issuer`                                                    | Yes         | Literal `quickfurno-core`                                             |
| `lifecycleState`                                            | Yes         | One of the eighteen — **never a nineteenth**                          |
| `outcome`                                                   | Yes         | `succeeded` · `failed` · `cancelled` · `expired` · `indeterminate`    |
| `recordedAt`                                                | Yes         | When Core recorded it. **This is the moment it became true**          |
| `providerOccurredAt`                                        | No          | When the provider says it happened, where it says anything            |
| `providerEvidence`                                          | No          | An **opaque provider handle**. Evidence, never content                |
| `failure`                                                   | Conditional | Required on `failed` and on `indeterminate`. Forbidden on `succeeded` |
| `reasonCode`, `correlationId`                               | Yes         | Why, and the thread                                                   |
| `explanation`                                               | No          | Bounded human text                                                    |

A result may only report a state that an execution can actually **reach**. `draft`, `authorization-requested`, `authorized`, and `scheduled` are excluded — they are states a communication passes _through_ before anything is attempted, and a result claiming one of them would be a result for something that never ran.

### Two collapses the schema refuses

**`provider-accepted` can NEVER be recorded as `succeeded`.** The provider taking a message off our hands tells us _the provider has it_. It does not tell us anybody received it. This is the exact defect that shows a founder one confident tick and lets them believe a conversation happened.

**`execution-submitted` can never be `succeeded`** either. The intent was dispatched. Nothing was delivered.

A `succeeded` outcome must name a state in which the thing **actually reached the person**: `delivered`, `read`, `answered`, or `completed`. Those four, and only those four.

### `indeterminate` is not success, and it is not failure

When a call drops mid-dial, or a webhook never arrives, the honest answer to _"did that connect?"_ is **we do not know**.

- Recorded as **failure**, the system retries and **someone's phone rings twice**.
- Recorded as **success**, a founder acts on a conversation that never happened.

So ambiguity is a first-class outcome, and the schema enforces what must follow:

> An `indeterminate` result **must** carry a structured failure classified **`requires-reconciliation`** — not `retryable`, not `not-retryable` — and it **may not report a delivered state**.

_The answer to "did that call connect?" is to go and find out, not to dial and see_ ([execution-governance.md](../architecture/execution-governance.md) §7). **If we do not know, we do not claim it arrived.**

### What it will not carry

**No message body. No transcript. No recording or recording URL. No raw provider payload. No credential.**

`providerEvidence` carries an **opaque handle** — a message id, a call id — which is evidence a human can go and look up, **not content we have copied into our own store**. Transcript and summary processing belongs to the QF Communications Runtime, on the far side of the boundary, and never crosses it ([privacy-and-data-minimization.md](./privacy-and-data-minimization.md), [privacy-principles.md](../governance/privacy-principles.md)).
