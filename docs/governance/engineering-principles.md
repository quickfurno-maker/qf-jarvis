# Engineering Principles — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11

These are the rules a pull request is judged against. Each states what to do, and — more usefully — what it forbids.

---

## 1. Contract-first

Agree the contract before writing the code that depends on it. Canonical events, recommendations, approval decisions, execution intents, and execution results are all defined and tested as contracts in Phase 2, before Phase 3 carries them and before Phase 5 produces them ([ADR-0003](../decisions/ADR-0003-event-driven-integration.md)).

**Forbids:** discovering the contract by writing the implementation and seeing what shape falls out. A contract that emerged from an implementation is a description of that implementation, not an agreement between systems.

## 2. Test-first for critical rules

Not everything needs a test first. These do, without exception:

- **Idempotency** — the same event, intent, or submission processed twice has the effect of once.
- **Expiry** — an expired recommendation cannot become an execution intent. An expired intent is refused.
- **Authorization** — an unapproved recommendation cannot execute. There is no timeout-to-approve.
- **Bounds** — n8n executes exactly what an intent describes and nothing beyond it.
- **Signature and replay** — a forged or replayed message is rejected.
- **Money** — anything touching a wallet, package, payment, or ad spend.

Write the test that proves the rule holds, watch it fail, then make it pass. Phase 3's exit criteria require *deliberately redelivering events* to prove idempotency — the test is the deliverable, not a side effect of it.

**Forbids:** "we'll add tests after." For these rules specifically, the test is how you know the rule exists at all.

## 3. Deterministic logic before AI

If a rule reliably decides it, a rule decides it. Deterministic logic runs **first**; the model is invoked only for what remains.

- Rule: the lead has no phone number. Model: the stated budget is implausible for this category in this part of Pune.
- Rule: the wallet is below the assignment threshold. Model: this vendor is about to churn.

**Forbids:** using a model for arithmetic, threshold comparisons, completeness checks, format validation, or lookups — anything with a right answer. Doing so is slower, costlier, non-reproducible, harder to explain, and produces a system whose behavior nobody can predict. See [agent-model.md](../architecture/agent-model.md).

## 4. Explicit boundaries

Module boundaries are real, and they are drawn where a service boundary would go ([ADR-0004](../decisions/ADR-0004-modular-monolith-first.md)). System boundaries are permanent ([system-boundary.md](../architecture/system-boundary.md)).

**Forbids:** reaching across a module's interface into its internals because it is convenient. Building a Jarvis path to n8n, to a provider, or to business state — under any justification, in any branch, even temporarily. There is no such thing as a temporary write path.

## 5. Reversible changes

Every change should be undoable without touching authoritative business state. This is *achievable* here precisely because Jarvis owns no business state: an agent version can be rolled back, a read model rebuilt, a policy switched off — and QuickFurno Core does not notice.

**Forbids:** any change whose rollback plan is "we would have to fix the data." If a change cannot be reversed, it needs a migration plan and an explicit decision, not a deploy ([change-management.md](./change-management.md)).

## 6. Small phases

One phase per branch. A phase is done when its exit criteria are met — not when it is late, and not when the next phase looks more interesting ([phased-roadmap.md](../architecture/phased-roadmap.md)).

**Forbids:** compressing two phases "since we're already in there." The exclusions in each phase are load-bearing: they are what stops a phase from quietly becoming the next three.

## 7. No hidden side effects

A function that says it analyzes a lead analyzes a lead. It does not also write a read model, emit an event, and enqueue a message.

**Forbids:** side effects that are not visible at the call site. In a system whose entire safety argument rests on "a recommendation cannot cause an effect," a hidden effect is not a code-quality issue — it is a boundary violation waiting to be discovered by an auditor.

## 8. Idempotency

Everywhere a message can be redelivered — which is everywhere. Event ingestion, recommendation submission, execution intents, provider calls, result recording.

**Forbids:** assuming exactly-once delivery. It does not exist. Design for at-least-once and make repetition harmless. For money, where repetition cannot be made harmless, ambiguity fails rather than repeats ([execution-governance.md](../architecture/execution-governance.md)).

## 9. Observability

Instrument the things that would tell you the system is failing *before* a human notices: dead-letter rate, retry rate, recommendation latency, acceptance rate, stale rate, audit completeness. Correlation and causation identifiers propagate through every hop.

**Forbids:** logging that cannot reconstruct the chain from event to result — and logging that reconstructs it by recording a phone number. Log identifiers, not people ([privacy-principles.md](./privacy-principles.md)).

## 10. Documented decisions

Every architectural decision is an ADR: status, date, context, decision, alternatives considered, consequences, risks, follow-up. Including the ones that seem obvious, and especially the ones made under time pressure.

**Forbids:** an architectural change that exists only in code. If someone in six months cannot find out *why* the system is shaped this way, the shape will not survive them — and the boundary this whole project rests on is exactly the kind of thing that gets refactored away by someone who never knew why it was there.

---

## The test that matters

Before merging, ask: **could this change let a recommendation cause an effect without an authorization decision recorded in QuickFurno Core?**

If yes, it does not merge, regardless of what it fixes.
