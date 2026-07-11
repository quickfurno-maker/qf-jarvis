# ADR-0007 — Founder Approval Interface and Authority

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

[ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) established that QuickFurno Core authorizes and no agent ever does. [ADR-0005](./ADR-0005-human-and-policy-approval.md) established that risk determines which approval path applies. Neither answered a question that Phase 12 cannot avoid: **where does the founder actually click?**

The pull in one direction is obvious and correct. The evidence lives in Jarvis. The prioritized attention item, the rationale, the source events, the cross-domain composite that explains why three signals are one situation — all of it is in the Control Plane. Asking the founder to read the case in Jarvis, then switch to a different system to act on it, is exactly the kind of friction that produces a founder who stops reading the list. Adoption is the project's largest risk ([phased-roadmap.md](../architecture/phased-roadmap.md), Phase 12), and a two-system approval flow attacks it directly.

The pull in the other direction is equally correct, and stronger. ADR-0002's central property is that **a compromised Jarvis cannot act**. If Jarvis both hosts the approval interface *and* records the approval decision, that property is gone: a compromised Jarvis could fabricate a recommendation, record its own approval of it, and present the result as legitimate. The authorization record would sit inside the system seeking authorization — which is the one arrangement ADR-0002 explicitly rejected.

The resolution turns on a distinction that is easy to state and easy to erode: **the approval interface and the approval authority are different things, and they do not have to live in the same system.**

## Decision

**The founder may approve from the future QF Jarvis Control Plane. The Jarvis UI is only an approval client. QuickFurno Core remains the authorization authority and the authoritative decision recorder. Jarvis reflects Core's response. No optimistic or local approval state is allowed.**

The flow, exactly:

1. The founder (or an authorized operator) acts in the **QF Jarvis Control Plane** — approve, reject, or request changes — with the evidence in front of them.
2. **Jarvis submits an approval request to QuickFurno Core.** It approves nothing.
3. **QuickFurno Core validates** — identity, authority, current state, risk policy, expiry, and recommendation eligibility.
4. **QuickFurno Core authorizes or rejects.**
5. **QuickFurno Core records the authoritative approval decision.**
6. **QuickFurno Core emits the resulting canonical decision event.**
7. **Jarvis displays the authoritative result.**

Three rules follow, and they are the operative content of this ADR:

- **A button click inside Jarvis is not authorization.** It is a request for authorization.
- **Jarvis must never locally mark an action as approved before receiving Core's authoritative response.** In flight renders as **pending**. Core's rejection renders as **rejected**. There is no optimistic UI state and no local approved flag.
- **Core may reject a request the founder made** — on stale state, an expired recommendation, insufficient authority for that risk class, or a policy that has changed since the item was surfaced. **A Control Plane that cannot display "the founder clicked approve and Core said no" has been built wrong.**

Jarvis stores the **approval requests it submitted** — a record of what it asked for. It never stores an approval decision of its own authorship; it stores only what Core told it ([data-ownership.md](../architecture/data-ownership.md)).

The operational statement of this flow is [execution-governance.md](../architecture/execution-governance.md) §2a, which is authoritative; other documents cross-reference it rather than restating it.

## Alternatives considered

**1. Approval UI only inside QuickFurno Core.**
The safest-looking option, and the one this ADR most nearly chose. Rejected on adoption grounds: it separates the evidence from the decision. The founder would read the case in Jarvis — the composite recommendation, the three agents' evidence, the rationale — and then switch systems to act on it, where that context is absent. In practice this produces one of two outcomes, both bad: the founder approves in Core without re-reading the evidence (an approval that is ceremonial, which [ADR-0005](./ADR-0005-human-and-policy-approval.md) explicitly warns against), or the founder stops using the attention view at all. Note that this alternative is **not forbidden by the decision** — Core may also expose its own approval surface. What is forbidden is Jarvis *not* being allowed to have one.

**2. Jarvis recording approval independently.**
Jarvis hosts the UI, records the decision, and informs Core. **Rejected, and this is the important rejection.** It destroys the property that makes the whole architecture defensible. Authorization must live on the other side of a trust boundary from the system seeking it — otherwise a compromised Jarvis can approve itself, and every downstream control (bounded intents, n8n validation, the audit trail) is protecting a decision that was never real. It also creates a second source of truth for the single most safety-critical record in the system, in direct violation of [ADR-0001](./ADR-0001-source-of-truth-boundary.md). "Jarvis records it and Core catches up" is a race condition whose losing branch is an unauthorized action against a real client.

**3. Optimistic approval pending Core confirmation.**
Jarvis renders the action as approved the instant the founder clicks, and reconciles if Core later disagrees. Rejected — and it is worth being precise about why, because it is the most likely thing to be built by accident, by a competent frontend engineer following ordinary good practice.

Optimistic UI is correct when the server almost always agrees and the cost of being wrong is a visual correction. **Here, Core disagreeing is not an edge case** — it is a designed, expected, load-bearing outcome. Core validates authority, current state, expiry, and policy precisely *because* those checks are supposed to fail sometimes. An optimistic render tells the founder "this is approved" at the exact moment the system has not decided, and it trains them to stop waiting for the answer. Worse, it makes the local state and the authoritative state disagree for a window — and if anything in Jarvis ever reads that local state, the system now has an approval that no one made. **Rendering an approval that does not exist is not a UI concern; it is a false statement about authority.**

**4. Approval handled only through n8n.**
Approvals routed as workflow tasks — n8n presents them, collects the human's response, and proceeds. **Rejected.** It gives the execution fabric a decision-making role, which is exactly the discretion [execution-governance.md](../architecture/execution-governance.md) denies it. n8n's safety property is that it has **no discretion**: it validates an intent's authenticity, integrity, freshness, and bounds, and executes precisely what the intent says. An n8n that decides *whether* an action should happen is no longer an execution fabric — it is an authorization system that also holds every provider credential in the business. Concentrating the authority to decide and the ability to act in the same component, and giving that component the secrets, is the worst available arrangement of these three properties. It also puts the authorization record outside QuickFurno Core, breaking [ADR-0001](./ADR-0001-source-of-truth-boundary.md).

## Consequences

**Positive.**

- **The evidence and the decision are in the same place.** The founder reads the case and acts on it without switching systems — which is what makes the attention view worth opening.
- **The compromise property from [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) survives intact.** A compromised Jarvis can fabricate a recommendation and can lie to the founder about what happened — but it cannot produce an authorization, because Core validates independently and records the decision itself. The Core-side audit trail contradicts the lie.
- **Core's validation is a real gate, not a formality.** Identity, authority, current state, risk policy, expiry, and eligibility are re-checked against Core's own truth, which may have moved since the item was surfaced.
- **The audit trail has one authoritative decision record**, in one system, attributable to a named human or a named policy ([auditability-principles.md](../governance/auditability-principles.md)).
- **Approval requests are themselves auditable.** What Jarvis asked for, and what Core answered, are both on record.

**Negative — accepted.**

- **The approval round trip is visible to the user.** Clicking approve does not instantly show "approved"; it shows "pending" until Core answers. This is slower than an optimistic UI, and it is the correct behavior.
- **Jarvis must handle rejection of a request the founder just made**, and present it without making the founder feel the system is broken. This is real interaction-design work, and it is Phase 12's problem.
- **Two systems must be available** for an approval to complete. If Core is down, nothing can be approved — which is correct: if the authority is unavailable, there is no authority.
- **Core must expose an authorization interface.** Whether it does today is **unverified**; building it is Phase 11's work, and its absence changes Phase 11's size, not this decision.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Optimistic state creeps in** via ordinary frontend practice — a loading state that renders success early, a cache that holds an approved flag | Prohibited explicitly here and in [system-boundary.md](../architecture/system-boundary.md). A **review blocker** in [change-management.md](../governance/change-management.md). Phase 9 and Phase 12 exit criteria both require demonstrating that an in-flight request renders as pending and a Core rejection renders as rejected |
| **Jarvis caches the decision and drifts** from Core's record | Jarvis stores what Core told it, and Core's decision event is the only source. Reconciliation in Phase 11 has Core winning, always |
| **The UI makes approval easier than rejection**, producing rubber-stamping | [ADR-0005](./ADR-0005-human-and-policy-approval.md)'s approval-fatigue mitigations. Acceptance rate and stale rate are tracked as adoption canaries ([success-metrics.md](../charter/success-metrics.md)) |
| **"Core is slow, let's approve locally and sync"** under delivery pressure | This is alternative 2, arriving disguised as a performance fix. It requires a superseding ADR and the business owner's decision — not a sprint decision |
| **A compromised Jarvis misrepresents Core's answer** to the founder | It can. This is the residual risk, and it is bounded: Jarvis can lie about what happened, but cannot make it happen. Core's authoritative record is what an audit reads, and it will not match the lie. Detection, not prevention, is the correct control here |

## Follow-up

- **Phase 2** defines the **approval request** and **approval decision** contracts, alongside the canonical event contracts.
- **Phase 9** builds the approval-request submission capability and the handling of Core's authoritative response. Its exit criteria include demonstrating that Jarvis holds **no approved state of its own**.
- **Phase 11** establishes Core's authorization interface — validation, decision, authoritative recording, and decision-event emission — together with the compatibility adapters it needs.
- **Phase 12** builds the founder-facing approval interface in the Control Plane, and must demonstrate the pending and rejected renderings, not only the happy path.
- [execution-governance.md](../architecture/execution-governance.md) §2a holds the authoritative operational statement of this flow.
