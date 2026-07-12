# QuickFurno Compatibility Directive

**Status:** Authoritative — **approved by the business owner, 2026-07-12**
**Date:** 2026-07-12
**Supersedes:** nothing. **Constrains:** every phase from Phase 2 onward.

---

## Why this document exists

Phase 2 was built, correctly, against the architecture approved in Phase 0. Then the requirements changed — the client journey grew, vendor reassignment acquired a real policy, agent memory and learning entered scope, and the sequencing of live communication was tightened.

Those revisions had not been written down anywhere. An audit of the Phase 2 implementation found contracts that were excellent and requirements that were **absent from the repository entirely** — not disagreed with, not deferred, simply never recorded. This document is the correction: it is where the revised requirements now live, and it is the thing later phases are checked against.

**A requirement that exists only in conversation is a requirement the codebase will not honour.** That is the failure this document closes.

---

## 1. The permanent rule is unchanged

> **Jarvis recommends. QuickFurno Core authorizes. n8n executes. Providers deliver. Results return to Core.**

- **No Jarvis-to-n8n path.** Not now, not in any phase.
- **No Jarvis-to-provider path.** No WhatsApp API call, no telephony connection, no provider credential inside the Jarvis trust zone.
- **No Jarvis write path into any QuickFurno business table.** Not permanently, not temporarily, not "just as a cache."

Nothing in this directive weakens that rule, and nothing may. It is enforced structurally in `@qf-jarvis/contracts` — `ExecutionIntentV1.issuer` is the literal `quickfurno-core` and its `executor` the literal `n8n`, so **Jarvis cannot construct a valid execution intent** ([ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md), [ADR-0014](../decisions/ADR-0014-governed-lifecycle-contracts.md)).

---

## 2. QuickFurno Core authority

QuickFurno Core is the single source of business truth. It owns leads, clients, vendors, assignments, packages, wallets, payments, and campaigns, and it alone mutates them ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md)).

Jarvis holds **derived, non-authoritative views**. When a derived view and Core disagree, **Core wins, always, without discussion** — and the derived view is rebuilt, not reconciled toward.

### The QuickFurno Communication Core

**"QuickFurno Communication Core" is the communication authority inside QuickFurno Core.** It is not a separate system, and it is not the QF Communications Runtime (which lives in n8n's trust zone and *delivers*; see [communication-model.md](./communication-model.md)).

It owns, exclusively:

| It owns | Which means Jarvis may not |
| --- | --- |
| Consent evidence | Hold a consent flag of its own |
| Preferences | Decide a channel is acceptable |
| Suppressions | Maintain a suppression list |
| STOP/START authority | Interpret a STOP itself |
| Communication decision authority | Authorize any communication |
| Reason-code versions | Invent a refusal reason |
| Current eligibility | Cache eligibility |
| Delivery and call truth | Claim a message was delivered |
| Authoritative communication history | Be the record of what was said |

**Jarvis must not create parallel consent, preference, suppression, STOP/START, or delivery state.** This is enforced: `CommunicationRequestV1` has no consent field, and one cannot be added — the schema is strict.

Two rules that follow, and that must never be softened:

- **Unknown or stale consent is not permission.** A missing answer is a no.
- **Transactional no-objection is not marketing permission.** A client who accepted a delivery update has not agreed to be marketed to.

---

## 3. Agent domains

### Riya — the complete client journey

Riya owns client intelligence across the **whole** journey: requirement completion, follow-up, satisfaction and dissatisfaction detection, complaints, explicit confirmation capture, **reassignment requests**, **linked-category lead requests**, review, human escalation, and lifecycle closure.

**Riya never assigns.** She never chooses a vendor, never changes consent, and never sends anything directly. She may *notice* dissatisfaction, may *carry* the client's explicit confirmation, and may *ask* Core to reassign. Choosing the vendors is Core's, and `AssignmentBatchV1` has no shape in which Riya could name one.

### Anisha — the complete vendor journey

Anisha owns vendor intelligence: registration, profile completion, verification status, activation, inactivity, performance, package readiness, recharge opportunity, complaints, retention risk, and win-back. Advisory relationship intelligence, end to end.

**Anisha never controls verification, activation, eligibility, ranking, packages, wallets, credits, money, or assignments.** She recommends a recharge *conversation*; she never touches money. Money-adjacent events carry **bands, never balances** — a wallet figure inside a Jarvis contract would be stale by construction and would invite somebody to reason about a real vendor's money from a copy nobody reconciles.

### Kabir — advisory lead intelligence

Lead quality, completeness, plausibility, consistency, fraud signals, matching readiness.

**Kabir never replaces LeadLens, TrustShield, MatchForge, or LeadFlow.** Those are QuickFurno Core's systems and they remain authoritative. Kabir advises alongside them; he does not substitute for them, and a disagreement between Kabir and Core is resolved in Core's favour.

### Jitin — advisory growth intelligence

Campaign performance, channel efficiency, cost per verified lead by city and category, demand intelligence, SEO opportunity, creative fatigue, budget-shift recommendations.

**Jitin has no advertising-provider credentials and no budget authority.** No Google Ads path, no Meta Ads path, ever. He works in aggregate: his memory domain is cities, categories, and campaigns, and it contains **no client and no vendor** — marketing intelligence does not require remembering individual people, so it is not permitted to.

### Jarvis — coordination

Routing, consolidation, conflict detection, cross-domain synthesis, founder attention, evaluation, escalation.

**Jarvis must not absorb specialist domains.** It owns the connecting, never the concluding. Its memory domain is recommendations, agent runs, evaluations, and founder-attention state — it holds **no client, vendor, or lead memory at all**, because an agent that remembers domain facts is an agent that has started concluding.

---

## 4. Vendor assignment and reassignment

**This supersedes the flat "maximum three vendors per qualified lead" rule** recorded in earlier documents. The cap is now two-batch and scoped per **lead-category**.

### The policy

| Rule | Value |
| --- | --- |
| Initial assignment batch | **At most 3** eligible vendors. Batch number **1** |
| Replacement batch | **At most 3** *additional* vendors. Batch number **2** |
| Replacement batches permitted | **Exactly one.** There is no batch three |
| Lifetime maximum | **6 unique vendors per lead-category**, for all time |
| Vendor overlap between batches | **Forbidden** |
| Trigger for a replacement | Genuine dissatisfaction **and explicit client confirmation** |
| Who creates and authorizes a batch | **QuickFurno Core, and only Core** |

### Dissatisfaction is never inferred

A replacement requires a `ClientConfirmationV1` — an artifact that points at the canonical event in which the client **actually asked**. An agent noticing that a client has gone quiet, or a model scoring a conversation as unhappy, is *evidence*. It is not confirmation, and it may not become one by an agent being confident about it.

The failure this prevents is concrete: three new vendors are contacted about a real person's home renovation because a model decided their tone had cooled. That is not recoverable — the vendors have been paid for in lead value, and the client has been shopped around without asking.

### Why the cap is per lead-category

A client who wanted a wardrobe and now also wants a kitchen has not spent their wardrobe vendors exploring kitchens. Counting the two together starves a legitimate second requirement; counting them as one lead lets a client walk past an unbounded number of vendors by renaming what they wanted. **The lead-category pair is the unit that makes both of those wrong.**

Enforced in `AssignmentBatchV1` ([ADR-0015](../decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md)).

---

## 5. Cross-category needs create separate, linked leads

When a client wants something in a **different category**, Core creates a **new lead**. Not a widened one.

Requirements:

- **Explicit client confirmation** is mandatory.
- **Core creates it.** Jarvis identifies and asks.
- The linked lead has **independent identity, consent, verification, scoring, and matching** — asserted as four literals that can only be `true`, so inheritance from the parent does not parse.
- The new category receives **its own initial batch of at most 3**.
- **The replacement policy applies independently per lead-category.**

The tempting shortcut — widen the existing lead, add a category, offer it to a few more vendors — fails three ways at once: the vendor cap becomes meaningless, consent and verification are silently inherited, and the audit trail forks. A kitchen lead reaching vendors on a wardrobe's consent is exactly what the separation exists to prevent.

---

## 6. Agent memory and learning boundaries

Agent memory is the most dangerous artifact in the system, because it is the only one that **persists and is reused**. A persistent, agent-owned store of business facts is — however it is described — a second copy of Core's data that drifts and that an agent will eventually reason from in preference to the truth.

So memory is bounded structurally ([ADR-0016](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md)):

| Property | How |
| --- | --- |
| **Isolated** | `ownerAgent` scopes it; a subject outside the owner's domain does not parse |
| **Minimal** | Bounded text and governed signals. No free-text blob |
| **Derived** | `sourceEventIds` is non-empty — memory that cannot name its sources was invented, not derived |
| **Rebuildable** | `rebuildable: true` is a **literal**. `false` does not parse |
| **Non-authoritative** | `authoritative: false` is a **literal**. `true` does not parse |
| **Deletion-aware** | `erasureState` is mandatory, so an un-propagated deletion is *detectable* rather than invisible |

**QuickFurno truth overrides memory, always.**

### Memory ownership

| Agent | May remember |
| --- | --- |
| **Riya** | Minimal client relationship and requirement context |
| **Anisha** | Minimal vendor lifecycle and performance context |
| **Kabir** | Minimal lead-quality context |
| **Jitin** | Aggregated city, category, and campaign context — **no individuals** |
| **Jarvis** | Recommendations, agent runs, evaluations, founder-attention state — **no domain facts** |

### Learning

- **Model and prompt provenance is mandatory.** A model invocation whose prompt version nobody recorded cannot be reproduced, regression-tested, or explained.
- **No chain-of-thought is ever stored.** Not in memory, not in a run record, not in a dataset. It is refused by key and by value shape in every governed container.
- **No complete prompts containing personal data**, no raw model output, no provider credentials.
- **Agents may not rewrite their prompts, policies, or production configuration.** An agent that could raise its own approval threshold would be an agent that could authorize itself, one indirection removed.
- **No data becomes training data automatically.** Eligibility exists only as an explicit decision by a named human or a named, versioned policy, against complete provenance, with a stated purpose limitation. **Sensitive personal data is never eligible, under any approval.**

### Reasoning providers

**Claude and ChatGPT** are the initial reasoning providers, behind a **future model-agnostic gateway**. **No gateway and no model integration is implemented in Phase 2** — what exists is the shape of the provenance record such a gateway will one day have to produce.

---

## 7. Shadow-first maturity model

Every agent earns its way forward. Nothing skips a step.

| Stage | What happens |
| --- | --- |
| **Shadow** | The agent produces recommendations. Nobody sees them. They are recorded and evaluated |
| **Assisted** | Recommendations reach humans, who act manually |
| **Approval-controlled** | An approved recommendation becomes an execution intent Core issues |
| **Limited policy automation** | One narrow, low-risk, reversible class, with an off switch that costs nothing to pull |

**A system permanently at approval-controlled that the founder trusts is a success. A system at policy automation that the founder has stopped trusting is not.**

---

## 8. Outcome-based agent evaluation

Acceptance is a proxy. **Outcome is the measure.**

An agent that learns to produce plausible, agreeable, low-friction suggestions will score beautifully on acceptance while moving no business metric at all — and it will do so *because* acceptance was what got measured.

So the two are separate contracts (`RecommendationEvaluationV1` and `OutcomeFeedbackV1`), and **no recommendation class is promoted to automation on acceptance data alone.** Outcome correlation is required, and `unknown` is a permitted and frequently correct answer — a manufactured correlation is worse than an admitted ignorance, because somebody will promote an agent on the strength of it.

---

## 9. Phase sequencing for live communication

Corrected, and load-bearing ([ADR-0017](../decisions/ADR-0017-live-communication-sequencing.md)):

### Phase 10 — n8n Execution Bridge: **TEST ONLY**

Test dispatcher. Fixtures. Simulated Core interface. Intent validation. n8n contract validation. Duplicate-effect testing. Messaging lifecycle simulation. Voice-gate design and tests.

**No production recipient. No live provider. No production message. No production call.**

### Phase 11 — QuickFurno Core Integration: **LIVE**

Live canonical events. Recommendation submission. Core's authorization interface. Core's execution-intent dispatch. Result callbacks. Consent re-validation. Reconciliation. Deletion and anonymisation propagation.

### Phase 11A — Controlled Communication Pilot

In sequence, and never out of it:

1. Internal test destinations
2. **One** low-risk transactional purpose
3. Human-approved client pilot
4. Delivery and result reconciliation
5. Controlled expansion
6. **Voice only after messaging safety evidence**

**No production communication is permitted before Phase 11 succeeds.**

---

## 10. Target contracts are not claims about Core

The event catalogue in `@qf-jarvis/contracts` now includes client, vendor, assignment, and governance events. **These are target contracts. No claim is made that QuickFurno Core emits any of them today.**

The earlier position — *do not invent a payload for a system nobody has looked at* — was sound, and it is answered not by looking at Core but by **making the payloads carry almost nothing**. A target payload names *which* entity (an opaque reference) and *what happened* (a stable reason code), plus a small governed bag of derived signals. It does not reproduce Core's record.

An adapter that has to map Core's real lead record onto *that* has an easy job. An adapter that had to map it onto an invented forty-field lead schema would have an impossible one — and would end up bending the contract.

> **The adapter absorbs the difference; the contract does not bend.**

Establishing the live emitters is **Phase 11's** work.

---

## 11. What this directive does not change

- The permanent boundary (§1).
- The eighteen communication states. Not renamed, not merged, not extended.
- Any Accepted ADR from **ADR-0001 through ADR-0011**.
- The rule that a phase is done when its exit criteria are met — not when it is late, and not when the next phase looks more interesting.
