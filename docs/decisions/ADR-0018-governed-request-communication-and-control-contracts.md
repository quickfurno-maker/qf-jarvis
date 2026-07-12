# ADR-0018 — Governed Request, Communication-Authority, and Control Contracts

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

[ADR-0014](./ADR-0014-governed-lifecycle-contracts.md) governs the **authorized-effect chain**: what happened, and who authorized it. Recommendation → approval decision → execution intent → execution result.

That chain has a hole in it, and the hole is the most interesting part of the system: **the act of asking.**

Between _"Jarvis produced a recommendation"_ and _"Core recorded a decision"_, something has to carry the request. When no contract exists for that, systems invariably grow one of two shortcuts — a `submitted: true` flag on the recommendation, or a `pending` outcome on the decision. **Both put a piece of the authorization state inside Jarvis**, which is the one place it may never live. And once the flag exists, the next question is inevitable: _what happens if nobody answers?_ The answer that gets written, under a deadline, is a timeout. And a timeout that approves is an approval nobody made.

There is a second, structurally identical hole on the communication side, and it is worse because it reaches real people.

A founder approves a message to a client. Core's Communication Core knows that client has opted out. **Whose answer wins?** If there is only one "approved" in the system, the question has no home — and the message goes. The only way to make _"a founder's approval does not override an opt-out"_ enforceable is for **approval and eligibility to be two different artifacts, both required.**

Then three more artifacts that had nowhere to live: a **human handoff** (a machine asking for a person is not a person having arrived), an **erasure** (a deletion nobody can prove happened is a deletion that did not), and a **policy version change** (every `policyVersion` recorded across the package resolves against _nothing_ if the change is not a fact).

## Decision

**Nine contracts governing requests, communication authority, and system control. Each one exists because collapsing it into its neighbour would make a false statement possible.**

### 1. Asking is its own contract — `ApprovalRequestV1`

**A request is not a decision, and it is structurally incapable of becoming one.**

- `producingSystem` is the literal `qf-jarvis`.
- There is **no `outcome`, no `approved`, no `decidedBy`, no `validUntil`** — and the object is strict, so none can be added.
- **The requested authority is a floor, not a ceiling.** Core may require _stronger_ approval than was asked for. It may never require weaker.
- Money-related and outbound-voice risk **must** request `stronger-approval` or `founder`. `requestedAuthority` may never be `none`.

An approval request that has been granted is not an approval request with a flag set. It is an `ApprovalDecisionV1`, issued by Core — **a different contract, with a different issuer.**

### 2. Silence and timeout never mean approval

`expiresAt` is **mandatory**. An unanswered request **dies**; it does not ripen.

There is no `approveOnTimeout`, no `autoApproveAfter`, no `defaultOutcome` — and no field in which one could be expressed.

This is worth being blunt about, because the opposite behaviour is a common and catastrophic convenience: **a queue that auto-approves what nobody got to is a queue that approves precisely the things nobody understood.** Silence is never consent (execution-governance.md §2).

### 3. Action fingerprinting binds an approval to the exact action approved

`ApprovalRequestV1.actionFingerprint` is a SHA-256 digest of the proposed action **as it was worded when it was shown to the approver**.

The failure it prevents: a recommendation proposes "send a follow-up message"; a human approves it; the underlying action is then edited — a different template, a wider audience — and the approval, which referenced only an `actionId`, **silently still applies**. The fingerprint makes that a **mismatch** instead of a quiet escalation.

**An approval is for what was actually shown to the approver, not for whatever the identifier now points at.**

The package _carries_ the fingerprint; it does not compute one — it imports no Node built-in and performs no I/O ([ADR-0012](./ADR-0012-runtime-contract-validation.md)). The schema checks that the value is _shaped_ like a digest. Verifying it is the coordination layer's job, in a later phase, and this is stated plainly so nobody assumes the hash has already been checked.

### 4. Eligibility is not authorization — `CommunicationRequestV1` → `CommunicationAuthorizationV1`

Two different questions, and **a communication needs both to be yes**:

| Question                                                                   | Artifact                       | Asked of                              |
| -------------------------------------------------------------------------- | ------------------------------ | ------------------------------------- |
| _May this action be taken?_                                                | `ApprovalDecisionV1`           | A human, or a versioned policy        |
| _Is this recipient eligible to be contacted, for this purpose, right now?_ | `CommunicationAuthorizationV1` | The **QuickFurno Communication Core** |

An `authorized` outcome **must** name the `approvalDecisionId` it rests on. An authorization that names no approval would be Core authorizing a message **nobody agreed to send**.

### 5. Founder approval cannot override an opt-out or a suppression

This is the decision the split exists to make enforceable.

A `rejected` authorization **must not** name an approval decision — precisely so that a refusal cannot be recorded as _"but it was approved"_. Core refused it, **whether or not a human had approved it**.

Refusals carry a machine-readable reason: `recipient-opted-out`, `consent-withdrawn`, `do-not-contact`, `suppressed`, `stop-received`, `purpose-not-approved`, `attempt-limit-reached`, `quiet-hours`, `identity-unverified`, `channel-not-eligible`. **A refusal that cannot be counted cannot be governed.**

There is deliberately **no `validUntil` and no consent snapshot** on an authorization. A snapshot with a future expiry is _exactly_ the stale permission that lets a withdrawn consent be ignored — a scheduled message whose recipient opts out before the scheduled moment **must not be sent**, and that is only possible if the runtime re-asks Core at execution time.

Correspondingly, `CommunicationRequestV1` carries **no consent field at all** — no `hasConsent`, no `optedIn`, no `withinQuietHours`, no `suppressed`. **Unknown or stale consent is not permission**, and **transactional no-objection is not marketing permission.**

### 6. Provider evidence is not authoritative delivery truth — `CommunicationResultV1`

`issuer` is the literal `quickfurno-core`. n8n and the runtime **observe and report**; Core **records**, and the recording is what makes it true.

Two collapses are refused outright:

- **`provider-accepted` can never be `succeeded`.** The provider taking a message off our hands tells us the provider has it. It does not tell us anybody received it. This is the exact defect that shows a founder one confident tick for a conversation that never happened.
- **`indeterminate` is not success, and not failure.** It must be classified `requires-reconciliation`, and it may not report a delivered state. Recorded as failure, the system retries and someone's phone rings twice. Recorded as success, a founder acts on a conversation that did not occur.

`providerEvidence` is an **opaque handle** — a message id a human can look up. Never the message. No transcripts, no recordings, no raw payloads.

### 7. Human handoff is a governed lifecycle artifact

`human-handoff-required` is one of the eighteen communication states, so asking for a person is a **governed transition**, not an out-of-band Slack message.

`HumanHandoffRequestV1` (Jarvis asks) and `HumanHandoffRecordV1` (Core records that a person actually took it) are **separate**, for the same reason `provider-accepted` is not `delivered`: **a UI that renders "somebody is handling it" on the strength of the request is telling the founder somebody is handling it when nobody is.**

Handoff is an **escalation, not a failure metric.** A system that treats it as failure will optimise it away — and the way you optimise away _"a human was needed"_ is by not noticing that a human was needed.

### 8. Erasure propagation is represented explicitly

`ErasureRequestV1` (asked) and `ErasureRecordV1` (what actually got done) — **two contracts, because a request is not a completion.**

Erasure is a distributed operation across stores that fail independently, and the interval between _asked_ and _completed everywhere_ is real, sometimes long, and **legally material**. A shape that cannot represent _in progress_ forces a caller to choose between claiming completion it has not achieved and recording nothing. Both are worse than the truth, so `partial` exists.

**A record with `outcome: 'completed'` and a non-empty `scopesOutstanding` does not parse.** That is the single most dangerous record this system could hold: it **closes a legal obligation while the data is still sitting in an agent's memory.**

`audit-trail` is deliberately **not** an erasable scope. The personal data goes; the fact that a governed action occurred stays.

### 9. Policy-version changes are versioned canonical facts

Half the contracts in the package carry a `PolicyReference` — _"this is the policy I observed when I acted."_ That field is **worthless** unless the other half of the story exists: _when did the policy change, and to what?_

`PolicyVersionChangeV1` is emitted as a canonical event, `issuer` is Core, `changedBy` is a human or a named policy — **never an agent** — and versions must go **forward**. Two rule sets sharing a version number make _"which policy was in force?"_ unanswerable.

**Agents may not rewrite their prompts, policies, or production configuration** ([ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md)). An agent that could raise its own approval threshold would be an agent that could authorize itself, one indirection removed.

## Consequences

**Positive.**

- **Jarvis can ask and cannot answer.** The authorization state has nowhere to live inside Jarvis, because no field exists to hold it.
- **A timeout cannot approve anything**, at any load, under any deadline pressure.
- **An approved action cannot be swapped after approval** without the fingerprint mismatching.
- **A founder's approval cannot reach an opted-out client** — the two gates are two records, and both must say yes.
- **A refusal is provable and countable**, which is what turns "Core enforces consent" from an assertion into an audit.
- **A deletion that half-worked says so.**
- **Every `policyVersion` in the system resolves to a fact.**

**Negative, and accepted.**

- **More contracts.** Asking, authorizing, and reporting are three records where a simpler system would have one. The simpler system is the one that sends a message to somebody who opted out.
- **Two-gate communication is more work for Core**, which must answer eligibility separately from approval. That is the work; there is no cheaper way to make the opt-out rule true.
- **The fingerprint is carried, not verified, in Phase 2.** A later phase must actually check the hash. Stated plainly so it is not assumed done.
- **`partial` erasure records will exist**, and somebody must chase them. An honest backlog beats a dishonest completion.

## Alternatives rejected

**Put a `submitted` flag on the recommendation.** Rejected: it places authorization state inside Jarvis, and it is one field away from a `pending` state and then a timeout.

**Put a `pending` outcome on `ApprovalDecisionV1`.** Rejected for the same reason from the other end — a decision that has not been made is not a decision, and it is represented by the _absence_ of the record.

**A timeout that auto-approves low-risk requests.** Rejected unconditionally. The requests nobody got to are not a random sample of the requests; they are disproportionately the ones nobody understood.

**One `approved` flag covering both human approval and consent eligibility.** Rejected. This is the decision that matters most in this ADR. With one flag, _"a founder's approval does not override an opt-out"_ is unenforceable — there is only one thing to check, and it says yes.

**A consent snapshot on the authorization, with an expiry.** Superficially efficient — it saves a call at execution time. Rejected: it is _precisely_ the stale permission that lets a consent withdrawn at 14:00 be ignored by a message scheduled at 15:00.

**Collapse `provider-accepted` into `delivered`.** Rejected. It is one green tick, and it is a false statement about the world.

**Fold all of this into ADR-0014.** Considered seriously, and rejected. ADR-0014 is an argument about the _authorized-effect chain_. These are decisions about _asking, eligibility, and control_ — and an ADR that argues everything argues nothing. The split is by decision, and each ADR still fits in one reading.
