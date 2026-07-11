# ADR-0002 — Recommend / Authorize / Execute Model

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

[ADR-0001](./ADR-0001-source-of-truth-boundary.md) settles who owns *truth*. This ADR settles who holds *authority* — a separate question, and the one that determines whether an AI system is safe to put near a real business.

QF Jarvis will produce recommendations about real people and real money: message this client, reactivate this vendor, shift this budget. Each recommendation, if acted upon, has an irreversible external effect. A message cannot be unsent. Ad spend cannot be unspent. A vendor's trust, once burned by a bad lead they paid for, does not come back.

The industry default for agentic systems is to let the agent act, and to bolt on guardrails afterwards — confidence thresholds, retry limits, a "human in the loop" that in practice means a human watching a stream of actions already taken. That model fails in a specific way: the guardrails are a property of the *code*, so every guardrail is one bug, one prompt injection, or one deploy away from not existing.

We want a model where the guardrail is a property of the *architecture* — where a compromised agent cannot act, not because it is forbidden to, but because it has no mechanism to.

## Decision

**Jarvis recommends. QuickFurno authorizes. n8n executes. Providers deliver. Results return to QuickFurno Core.**

Concretely:

1. **Agents produce recommendations, and recommendations are inert.** A recommendation is a structured proposal — evidence, rationale, confidence, risk, priority, expiry, required approval. It has no mechanism to cause an effect.
2. **Authorization happens only in QuickFurno Core**, as an explicit, attributable decision by a named human or a named, versioned policy. No agent authorizes anything, including its own output.
3. **Only an approved recommendation may become an execution intent**, and Core creates it — bounded to an exact action, subject, provider, and parameters, and expiring.
4. **Only n8n executes**, after validating authenticity, integrity, freshness, and bounds. n8n has no discretion.
5. **Only providers deliver** the real-world effect.
6. **Results return to QuickFurno Core**, which records them as truth.

And the four edges that make this structural rather than merely intended, from [system-boundary.md](../architecture/system-boundary.md):

- **QF Jarvis → provider does not exist.** No integration, no credential.
- **QF Jarvis → n8n does not exist.** Intents come from Core.
- **QF Jarvis → business state does not exist.** No write path.
- **Agent → approval does not exist.** No self-authorization at any confidence.

**Confidence is not authority.** A recommendation at 0.99 confidence to spend money requires exactly the same authorization as one at 0.6. Confidence informs prioritization and evaluation; it never informs permission. Any design that shortens an approval path because a model was sure has misunderstood this decision.

**There is no timeout-to-approve.** An undecided recommendation expires. Silence is never consent.

## Alternatives considered

**1. Agent executes with guardrails — the industry default.**
The agent calls providers directly, with confidence thresholds, allow-lists, and rate limits in code. Rejected: every guardrail is a code path, and code paths fail. A prompt injection in a lead's free-text field, a bug in a threshold comparison, or a deploy that drops a check, and the agent is messaging clients. The failure is silent and external.

**2. Agent executes, human reviews afterwards.**
Rejected outright for anything client-, vendor-, or money-facing. Post-hoc review of an irreversible action is not review; it is notification.

**3. Human-in-the-loop implemented inside Jarvis.**
Jarvis owns the approval UI **and the approval record**, then executes what was approved. Rejected: this puts the authorization record inside the system being authorized, which means a compromised Jarvis can approve itself. Authorization must live on the other side of a trust boundary from the thing seeking it — which is precisely why approval is recorded in Core and why Core re-validates every submission ([trust-boundaries.md](../architecture/trust-boundaries.md), B3).

Note carefully what this rejects and what it does not. It rejects Jarvis holding the **authority** and the **record**. It does *not* reject Jarvis hosting the **interface** — the button may live where the evidence lives. That distinction is settled in [ADR-0007](./ADR-0007-founder-approval-interface-and-authority.md): the Jarvis Control Plane may be an approval *client*, submitting an approval *request* that Core validates, decides, records, and emits. A click in Jarvis is not an authorization.

**4. Confidence-gated autonomy** — above some threshold, the agent acts.
Rejected, and worth naming explicitly because it is the most seductive option here. Model confidence is not calibrated to business risk. A model can be highly confident and wrong, and it is *most* likely to be confidently wrong exactly when its input has been manipulated. Tying permission to confidence hands the authorization decision to whoever can influence the model's input.

## Consequences

**Positive.**

- **A compromised Jarvis cannot act.** Its worst output is a misleading recommendation shown to a human who can see the evidence and check it against Core's records. This is the single strongest property of the whole architecture.
- Every external effect is attributable to a named human or a named policy. The audit chain has no anonymous links ([auditability-principles.md](../governance/auditability-principles.md)).
- Prompt injection is contained: hostile content in a lead can mislead an agent, but cannot make anything *happen*.
- Automation becomes a deliberate, reversible, evidence-gated promotion rather than an emergent property of a confident model ([automation-levels.md](../governance/automation-levels.md)).
- The system can be trusted with money before it has earned trust with judgment.

**Negative — accepted.**

- Every action costs a human decision, and humans are a bottleneck. Approval fatigue is a real and tracked risk.
- The system is slower than an autonomous one. Some opportunities will be missed while a recommendation waits for approval.
- More moving parts: a recommendation, an approval, an intent, and a result, where an autonomous agent would have had one API call.
- Recommendations expire unactioned, and that wasted work shows up in the stale-recommendation rate.

These costs are accepted. The alternative is an unattributable action reaching a real client or a real ad budget, and no way to explain how.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Approval fatigue** — humans rubber-stamp, and the approval becomes ceremonial | Consolidation, prioritization, and expiry keep volume low. Acceptance rate and stale rate are tracked as adoption canaries ([success-metrics.md](../charter/success-metrics.md)) |
| **Pressure to add a fast lane** for "urgent" actions | If an action is urgent, the answer is a faster human approval, not a bypassed one. There is no exception path and no debug mode ([execution-governance.md](../architecture/execution-governance.md)) |
| **Someone builds a Jarvis → n8n path** for convenience | Boundary violation. Requires a superseding ADR and the business owner's decision |
| **A policy is written so broadly it is autonomy in disguise** | Policies are explicit, versioned, narrow, and attributable. Silent policy change is prohibited ([change-management.md](../governance/change-management.md)) |
| **Prompt injection produces a plausible malicious recommendation** | It cannot execute. Beyond that: evidence must reference real event identifiers, outputs are contract-validated, and approvers see the evidence rather than only the conclusion |

## Follow-up

- [ADR-0005](./ADR-0005-human-and-policy-approval.md) defines how risk determines which approval path applies.
- [ADR-0007](./ADR-0007-founder-approval-interface-and-authority.md) separates the approval *interface* (which may be Jarvis's) from the approval *authority* (which is always Core's).
- [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) keeps agents inside their domains, so that no agent accumulates enough scope to be worth compromising.
- Phase 9 implements the approval layer **before** anything can execute from it — proving the approval path while it is still harmless.
- Phase 10 implements the n8n bridge, and its exit criteria include demonstrating that a **forged** intent and an **expired** intent are both refused.
- Phase 15 may promote a narrow class to policy automation, and may never promote a money-related one.
