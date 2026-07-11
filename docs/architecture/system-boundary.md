# System Boundary — QF Jarvis

**Status:** Phase 0 — in progress (pending review)
**Date:** 2026-07-11

---

> **This document is authoritative.**
>
> Where any other document in this repository states or implies an ownership, permission, or prohibition, it is a summary of what is written here. If another document contradicts this one, this one is correct and the other is a defect to be fixed.
>
> The boundary is locked. It may be changed only by a superseding ADR, never by an implementation decision, and never by convenience.

The decision behind this boundary is recorded in [ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md) and [ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md).

---

## The permanent rule

> Jarvis recommends.
> QuickFurno authorizes.
> n8n executes.
> Providers deliver.
> Results return to QuickFurno Core.

---

## QuickFurno Core

### Owns

- Business truth, in full and without exception.
- Operational state and all authoritative lifecycle state.
- **Leads** — creation, verification status, qualification, lifecycle.
- **Clients** — identity, requirements, relationship state.
- **Vendors** — identity, qualification, onboarding state, activation state, service areas, performance.
- **Assignments** — which vendors receive which lead, including enforcement of the business rule that **a qualified lead may be shared with a maximum of three suitable vendors**.
- **Packages** — eligibility, purchase, state, expiry.
- **Wallets** — balances, debits, credits. All of it.
- **Payments** — every money movement.
- **Campaigns** — the authoritative record of campaign and spend state.
- **Communication permission and history** — contact identity, phone number, WhatsApp eligibility, voice-call consent, opt-in and opt-out status, do-not-contact status, communication authorization, approved message or call purpose, attempt limits, quiet hours, communication history, authoritative delivery and call outcomes, and human-handoff state ([communication-model.md](./communication-model.md)).
- **Authorization** — who may do what.
- **Policy** — definition, versioning, and enforcement.
- **Approval decisions** — the record of who approved what, and when.
- **Execution intents** — their creation, bounds, and expiry.
- **Execution results** — as recorded truth.
- **Audit records** — the authoritative audit trail.

### May

- Emit canonical events describing what happened.
- Receive structured recommendations from QF Jarvis.
- Present recommendations to human approvers.
- Apply policy to authorize or reject an action automatically, where an explicit policy permits it.
- Create bounded, expiring execution intents from **approved** recommendations.
- Dispatch authorized execution intents to n8n.
- Record execution results returned by n8n.
- Reject anything, at any time, for any policy reason.

### Must not

- Treat a recommendation as an authorization. A recommendation carries no authority, regardless of its confidence.
- Execute a provider action directly, bypassing n8n as the approved execution fabric.
- Delegate authorization to an agent.
- Accept an execution intent that did not originate from an approval decision it recorded.

---

## QF Jarvis

### Owns

- Its own intelligence artifacts, and nothing of the business:
  - **Recommendations** it produced (as its own working records; the authoritative decision record lives in Core).
  - **Agent runs** — what ran, on what input, at what version, producing what output.
  - **Evaluations** — measured quality of its own recommendations.
  - **Prioritization and attention state** — the founder command view.
  - **Its own derived signals and read models**, understood explicitly as *derived* and never as truth.

### May

- Consume canonical events emitted by QuickFurno Core.
- Maintain derived read models for reasoning, clearly marked as non-authoritative and rebuildable from events.
- Run specialist agents within their named domains.
- Produce structured recommendations carrying evidence, rationale, confidence, risk, priority, expiry, and required approval level.
- Coordinate, deduplicate, consolidate, and prioritize recommendations.
- Produce founder attention items and briefings.
- Submit recommendations into QuickFurno Core's authorization path.
- **Present the founder-facing approval interface** (the future Control Plane) and **submit an approval request** to QuickFurno Core on a human's action — then display the authoritative result Core returns. The interface is an approval **client**; the authority is Core's ([execution-governance.md](./execution-governance.md) §2a, [ADR-0007](../decisions/ADR-0007-founder-approval-interface-and-authority.md)).
- **Support calling and WhatsApp through governed execution.** Jarvis has **controlled communication coordination and user-facing communication capabilities, but no direct provider transport, delivery, or authorization authority.** It may expose Call and Send WhatsApp actions in the future Control Plane, receive founder communication instructions, prepare structured call or WhatsApp requests, generate approved scripts or message drafts, request authorization, schedule authorized communication, submit authorized execution intents through the approved architecture, monitor status, display authoritative outcomes, coordinate cross-domain communication, route to Riya, Anisha, or a human operator, and request cancellation before execution where still permitted ([communication-model.md](./communication-model.md), [ADR-0008](../decisions/ADR-0008-controlled-communication-capability.md)).
- Read approval decisions, execution intents, and execution results in order to learn and to close its own lifecycle.
- Explain any recommendation it has made, on demand, from stored evidence.
- Propose a policy change as a recommendation.

### Must not

- **Be the source of business truth.** Not for leads, clients, vendors, assignments, packages, wallets, payments, or campaigns. Not permanently, not temporarily, not "just as a cache."
- **Directly mutate QuickFurno Core state.** No write path into business records exists or may be built.
- **Directly call communication or advertising providers.** Not WhatsApp, SMS, email, voice, CRM, Google Ads, Meta Ads, or any other provider.
- **Hold provider credentials.** It has none and must never be given any.
- **Call n8n.** Execution intents reach n8n from QuickFurno Core, after authorization.
- **Authorize anything**, including its own recommendations. Hosting the approval **interface** is not holding the approval **authority**: a button click inside Jarvis is a request, not a decision.
- **Locally mark an action as approved** before QuickFurno Core's authoritative response arrives. No optimistic approval state, ever ([ADR-0007](../decisions/ADR-0007-founder-approval-interface-and-authority.md)).
- **Directly invoke WhatsApp APIs, or directly connect to telephony or SIP providers.** No integration, no credential ([ADR-0008](../decisions/ADR-0008-controlled-communication-capability.md)).
- **Store provider credentials.**
- **Independently authorize communication**, including communication the founder asked for. The founder's instruction is an input; Core still validates, and **may refuse it**.
- **Bypass consent, opt-out, do-not-contact, quiet-hour, identity, risk, or attempt-limit controls.** These are enforced by QuickFurno Core. Jarvis's derived view of consent is a courtesy check, never a permission — and never authoritative in either direction.
- **Claim delivery, call completion, or success before authoritative execution results return.** `execution submitted` is not `provider accepted`, and neither is `delivered`. A **Call** or **Send WhatsApp** button initiates the governed flow; **the action is not delivered or completed merely because the button was clicked.**
- **Override Riya's or Anisha's domain ownership without recording the routing reason.**
- **Move money, adjust a wallet, alter a package, or change a payment** — by any path, direct or indirect.
- **Assign a lead to a vendor.** It may reason about matching readiness and vendor suitability, and may explain or flag an outcome. Assignment is Core's, and the maximum-of-three-vendors rule is Core's to enforce.
- **Enforce or bypass policy.** Policy is Core's.
- **Store private model chain-of-thought.**
- **Create authority by creating an artifact.** Producing a recommendation, however urgent, confident, or well-evidenced, changes nothing until Core authorizes it.

---

## n8n

### Owns

- The mechanics of execution: provider integration, transport, retry behavior, and its own workflow definitions.
- Provider credentials.

### May

- Receive authorized execution intents dispatched by QuickFurno Core.
- Validate an intent before acting: authenticity, integrity, bounds, and expiry.
- Execute the action described by a valid, unexpired, authorized intent — and nothing beyond it.
- Integrate with approved providers: WhatsApp, SMS, email, voice, CRM, Google Ads, Meta Ads, and others as approved.
- Retry within an idempotent, bounded retry policy.
- Send failures to dead-letter handling.
- Report execution results back to QuickFurno Core.

### Must not

- Accept an execution intent from QF Jarvis, or from anywhere other than QuickFurno Core's authorized dispatch.
- Execute an expired intent.
- Execute outside the bounds an intent specifies — different recipient, different amount, different provider, broader scope.
- Decide *whether* an action should happen. That decision was made before the intent existed.
- Originate business state or write authoritative state anywhere other than by reporting results to Core.
- Interpret, expand, or "helpfully" adjust an intent.

---

## External providers

### Own

- Delivery of the real-world effect: the message sent, the call placed, the budget changed, the record written.
- Their own delivery status and provider-side records.

### May

- Accept authenticated requests from n8n.
- Return delivery status, callbacks, and webhooks.

### Must not

- Be treated as a source of business truth. A provider's view of a delivery becomes truth only once QuickFurno Core has recorded the execution result.
- Be called by QF Jarvis. Ever.
- Be trusted implicitly on callback. Provider callbacks cross a trust boundary and are verified ([trust-boundaries.md](./trust-boundaries.md)).

---

## Human approvers

### Own

- Authorization judgment, delegated to them by QuickFurno Core's policy.
- Accountability for the decisions they make. Every approval is attributable.

### May

- Approve, reject, or request changes on a recommendation, within their delegated limits.
- Escalate anything, at any time.
- Block an action or an automation promotion on policy, security, or privacy grounds.
- Override or revoke a policy-automated action class.

### Must not

- Approve outside their delegated limits. Money, wallet, package, payment, and ad-spend actions require stronger approval, escalating to the founder or an administrator with explicit authority.
- Have their approval inferred from silence. An unactioned recommendation expires; it does not auto-approve. There is no timeout-to-yes anywhere in this system.
- Be bypassed by an agent, however confident.

---

## Money, specifically

Because money is where boundary erosion does the most damage, it gets its own statement.

| Concern | Owner | Jarvis's maximum involvement |
| --- | --- | --- |
| Wallet balance | QuickFurno Core | Read a derived view; recommend a recharge conversation |
| Wallet debit or credit | QuickFurno Core | None |
| Package eligibility and state | QuickFurno Core | Recommend that a package is worth discussing |
| Package purchase | QuickFurno Core | None |
| Payment | QuickFurno Core | None |
| Ad spend and budget change | QuickFurno Core authorizes; n8n executes at the provider | Recommend a budget shift, with evidence |
| Lead assignment (which consumes vendor value) | QuickFurno Core | Assess matching readiness; explain; flag |

Every money-related action requires stronger approval than a low-risk one, per [execution-governance.md](./execution-governance.md).

---

## The four edges that do not exist

These are worth stating as prohibitions rather than omissions, because each is a shortcut somebody will eventually be tempted to take:

1. **QF Jarvis → provider.** There is no direct integration and no credential.
2. **QF Jarvis → n8n.** There is no dispatch path. Intents come from Core.
3. **QF Jarvis → QuickFurno business state.** There is no write path.
4. **Agent → approval.** No agent authorizes, including Jarvis the coordinator.

Introducing any of these is a boundary violation. It requires a superseding ADR and an explicit decision by the business owner — not a code review comment, and not a sprint deadline.
