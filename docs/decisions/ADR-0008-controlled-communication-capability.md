# ADR-0008 — Controlled Communication Capability (Calling and WhatsApp)

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

QF Jarvis was scoped as an intelligence layer that produces recommendations for humans. Two needs push beyond that.

The first is **founder-directed communication**. The founder, reading a consolidated attention item in the Control Plane, wants to act on it — *call this vendor*, *WhatsApp this client a summary* — without leaving the surface that holds the evidence. Forcing a system switch at that moment attacks adoption, which is the project's largest risk ([phased-roadmap.md](../architecture/phased-roadmap.md), Phase 12).

The second is **cross-domain communication that no specialist owns**. Riya owns client lifecycle. Anisha owns vendor lifecycle. Neither owns a callback that requires *both* client and vendor context, an urgent escalation spanning three domains, or a consolidated status update assembled from four agents' findings. Routing such a message to a specialist means one specialist reasoning outside its domain — which [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) forbids for good reason.

But a phone call is not a recommendation. It is an irreversible act against a real person, at a real hour, on a number they may have asked never to be called on. Voice is worse than text: it is synchronous, intrusive, harder to template, and the recipient cannot ignore it as cheaply. Consent law, do-not-contact status, quiet hours, and attempt limits are not soft preferences — they are constraints whose violation damages the business and the person.

So the question is not *may Jarvis talk to people*. It is: **can we add the most consequential action class in the system without weakening the boundary that makes the system safe?**

## Decision

**QF Jarvis has controlled communication coordination and user-facing communication capabilities, but it has no direct provider transport, delivery, or authorization authority.**

Stated as a product capability and as an architecture, both of which are true:

> **Jarvis supports calling and WhatsApp through governed execution.**
> **QuickFurno Core authorizes.**
> **n8n and the communication runtime execute.**
> **Providers deliver.**
> **Results return to QuickFurno Core and are reflected by Jarvis.**

Jarvis **may** expose Call and Send WhatsApp actions in the future Control Plane, receive founder communication instructions, prepare structured call or WhatsApp requests, generate approved scripts or message drafts, request authorization, schedule authorized communication, submit authorized execution intents through the approved architecture, monitor status, display authoritative outcomes, coordinate cross-domain communication, route communication to Riya, Anisha, or a human operator, and request cancellation before execution where still permitted.

Jarvis **must not** directly invoke WhatsApp APIs; directly connect to telephony or SIP providers; store provider credentials; independently authorize communication; bypass consent, opt-out, do-not-contact, quiet-hour, identity, risk, or attempt-limit controls; or claim delivery, call completion, or success before authoritative execution results return.

The flow is the existing flow, with communication as its subject:

> Founder, administrator, or canonical event → Jarvis, Riya, or Anisha prepares a structured communication request → **QuickFurno Core validates recipient identity, consent, opt-out state, communication eligibility, policy, risk, and authorization** → Core creates an authorized execution intent → n8n and the QF Communications Runtime execute → the WhatsApp provider or the shared **QF Voice Runtime** delivers → the result returns through n8n → **QuickFurno Core records the authoritative result** → Jarvis and the relevant specialist reflect the outcome.

### Founder authority is bounded by mandatory controls

**The founder's instruction is an input, not an authorization.** Founder authority may resolve ordinary business prioritization and discretionary approval questions where policy permits. It may **not silently bypass mandatory consent, privacy, security, or legal controls.**

QuickFurno Core **must refuse or block** a communication — from any originator, the founder included — when required by **consent withdrawal, opt-out or do-not-contact status, invalid or unverified recipient identity, prohibited quiet hours, an expired intent, attempt limits, security concerns, or legal or mandatory policy restrictions.** The refusal is recorded, attributable, and shown with its reason.

A control that yields to seniority is not a control. And the person most likely to be in a hurry, and most able to insist, is exactly the person these controls exist to protect from an irreversible mistake.

### Delivery is never claimed, only reflected

**`authorized`, `delivered`, and `completed` are not Jarvis's to originate.** The provider delivers; n8n reports; **QuickFurno Core records the authoritative result**; Jarvis reflects it. A **Call** or **Send WhatsApp** button initiates the governed flow — **the action is not considered delivered or completed merely because the button was clicked** ([communication-model.md](../architecture/communication-model.md)).

### Shared infrastructure, separate agents

The **QF Communications Runtime** — WhatsApp adapter, QF Voice Runtime, consent and policy validation interface, template and script registry, scheduling, retry and idempotency controls, delivery and call status handling, transcript and summary processing, human handoff, structured result reporting — may serve Jarvis, Riya, and Anisha. Each agent nonetheless retains **separate permissions, prompts, policies, communication purposes, recipient eligibility, templates, memory boundaries, evaluation datasets, and escalation rules.**

### One intent, at most one call — and a later attempt is a new decision

**One execution intent may produce at most one provider call initiation.** Technical retries use idempotency and must not create a duplicate call. **Ambiguous provider outcomes are reconciled before another attempt** — on ambiguity, voice fails rather than repeats.

A **no answer**, **busy**, or "call me later" outcome is a *result*, not a retry condition. It may justify a **new recommendation and a new authorized execution intent**, and every new attempt carries **its own identity, policy validation, consent check, attempt-limit check, expiry, and audit trail**. The architecture must distinguish a **duplicate execution** (a defect — one decision, two calls) from a **legitimate later attempt** (a new decision, freshly validated).

The operational statement is [communication-model.md](../architecture/communication-model.md), which is authoritative. This ADR records why.

## Alternatives considered

**1. Jarvis integrates WhatsApp and telephony directly.**
Rejected, and it is not a close call. It would give the intelligence layer provider credentials and a direct path to a person's phone — collapsing the single property that makes this architecture defensible ([ADR-0002](./ADR-0002-recommend-authorize-execute-model.md)): *a compromised Jarvis cannot act*. Agent context contains attacker-influencable content (lead free-text, client messages, vendor profiles). An agent that can be prompt-injected **and** can place calls is an agent that can be made to place calls. The boundary is what makes injection a nuisance rather than an incident.

**2. No Jarvis communication at all — route everything through Riya or Anisha.**
Rejected on two grounds. It has no home for genuinely cross-domain communication: a callback needing both client and vendor context would force Riya to reason about vendors or Anisha about clients, violating [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md). And it has no home for founder-directed action, which would either be impossible or would be smuggled in as a fake Riya recommendation — an attribution lie that corrupts the evaluation data for an agent that did not make the call.

**3. Jarvis absorbs all communication; the specialists stop owning it.**
Rejected. This is coordinator absorption ([ADR-0006](./ADR-0006-agent-responsibility-boundaries.md)) arriving through the channel layer. Client follow-up is Riya's *because she is evaluated on it*; move the message to Jarvis and the evaluation, the ownership, and the least-privilege data boundary all dissolve. Domain routing stands: client lifecycle to Riya, vendor lifecycle to Anisha, lead-quality investigation to Kabir, marketing-originated communication includes Jitin — and Jarvis keeps only what is cross-domain or founder-directed, **recording the routing reason when it does**.

**4. Consent and do-not-contact enforced in Jarvis, before recommending.**
Superficially attractive — why recommend a call to someone who opted out? Rejected as the *authority*. Jarvis's view of consent is a derived read model, and derived views go stale ([ADR-0001](./ADR-0001-source-of-truth-boundary.md)). A recipient may opt out in the seconds between recommendation and execution. If Jarvis's check were the enforcement point, that person gets called. **Core enforces, and the runtime re-validates at execution.** Jarvis *should* still consult its derived view to avoid proposing obviously-forbidden contact — but as courtesy, never as permission. Note this cuts both ways: Jarvis must not treat its own consent view as authoritative in *either* direction.

**5. Approval and delivery status handled inside the QF Communications Runtime.**
Rejected. It repeats the n8n mistake from [ADR-0007](./ADR-0007-founder-approval-interface-and-authority.md): the component that holds every provider credential must not also decide whether to use them. The runtime executes and reports. Core authorizes and records.

## Consequences

**Positive.**

- The founder can act from where the evidence is, and cross-domain communication finally has a legitimate owner.
- **The compromise property survives the highest-stakes capability in the system.** A compromised Jarvis can propose a call. It cannot place one, cannot obtain a phone number's provider credentials, and cannot bypass consent — because Core validates independently and holds the enforcement point.
- Consent, opt-out, do-not-contact, quiet hours, and attempt limits have exactly **one** enforcement authority, so there is exactly one place to get them right.
- Specialist ownership survives: routing is explicit, overrides are recorded, and contributors stay attributable.
- Shared runtime, separate agent identities — one integration to build, four bounded agents using it.

**Negative — accepted.**

- **Latency between intent and effect.** The founder clicks Call and waits for Core. This is slower than a direct dial, and it is correct.
- **The founder's own request can be refused**, which will occasionally be frustrating and will occasionally be the system doing its most important job.
- Communication state is genuinely complex — eighteen states, and `provider accepted` is not `delivered`. A simpler UI would be a lying UI.
- The QF Communications Runtime is significant work, and voice is materially harder than WhatsApp.
- Nine dimensions of per-agent separation must be maintained on shared infrastructure. That discipline has an ongoing cost.

## Risks

| Risk | Mitigation |
| --- | --- |
| **A call reaches someone who opted out** | Core enforces consent, opt-out, do-not-contact, quiet hours, and attempt limits at authorization; **the runtime re-validates at execution**, because state changes between the two. Neither check replaces the other. A scheduled communication does not carry stale authority |
| **A UI claims delivery before authoritative results return** | Prohibited in [communication-model.md](../architecture/communication-model.md), [system-boundary.md](../architecture/system-boundary.md), and [ADR-0007](./ADR-0007-founder-approval-interface-and-authority.md). A **review blocker**. `execution submitted` ≠ `provider accepted` ≠ `delivered`, and the UI must not collapse them |
| **A retry dials a second time**, or a legitimate later attempt is blocked as a duplicate | One intent, at most one call initiation. Ambiguous outcomes are reconciled, not re-dialled. A later attempt is a **new intent** with its own consent and attempt-limit checks. The architecture distinguishes the two explicitly |
| **Prompt injection drives a call to an attacker-chosen number** | The agent cannot dial. Core validates the recipient against **its own contact identity**, not against a number an agent supplied. A request naming an unknown or mismatched recipient is rejected |
| **Shared runtime collapses agent boundaries** — Jarvis inherits every agent's templates, eligibility, and memory | Nine dimensions of separation are mandatory ([communication-model.md](../architecture/communication-model.md)). Shared plumbing must not become a shared identity |
| **Jarvis quietly takes over Riya's and Anisha's communication** | Overriding specialist ownership **without recording the routing reason** is prohibited and auditable. "Convenience" is not a reason |
| **Voice arrives before it is safe** — transcripts, quiet hours, recording consent, and misdial risk are all harder than WhatsApp | Phase 10 delivers the **WhatsApp adapter first**; the QF Voice Runtime follows only after the text path has proven consent enforcement, idempotency, and result recording end to end |
| **Double-send or double-dial on retry** | Idempotency keys on every execution intent. For voice, ambiguity **fails rather than repeats** — a call placed twice is not a cosmetic defect |

## Follow-up

- **Phase 2** adds the **communication request**, **communication result**, and **communication state** contracts, alongside the existing five.
- **Phase 4** adds communication prioritization and scheduling to the coordination layer, and records specialist context contribution and routing reasons.
- **Phase 6 (Riya)** and **Phase 7 (Anisha)** produce communication recommendations in shadow mode — proposed, never sent.
- **Phase 10** delivers the **QF Communications Runtime** through sequenced capability gates: messaging adapter and provider integration → controlled pilot → evaluation → staged rollout → **QF Voice Runtime** → voice pilot, evaluation, and staged rollout. Voice follows only once messaging has proven consent enforcement, at-most-once execution, and authoritative result recording end to end ([phased-roadmap.md](../architecture/phased-roadmap.md)).
- **Voice automation** — if it is ever proposed — requires a **separate accepted ADR** defining permitted call purposes, consent requirements, eligible recipients, quiet hours, attempt limits, escalation rules, evaluation thresholds, monitoring, rollback, and human handoff. It is not reachable by extending a Level 4 messaging promotion ([automation-levels.md](../governance/automation-levels.md)).
- **Phase 11** establishes Core's consent, eligibility, opt-out, quiet-hours, attempt-limit, and communication-history authority, and its authoritative outcome recording.
- **Phase 12** builds the **Call** and **Send WhatsApp** actions in the Control Plane, and must demonstrate the rejected, opted-out, and in-flight renderings — **not only the happy path**.
- **Phase 13** hardens it: no provider credential anywhere near Jarvis, no phone number in a log, no transcript retained beyond its stated purpose.
