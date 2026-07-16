# Change Management — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11

---

## 1. One phase per branch

Branch naming: **`phase-N-short-description`**

Examples: `phase-0-project-charter-architecture`, `phase-3-durable-event-backbone`, `phase-7-anisha-vendor-intelligence`.

A branch delivers **one phase** from [phased-roadmap.md](../architecture/phased-roadmap.md), and it is done when that phase's **exit criteria** are met — not when it is late, and not when the next phase looks more interesting.

**Phases are not compressed.** The explicit exclusions in each phase are load-bearing: they are what stops a phase from quietly becoming the next three. A branch that delivers Phase 5 and "a bit of Phase 6 while we were in there" has delivered neither, because neither was evaluated.

## 2. Pull-request review

Every change reaches `main` through a pull request. No exceptions, including for the business owner.

A reviewer's job is not only to check that the code works. It is to check that the code has not weakened the boundary. The question to ask on every pull request is the one from [engineering-principles.md](./engineering-principles.md):

> **Could this change let a recommendation cause an effect without an authorization decision recorded in QuickFurno Core?**

If yes, it does not merge, regardless of what it fixes.

Specific review blockers, beyond correctness:

- A path from QF Jarvis to n8n, to a provider, or to business state.
- A recommendation that can execute without an approval decision.
- A timeout-to-approve, in any form, under any name.
- An approval path shortened by model confidence.
- **Optimistic or local approval state** — Jarvis rendering or recording an action as approved before QuickFurno Core's authoritative response arrives. This includes the ordinary frontend habit of optimistically rendering success on click ([ADR-0007](../decisions/ADR-0007-founder-approval-interface-and-authority.md)).
- A **composite recommendation with no attributable contributing agents** — a Jarvis conclusion in disguise ([agent-model.md](../architecture/agent-model.md)).
- A **hard-coded retention period**. Retention is configurable policy, and its durations are a future decision ([data-ownership.md](../architecture/data-ownership.md)).
- **Any WhatsApp, telephony, or provider credential inside QF Jarvis**, or any direct call to a communication provider from Jarvis ([ADR-0008](../decisions/ADR-0008-controlled-communication-capability.md)).
- **Jarvis claiming delivery, call completion, or success before authoritative execution results return** — including a UI that collapses `execution submitted`, `provider accepted`, and `delivered` into one "sent" state.
- **A retry that dials again.** One execution intent may produce at most one provider call initiation; a legitimate later attempt is a **new intent**, not a retry ([communication-model.md](../architecture/communication-model.md)).
- **A consent, opt-out, or do-not-contact check treated as authoritative inside Jarvis.** It is a courtesy check. QuickFurno Core enforces.
- **Jarvis keeping a communication that Riya or Anisha would normally own, without recording the routing reason.**
- Chain-of-thought written to a log or a store.
- Personal data in a log line.
- A cross-module import that bypasses an interface ([ADR-0004](../decisions/ADR-0004-modular-monolith-first.md)).
- **An agent importing or calling a model provider directly**, instead of the internal model gateway ([model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md), [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)).
- **An open-ended capability** — arbitrary SQL, arbitrary shell, unrestricted filesystem access, arbitrary URL fetching, generic provider invocation, or unrestricted document retrieval ([governed-knowledge-and-capabilities.md](../architecture/governed-knowledge-and-capabilities.md)).
- **A consumer AI subscription used as a production model backend**, or **raw chat, model output, or business conversation becoming training data automatically** ([ADR-0016](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md)).
- **Chain-of-thought, a raw personal-data prompt, complete raw model output, a secret, a phone number, a message body, or a call transcript written to an AI trace** ([ai-evaluation-observability-and-data-quality.md](../architecture/ai-evaluation-observability-and-data-quality.md)).
- **Governed knowledge treated as business authority** rather than evidence, or approval capability exposed to people without the Phase 8.5 identity controls, or live data placed on infrastructure whose restore drill has not succeeded ([ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)).

## 3. CI before merge — once CI exists

CI arrives in Phase 1. From that point, it runs on every pull request and **blocks merge on failure**. Before Phase 1, review is the only gate, which is one more reason Phase 1 comes early.

A red build is not merged with a follow-up ticket. It is fixed.

## 4. No direct implementation on `main`

`main` is protected. Nothing lands on it except through a reviewed pull request from a phase branch.

## 5. Architecture changes require ADRs

Any change to the shape of the system is an ADR: **status, date, context, decision, alternatives considered, consequences, risks, follow-up**.

This includes — especially includes — changes made under time pressure. An architectural decision that exists only in code is one that will be refactored away by someone who never knew why it was there. The permanent boundary this project rests on is exactly the kind of thing that gets "simplified" by a well-meaning stranger in eighteen months.

**Weakening the system boundary requires a superseding ADR and the business owner's explicit decision.** It is not a code review comment, not a sprint deadline, and not a pragmatic exception. The four edges that do not exist — Jarvis → provider, Jarvis → n8n, Jarvis → business state, agent → approval — do not become negotiable because a delivery date is close ([system-boundary.md](../architecture/system-boundary.md)).

### The ADR lifecycle

```
Proposed  →  Accepted   →  (optionally) Superseded
          →  Rejected
```

| Status | Meaning |
| --- | --- |
| **Proposed** | Written, reviewable, and **not yet decided.** The decision it describes has *not* been made, and nothing may rely on it |
| **Accepted** | The business owner has decided. It is binding |
| **Rejected** | Considered and declined. **The document stays** — a rejected alternative is exactly the thing somebody re-proposes in a year, and the record of why it was declined is the answer |
| **Superseded** | Replaced by a later ADR, which must name it. The original is never deleted and never edited into agreement with its replacement |

**An ADR is `Proposed` until the business owner has actually reviewed it.** Marking an ADR `Accepted` in the same commit that writes it records a decision nobody made — and it is a particularly easy mistake to make, because the author is usually convinced. The status field is not a measure of how confident the author is; it is a record of whether a *decision* happened.

A phase whose ADRs read `Accepted` while the phase itself is "pending review" is a phase making a claim about its own approval that is not true.

**Superseding does not mean editing.** An ADR that is wrong is superseded by a new one that says so. It is not quietly corrected — the history of what we believed, and when, is part of the audit ([auditability-principles.md](./auditability-principles.md)).

## 6. Contract-breaking changes require versioning

Every contract is versioned ([ADR-0003](../decisions/ADR-0003-event-driven-integration.md)) — the canonical event envelope, recommendation, recommendation lifecycle, **approval request**, approval decision, execution intent, execution result, **communication request, authorization, result, and state**, the **assignment, reassignment, and linked-lead** contracts, and the **agent memory and learning** contracts.

- A breaking change is a **new version**, never an edit in place.
- Both versions are supported through a stated migration window.
- An **unknown version is rejected, never guessed at**.
- Contract tests cover both sides of every boundary.

A silent contract change is a data-loss bug with a delayed fuse: it works in staging, and it drops a field in production for three weeks before anyone notices the recommendations got worse.

## 7. Rollback planning

**Every change ships with an answer to "how do we undo this?"** — written down before the merge, not improvised during the incident.

Rollback is achievable here precisely because Jarvis owns no business state ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md)):

- An **agent version** rolls back — recommendations are inert, so nothing needs unwinding.
- A **read model** is destroyed and rebuilt from events.
- A **policy** is switched off, and the class returns to human approval.
- A **deployment** rolls back, and QuickFurno Core does not notice.

**A change whose rollback plan is "we would have to fix the data" is not a change — it is a migration**, and it needs the treatment below.

## 8. Migration planning

A change that cannot simply be rolled back — a contract version bump, a read-model reshape, a change to how evidence is stored — requires a written migration plan covering:

- The forward path, and **how far in it is still reversible**.
- The point of no return, named explicitly.
- What happens to in-flight recommendations, pending approvals, and unexpired execution intents during the migration. *(In-flight authorizations are the thing people forget, and they are the thing that reaches real clients.)*
- How replay behaves against pre-migration and post-migration history.
- Verification that the migration worked, before the old path is removed.

## 9. Feature flags for risky behavior

Anything that changes what reaches a human — a new agent version, a new recommendation type, a new prioritization model — ships behind a flag, and the flag defaults to **off**.

Flags are for **rollout**, not for permanent branching. A flag that has been on for six months is dead code plus a decision nobody made; a flag that has been off for six months is dead code. Remove both.

## 10. Shadow mode before automation

**No capability is surfaced to humans before it has run in shadow, and no capability is automated before it has been evaluated in assisted mode** ([automation-levels.md](./automation-levels.md)).

This applies to **new versions of existing agents**, not only to new agents. A Kabir v3 that is "obviously better" than v2 goes to shadow and is compared against v2 on recorded history. "Obviously better" is a hypothesis, and Phase 14 exists to test hypotheses like it.

## 11. No silent policy changes

Policies authorize actions against real people and real money ([ADR-0005](../decisions/ADR-0005-human-and-policy-approval.md)). A policy change is a change to who is allowed to do what.

Therefore:

- Every policy is **versioned**, and every version is retained.
- Every policy change is **attributable** to the human who made it.
- Every policy change is **visible** — announced, reviewed, and recorded in the audit trail.
- **Widening a policy's scope is never a config tweak.** It is a decision, with the same seriousness as the decision that created the policy.
- QF Jarvis may **propose** a policy change as a recommendation. It may never edit, enforce, or bypass one.

A policy that quietly widened is autonomy that nobody approved.

---

## Incident response

A **safety-metric breach is an incident, not a metric movement** ([success-metrics.md](../charter/success-metrics.md)):

- An unauthorized action — an effect with no authorization decision behind it.
- A sensitive-data logging incident.
- An incorrect automated action.
- A signature-verification failure or replay attempt that is not immediately explained.

**Response, in order:**

1. **Stop the bleeding.** Revoke the automated class, switch off the flag, or disable the agent. This costs nothing and breaks nothing, by design.
2. **Establish what actually happened**, using the audit trail. The backward walk — effect → result → intent → approval → recommendation → evidence → events — is what makes an incident recoverable rather than merely alarming ([auditability-principles.md](./auditability-principles.md)).
3. **Reconcile** QuickFurno Core's record against the provider's, where an external effect occurred.
4. **Fix the cause**, not the symptom.
5. **Record the decision** as an ADR if the fix changes the architecture.

Anyone may stop an automated class or block an automation promotion on safety, security, or privacy grounds, **without needing to justify it first**. Justification comes after; the stop comes immediately.
