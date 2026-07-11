# ADR-0005 — Human and Policy Approval

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

[ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) establishes that QuickFurno Core authorizes and that no agent ever does. It leaves open a question that has to be answered before Phase 9: **who, exactly, authorizes what?**

The two naive answers both fail.

"The founder approves everything" fails on volume. A system that generates useful recommendations across four domains will generate more than one person can decide on, and the predictable outcome is rubber-stamping — an approval step that exists in the diagram and not in reality. A ceremonial approval is worse than none, because it produces the paperwork of accountability without the substance.

"Anyone on the relevant team approves anything in their domain" fails on risk. Sending a templated follow-up message and shifting an advertising budget are not the same kind of act, even though both are "marketing." One is reversible and cheap; the other spends money that does not come back.

The answer has to be graduated. And the axis it graduates along matters: it must be **risk**, not confidence, not urgency, and not convenience.

## Decision

**Actions require explicit policy or human authorization according to risk.**

### 1. Risk determines the approval path

| Risk class | Examples | Approval required |
| --- | --- | --- |
| **Informational** | A metric summary; an attention item with no proposed action | None — nothing executes |
| **Low risk, reversible** | An internal flag; a task for an operator; a templated message within approved bounds | Delegated team member. The only class eligible for policy automation, and only after Phase 14 evidence |
| **Client- or vendor-facing communication** | Outbound WhatsApp, SMS, email, voice | An authorized human in the relevant team, within approved templates |
| **Money-related** | Recharges, payments, wallet effects, package changes, ad-spend changes | **Stronger approval** — the founder, or an administrator with explicit authority. Never delegated by default. **Never policy-automated** in the current roadmap |
| **High-risk or novel** | Anything not covered by an existing policy; bulk actions; anything affecting many subjects at once | The founder |

### 2. Approval is explicit and attributable

Every approval is a positive act — **approved**, **rejected**, or **changes requested** — recorded in QuickFurno Core and attributable to a named human or a named, versioned policy. No shared approver accounts, ever.

**Where the human clicks is not where the authority lives.** The approver may act from the QF Jarvis Control Plane; that produces an approval **request**, which Core validates — identity, authority, current state, risk policy, expiry, eligibility — before deciding and recording. Core may reject a request the founder made. Jarvis displays the authoritative result and never invents one ([ADR-0007](./ADR-0007-founder-approval-interface-and-authority.md), [execution-governance.md](../architecture/execution-governance.md) §2a).

### 3. Policy is a first-class approver, and it is held to a human standard

A policy may authorize automatically, and when it does it is **attributable in the audit trail exactly as a human approver would be**: which policy, which version, which conditions matched. A policy is not a loophole in the approval requirement; it is a form of it, pre-decided by a human who can be named.

Policies are owned, versioned, and enforced by QuickFurno Core. Jarvis may *propose* a policy change as a recommendation. It may never edit, enforce, or bypass one. **Silent policy change is prohibited** ([change-management.md](../governance/change-management.md)).

### 4. Silence is never consent

There is **no timeout-to-approve**, anywhere, for anything. An undecided recommendation **expires**, and an expired recommendation cannot become an execution intent. This is stated in three documents because it is the rule most likely to be quietly broken by a well-meaning "auto-approve after 24h if low risk" feature.

### 5. Confidence never shortens the path

A 0.99-confidence money-related recommendation requires exactly the same stronger approval as a 0.6-confidence one. Confidence informs prioritization and evaluation; it never informs permission ([ADR-0002](./ADR-0002-recommend-authorize-execute-model.md)).

### 6. Automation is earned, narrowly, and revocably

Policy automation (Automation Level 4) applies to **one narrow, low-risk, reversible class at a time**, after that class has passed its evaluation gates in Phase 14, and only with the business owner's explicit approval. Every automated class has an off switch that costs nothing to pull, and a monitored incorrect-action rate that revokes it automatically on breach ([automation-levels.md](../governance/automation-levels.md)).

## Alternatives considered

**1. Founder approves everything, permanently.**
Rejected on volume. It does not scale past the first useful agent, and it degrades into rubber-stamping — which produces the appearance of accountability while destroying the substance.

**2. Flat delegation — each team approves anything in its domain.**
Rejected on risk. It puts a budget shift and a templated message in the same bucket because they share a department. Risk does not follow the org chart.

**3. Confidence-gated approval** — high-confidence recommendations auto-approve.
Rejected, and named explicitly because it will be proposed again. Model confidence is not calibrated to business risk, and it is *most* likely to be high exactly when the input has been manipulated. This hands authorization to whoever can influence the model's input.

**4. Approval by recommendation *type* rather than by risk.**
Rejected as too coarse. "Send a message" spans a templated nudge and a bespoke communication to a client in a dispute. Risk classification captures the difference; type does not.

**5. Timeout-based auto-approval for low-risk items.**
Rejected. It converts an inattentive human into an approver, and it means the system's most consequential property — that nothing happens without a decision — silently depends on someone reading their notifications.

## Consequences

**Positive.**

- Approval volume is proportionate to risk: cheap things are cheap to approve, expensive things are not.
- Money always has a strong, named approver behind it. There is no path in this system where money moves and nobody is accountable.
- Automation has a defined, evidence-gated, revocable route — rather than arriving as an emergent property of a confident model.
- The audit trail has no anonymous links: every decision names a human or a versioned policy.
- Approval fatigue is treated as a measurable, tracked risk rather than an inevitability.

**Negative — accepted.**

- Risk classification is itself a judgment, and getting it wrong is possible. A misclassified action gets the wrong approval path.
- Delegated limits need maintenance as the team grows.
- Money-related recommendations concentrate on the founder, which is a bottleneck — deliberately.
- Some good recommendations will expire unactioned because nobody decided in time. That waste is visible in the stale-recommendation rate, and it is preferable to auto-approving them.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Approval fatigue → rubber-stamping** | Consolidation, prioritization, and expiry hold volume down. Acceptance rate and stale rate are tracked as adoption canaries ([success-metrics.md](../charter/success-metrics.md)). If humans are approving everything without reading, the system has failed and the metric will say so |
| **A policy written broadly enough to be autonomy in disguise** | Policies are narrow, explicit, versioned, attributable, and approved by the business owner per class. Reviewed at each phase gate |
| **Risk misclassification** — a money-related action classified as low-risk | Money-adjacency is declared by the agent and re-validated by Core. Phase 7's exit criteria require Anisha to correctly declare stronger approval on every money-adjacent recommendation |
| **"Just this once" bypass under time pressure** | There is no exception path and no debug mode. If it is urgent, get a faster human decision, not a bypassed one |
| **Timeout-to-approve is added later as a convenience feature** | Prohibited by this ADR, [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md), and [execution-governance.md](../architecture/execution-governance.md). Adding it requires a superseding ADR |
| **Automated class degrades after promotion** | Continuous monitoring of the incorrect-automated-action rate, with automatic revocation on breach (Phase 15) |

## Follow-up

- Phase 9 implements the approval layer **before** anything can execute from it, so the approval path is proven while it is still harmless. Its exit criteria include demonstrating that an expired recommendation does *not* become approved.
- Phase 10's execution bridge starts with the lowest-risk, most reversible action class, with a human behind every single execution.
- Phase 14 produces the evidence — acceptance, outcome correlation, calibration — on which any automation promotion is decided.
- Phase 15 may promote **one narrow, low-risk, reversible class** to policy automation, must test revocation rather than merely design it, and may never promote a money-related class.
