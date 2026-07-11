# Auditability Principles — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11

---

## The claim we must always be able to make

**For any effect the outside world experienced, we can name the person or the policy that authorized it, show the reasoning that led to it, and point at the facts that reasoning was based on.**

Everything below exists to make that sentence true, permanently, without exception.

---

## 1. Each recommendation is traceable to its source events

A recommendation carries the **evidence** it rests on: the specific canonical events, identifiers, and computed signals that produced it — not a summary, not a paraphrase, and not the model's assertion that evidence exists.

- **Evidence is mandatory.** A recommendation without it is a defect, not a hunch ([agent-model.md](../architecture/agent-model.md)).
- **Evidence references real event identifiers** that a reviewer can check against QuickFurno Core's own records. This is what makes a fabricated justification fail on contact with an approver — which matters, because agent context contains attacker-influencable content ([security-principles.md](./security-principles.md)).
- **Events are immutable.** Because [ADR-0003](../decisions/ADR-0003-event-driven-integration.md) chose events over direct database reads, the evidence is a durable fact with an identifier — not a row that has since been updated. You can cite "the budget stated at submission time." From a mutable row, you cannot.

## 2. Each approval is attributable

Every approval decision — approved, rejected, changes requested — names its decider: a **named human** or a **named, versioned policy**.

- **No shared approver accounts.** Ever.
- **No anonymous approvals.** No inferred approvals. No approvals by silence — an undecided recommendation expires, and expiry is not approval ([ADR-0005](../decisions/ADR-0005-human-and-policy-approval.md)).
- **A policy is attributable exactly as a human is**: which policy, which version, which conditions matched. Automation does not dilute accountability — it relocates it to the person who approved the policy.
- Decisions are recorded in **QuickFurno Core**, on the other side of a trust boundary from the system that sought them. A compromised Jarvis cannot forge its own approval ([trust-boundaries.md](../architecture/trust-boundaries.md), B3).

## 3. Each execution is traceable to an intent

Nothing executes without a bounded, expiring, signed execution intent, created by QuickFurno Core from an approval decision Core itself recorded.

- One effect ← one execution result ← one execution intent ← one approval decision ← one recommendation.
- The intent records **exactly what was authorized**: action, subject, provider, channel, parameters, expiry, idempotency key.
- **An execution with no intent behind it is an incident**, not a logging gap. Unauthorized-action count has a target of zero ([success-metrics.md](../charter/success-metrics.md)).

## 4. Each provider result is recorded

- n8n reports the execution result; **QuickFurno Core records it as truth**.
- A provider's own view of a delivery is **not truth** until Core has recorded it.
- Failures are recorded as faithfully as successes. Dead letters are **visible, alertable, and replayable** — a silently dropped execution is the worst failure mode in this architecture, because a human believes an approved action happened and it did not ([execution-governance.md](../architecture/execution-governance.md)).

## 5. The audit trail is immutable

- **Append-only.** Audit records, approval decisions, and execution intents are never modified and never deleted by any actor — human or system.
- Corrections are **new records**, not edits. The history of what we believed and when is part of the audit.
- Immutability is what separates an audit trail from a log.

## 6. Correlation carries across the whole flow

One **correlation identifier** ties everything in a business thread together — source events, recommendation, approval decision, execution intent, execution result, closure. **Causation identifiers** record what directly produced what ([glossary.md](../charter/glossary.md)).

Correlation groups; causation chains. Together they let you walk the flow in either direction, and they do it **using identifiers rather than personal data** — which is precisely how the audit trail stays complete without a phone number ever reaching a log ([privacy-principles.md](./privacy-principles.md)).

---

## The two walks

An auditable system supports both directions. Ours must support both.

### The backward walk — "why did this happen?"

Start from an effect a client or vendor actually experienced:

```
Effect in the world
  ← execution result recorded in QuickFurno Core
    ← execution intent — bounded, expiring, signed
      ← approval decision — attributable to a named human or a named, versioned policy
        ← recommendation — with its rationale
          ← evidence — real, checkable event identifiers
            ← canonical events — immutable facts emitted by QuickFurno Core
```

**Every link must be present.** A missing link is an incident.

### The forward walk — "what came of this?"

Start from anything Jarvis ever recommended, and follow it to its end: approved, rejected, changes requested, or expired — and if approved, what was executed and what the result was.

The forward walk is what makes evaluation possible ([success-metrics.md](../charter/success-metrics.md)), and it is what proves the negative case: **for any recommendation that was not approved, nothing happened.** That should be as provable as the positive case, and it is the claim that lets us put an AI system near a real business at all.

---

## What is deliberately *not* in the audit trail

**Model chain-of-thought.** It is not stored, not logged, and not surfaced.

This is not a gap in auditability — it is a precondition for it. An audit trail built on unreviewed internal model text is not an audit trail; it is a transcript. What we audit is the **rationale** the agent stated as its justification and the **evidence** it cited: reasoning a human can read, challenge, and check against Core's records. That is what we defend to the founder, and it is what we are accountable for.

Storing hidden deliberation would also retain speculative content about real people that we have no defensible purpose for holding ([privacy-principles.md](./privacy-principles.md)).

---

## Audit completeness is a metric, and its target is 100%

Most metrics in [success-metrics.md](../charter/success-metrics.md) are explicitly left as *future calibration items*, to be set from real data. **Audit completeness is not one of them.**

Its target is **100%**, and it is set now, because a system that can explain 97% of what it did to real clients, real vendors, and real money is a system with an unexplained 3%.
