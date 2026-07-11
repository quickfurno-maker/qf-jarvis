# Automation Levels — QF Jarvis

**Status:** Phase 0 — in progress (pending review)
**Date:** 2026-07-11

---

> **QF Jarvis starts at Level 0 and advances only through measurable gates.**
>
> A level is not reached by building a capability. It is reached by *earning* it with evidence — and it can be revoked.

---

## The levels

### Level 0 — Observation

**Jarvis watches and measures only.**

Events are ingested, processed, and used to build derived views. Nothing is recommended, because nothing recommends yet. The system proves it can consume the business's event stream reliably, idempotently, and replayably — and it proves it while it is completely incapable of being wrong about anything that matters.

*Reached in Phase 4. Nothing that follows is safe if this is not solid.*

---

### Level 1 — Shadow recommendations

**Jarvis generates recommendations that are not shown to operational users. Results are evaluated.**

Agents run against real events and produce real recommendations. **Nobody sees them.** They are recorded, and later compared against what actually happened: was the lead that Kabir flagged actually bad? Did the vendor Anisha called a churn risk actually churn?

Shadow mode is where an agent's mistakes are free. It is the only chance to be wrong at scale without cost, and it is not skipped because an agent "obviously works."

*Reached in Phases 5–8, one agent at a time.*

---

### Level 2 — Assisted recommendations

**Recommendations are shown to humans. Humans act manually.**

The first level where the system spends someone's attention — which is a real cost, and the reason Level 1's evaluation had to come first. A human reads a recommendation, sees its evidence, and does the work themselves in the real world. Jarvis still causes no effects. It informs a person who does.

*Reached in Phase 9, with the approval layer.*

---

### Level 3 — Approval-controlled execution

**Approved recommendations become execution intents, through policy or human approval.**

The first level where Jarvis's output can reach a real client, vendor, or ad account — and it does so only after an explicit, attributable approval decision recorded in QuickFurno Core, and only via a bounded, expiring execution intent executed by n8n.

**Every execution at this level has a human behind it.** No policy automates anything yet.

*Reached in Phase 10. This is a legitimate permanent resting place — see below.*

---

### Level 4 — Limited policy automation

**Low-risk actions may be automatically authorized by explicit policies.**

One **narrow, low-risk, reversible** recommendation class at a time may be promoted, after passing its evaluation gates, with the business owner's explicit approval. The policy authorizing it is explicit, versioned, and **attributable in the audit trail exactly as a human approver would be**.

**Never money.** Not recharges, not payments, not wallet effects, not package changes, not ad spend ([ADR-0005](../decisions/ADR-0005-human-and-policy-approval.md)).

**Voice is not automated by this ADR, and cannot be automated by extension of it.** See "Where voice sits" below. A **templated, consent-checked, low-risk WhatsApp message** may become a Level 4 candidate — one narrow class at a time, after passing its gates.

Consent, opt-out, do-not-contact, quiet hours, attempt limits, and identity verification remain enforced by QuickFurno Core on **every** communication, automated or not ([communication-model.md](../architecture/communication-model.md)).

Every automated class has an off switch that costs nothing to pull, and a monitored incorrect-action rate that revokes it automatically on breach.

*Reached — if at all — in Phase 15.*

---

### Level 5 — Broad automation

**Reserved for mature, evaluated, highly controlled capabilities.**

**Not planned in the current roadmap.** No design may assume it, no phase delivers it, and reaching it would require a superseding ADR and an explicit decision by the business owner.

It is written down so that nobody has to invent it later under pressure, and so that its absence is a decision rather than an oversight.

---

## The gates

Promotion is not a judgment call. Each gate requires evidence, and the evidence comes from [success-metrics.md](../charter/success-metrics.md).

| Gate | Requires |
| --- | --- |
| **0 → 1** | Event processing is reliable. Idempotency is proven by deliberate redelivery. Read models rebuild from events with identical results. Audit completeness is sound |
| **1 → 2** | Shadow evaluation says this agent's recommendations are accurate often enough to be worth a human's time. If they are not, the agent is fixed or retired — it is **not** promoted anyway |
| **2 → 3** | Recommendation acceptance rate is healthy and approval turnaround is workable. Humans are reading and deciding, not rubber-stamping |
| **3 → 4** | For **one specific, narrow, low-risk class**: high acceptance, **outcome-correlated** (acting on it actually moved a business metric), zero incorrect actions, and full reversibility. Plus the business owner's explicit approval, and a **tested** revocation procedure |
| **4 → 5** | Not planned. Would require a superseding ADR |

**Acceptance alone never opens a gate.** A recommendation class can be accepted 95% of the time and change nothing — humans approving things that do not matter. Gate 3 → 4 requires **outcome correlation**, which is why Phase 14 exists as its own phase rather than as a footnote to Phase 15.

---

## Where voice sits

Outbound voice gets its own statement, because it is the highest-consequence action this system will ever take and because "it's just another channel" is the argument that will eventually be made for automating it.

- **Voice begins at Level 2 or Level 3.** Recommendations and scripts are surfaced to humans; production outbound voice executes under **approval-controlled execution**.
- **Production outbound voice initially requires explicit human approval.** Every call, without exception, traces to a named human decision.
- **Voice is higher risk than asynchronous messaging.** It is synchronous, intrusive, impossible to retract, harder to template, and it drags in transcripts, recording consent, and misdial risk. A WhatsApp message someone ignores costs them a swipe. A call does not offer that option.
- **Future limited-policy automation for voice requires a separate accepted ADR.** It is **not** reachable by extending an existing Level 4 promotion, and not by analogy to an automated messaging class. A new decision, argued on its own terms, or nothing.
- **That future ADR must define**: permitted call purposes · consent requirements · eligible recipients · quiet hours · attempt limits · escalation rules · evaluation thresholds · monitoring · rollback · human handoff. An ADR that omits any of these is not ready.
- **Broad or unrestricted autonomous calling remains prohibited.**

**Possibilities, not approved scope.** If voice automation is ever proposed, these are the *kinds* of call that might plausibly qualify as low-risk. They are recorded here so a future ADR has a starting point — **they are not authorized, not scoped, and not approved by Phase 0**:

- requested callbacks
- appointment reminders
- explicitly opted-in status calls
- vendor onboarding assistance requested by the vendor

Note what they share: in every case **the recipient asked for the call**. That is the property a future ADR would have to argue from, and it is a much narrower door than "low-risk calls."

---

## Revocation

Every automated class can be **switched off**, and switching it off must cost nothing and break nothing. This is achievable precisely because Jarvis owns no business state ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md)) — turning off a policy returns the class to human approval, and QuickFurno Core does not notice.

Revocation is **automatic** on breach of the incorrect-automated-action threshold, and **manual** at any time, by the founder, an administrator with authority, or whoever holds compliance responsibility — without needing to justify it first.

Phase 15's exit criteria require revocation to be **tested**, not merely designed. A revocation procedure that has never been run is a hope.

---

## Level 3 is a legitimate destination

This deserves stating plainly, because roadmaps create gravity and a numbered ladder invites climbing.

**A system that sits permanently at Level 3 — where every action has a human behind it, and where the founder trusts what it tells them — is a success.**

A system at Level 4 whose recommendations the founder has stopped trusting is not, whatever its automation rate says.

The goal is a founder who makes better decisions faster, with evidence. Automation is one possible means to that end, applied where it demonstrably serves it. It is not the point, it is not a scorecard, and it is not owed to anyone.

**When in doubt, do not promote.**
