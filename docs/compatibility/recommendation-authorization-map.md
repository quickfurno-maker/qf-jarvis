# Recommendation → Authorization Map

**Status:** Compatibility baseline. **Design only. No agent exists, and none is built in Stage 3.1.2.**
**Date:** 2026-07-13
**QuickFurno snapshot:** `quickfurno-maker/quickfurno-marketplace` @ **`00706899b46ae16fa6170c70125708b63e0926a9`**
**Decision:** [ADR-0025](../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Proposed)

> **Jarvis recommends. QuickFurno Core authorizes. n8n executes. Providers deliver.**
>
> **A recommendation is inert.** It is a proposal carrying evidence, an expiry, and a required approval level. **It is not an instruction, and Core is not obliged to act on it.**

**Contract vocabulary** (from `@qf-jarvis/contracts`):
**Risk classes** — `informational` · `low-risk-reversible` · `client-or-vendor-facing-communication` · `outbound-voice-call` · `money-related` · `high-risk-or-novel`
**Approval levels** — `none` · `delegated-approver` · `authorized-team-human` · `stronger-approval` · `founder`

**Every agent below is at maturity stage `shadow`.** Recommendations are produced, recorded, and evaluated. **Nobody sees them, and nothing acts on them** ([compatibility directive §7](../architecture/quickfurno-compatibility-directive.md)).

---

## Kabir — advisory lead intelligence

|                                                |                                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inputs**                                     | `qf.client.requirement-completed`; Core's `lead_scores` and `lead_matching_runs` (**high-value: `matching_snapshot` carries skipped vendors _with reasons_, and the vendors that lost to the cap**)        |
| **Recommends**                                 | Lead quality/completeness/plausibility concerns · fraud signals · **matching readiness** · clarification-worthy gaps                                                                                       |
| **Evidence**                                   | ≥1 `canonicalEventEvidence`. **Memory that cannot name its sources was invented, not derived**                                                                                                             |
| **Confidence**                                 | Required · **Risk** `informational` → `low-risk-reversible`                                                                                                                                                |
| **Expiry**                                     | **Short (hours).** Lead quality is perishable — a stale read of a lead that has since been clarified is worse than none                                                                                    |
| **Approval**                                   | `none` (shadow) → `delegated-approver`                                                                                                                                                                     |
| **Core capability needed**                     | Lead-advisory intake; clarification-request intake                                                                                                                                                         |
| **Deterministic policy that must validate it** | Core's LeadLens/TrustShield remain authoritative. **A disagreement is resolved in Core's favour**                                                                                                          |
| **n8n execution**                              | Possible later: send a clarification message — **only** via `CommunicationRequestV1`, Core-authorized                                                                                                      |
| **Result event**                               | `qf.execution.result-recorded`                                                                                                                                                                             |
| **🚫 Prohibited**                              | **Verifying or rejecting a lead. Blocking a lead. Naming a vendor. Assigning. Deducting a credit. Replacing LeadLens/TrustShield/MatchForge/LeadFlow** — those are Core's systems and remain authoritative |

---

## Riya — the complete client journey

|                            |                                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inputs**                 | `qf.client.*`, `qf.assignment.batch-*`, `qf.communication.state-recorded`                                                                                                                                                           |
| **Recommends**             | Requirement completion · follow-up timing · satisfaction/**dissatisfaction detection** · complaint escalation · **reassignment requests** · linked-category lead requests · review requests · **human handoff** · lifecycle closure |
| **Evidence**               | Canonical events. **For a reassignment: a `ClientConfirmationV1` pointing at the event in which the client _actually asked_**                                                                                                       |
| **Confidence**             | Required · **Risk** `low-risk-reversible` → `client-or-vendor-facing-communication`                                                                                                                                                 |
| **Expiry**                 | Hours to days                                                                                                                                                                                                                       |
| **Approval**               | **`founder` for the first client-facing communication.** Then `authorized-team-human`. **Reassignment always requires human approval**                                                                                              |
| **Core capability needed** | Reassignment intake · linked-lead creation · communication request intake                                                                                                                                                           |
| **Deterministic policy**   | Core validates the **explicit client confirmation**, the batch cap, and consent                                                                                                                                                     |
| **n8n execution**          | Follow-up / review message — **Core-authorized only**                                                                                                                                                                               |
| **Result event**           | `qf.client.reassignment-authorized` \| `-rejected`; `qf.execution.result-recorded`                                                                                                                                                  |
| **🚫 Prohibited**          | **Assigning or naming a vendor.** **Changing consent.** **Sending anything directly.** **Inferring dissatisfaction into a replacement**                                                                                             |

> ### The one rule that must never be softened
>
> **Dissatisfaction is never inferred into an action.** An agent noticing a client has gone quiet, or a model scoring a conversation as unhappy, is **evidence**. It is **not confirmation**, and it may not become one by an agent being confident about it.
>
> The failure this prevents is concrete: **three new vendors are contacted about a real person's home renovation because a model decided their tone had cooled.** That is not recoverable — the vendors have been paid for in lead value, and the client has been shopped around without asking.

---

## Anisha — the complete vendor journey

|                            |                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inputs**                 | `qf.vendor.*`, `qf.assignment.batch-*`                                                                                                                                                                                     |
| **Recommends**             | Registration/profile completion nudges · verification readiness · **inactivity** · performance observations · **package readiness** · **recharge opportunity** · complaint patterns · retention risk · win-back candidates |
| **Evidence**               | Canonical events. **Money-adjacent evidence carries bands, never balances**                                                                                                                                                |
| **Confidence**             | Required · **Risk** `low-risk-reversible` → `client-or-vendor-facing-communication`. **Never `money-related`, because she never proposes a money movement**                                                                |
| **Expiry**                 | Days                                                                                                                                                                                                                       |
| **Approval**               | `authorized-team-human`; **`founder` for the first vendor-facing communication**                                                                                                                                           |
| **Core capability needed** | Vendor-advisory intake; communication request intake                                                                                                                                                                       |
| **Deterministic policy**   | Core validates vendor state, consent, and eligibility                                                                                                                                                                      |
| **n8n execution**          | A recharge **conversation** — never a transaction                                                                                                                                                                          |
| **Result event**           | `qf.execution.result-recorded`                                                                                                                                                                                             |
| **🚫 Prohibited**          | **Verification · activation · suspension · eligibility · ranking · packages · wallets · credits · money · assignments.** **She recommends a recharge conversation; she never touches the money**                           |

> **A wallet figure inside a Jarvis contract would be stale by construction** — a copy nobody reconciles — and it would invite somebody to reason about a real vendor's real money from it. Hence **bands, never balances**.
>
> **Anisha's inputs are also poisoned in Core today**: `vendors.rating` and `completed_projects` are **never written** and are permanently `0`, and `verification_status` is a **write-once dead field**. **An agent must not infer "this vendor performs badly" from a column nobody populates.** Until Core fixes those, performance recommendations would be **confidently, systematically wrong** — which is why shadow mode exists.

---

## Jitin — advisory growth intelligence

|                            |                                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inputs**                 | **Aggregates only** — city, category, campaign                                                                                                                                                                                                                         |
| **Recommends**             | Campaign performance · channel efficiency · **cost per verified lead by city and category** · demand intelligence · SEO opportunity · creative fatigue · budget-shift proposals                                                                                        |
| **Evidence**               | Aggregated derived signals                                                                                                                                                                                                                                             |
| **Confidence**             | Required · **Risk** `informational` → `money-related` (budget shift)                                                                                                                                                                                                   |
| **Expiry**                 | Days to weeks                                                                                                                                                                                                                                                          |
| **Approval**               | **`founder` for anything touching spend.** Always                                                                                                                                                                                                                      |
| **Core capability needed** | Campaign-advisory intake                                                                                                                                                                                                                                               |
| **n8n execution**          | **None. Ever**                                                                                                                                                                                                                                                         |
| **🚫 Prohibited**          | **No advertising-provider credential. No Google Ads path. No Meta Ads path. No budget authority. Ever.** **His memory domain contains no client and no vendor** — marketing intelligence does not require remembering individual people, **so it is not permitted to** |

---

## Jarvis — coordination

|                            |                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inputs**                 | Every agent's recommendations; evaluation and outcome feedback                                                                                                                                                                     |
| **Recommends**             | Routing · consolidation · **conflict detection** · cross-domain synthesis · **founder attention** · escalation                                                                                                                     |
| **Evidence**               | Other recommendations and their evaluations                                                                                                                                                                                        |
| **Risk**                   | `informational` · **Approval** `none` → `founder` for escalation                                                                                                                                                                   |
| **Core capability needed** | Founder attention surface                                                                                                                                                                                                          |
| **🚫 Prohibited**          | **Absorbing a specialist domain.** It owns **the connecting, never the concluding.** Its memory holds **no client, vendor, or lead facts at all** — _an agent that remembers domain facts is an agent that has started concluding_ |

---

## The authorization path — every recommendation, no exceptions

```
Jarvis ──RecommendationV1──▶ Core intake
                              ├─ authenticate the submitting agent
                              ├─ validate the schema        (strict; unknown keys rejected)
                              ├─ validate AUTHORITY         (may this agent even propose this?)
                              ├─ check expiry               (stale ⇒ refused, not run)
                              ├─ suppress duplicates        (recommendationId is the key)
                              ├─ apply deterministic policy (Core's, versioned)
                              ├─ human approval where required
                              └─ approved ⇒ Core issues ExecutionIntentV1
                                             issuer:   'quickfurno-core'  ← LITERAL
                                             executor: 'n8n'              ← LITERAL
                                                        │
                                            n8n executes ──▶ provider delivers
                                                        │
                                    authoritative result event ──▶ through the outbox
```

**Jarvis cannot construct an execution intent.** `issuer` is the literal `quickfurno-core`, so the type does not exist in which Jarvis is the issuer. **This is a compiler guarantee, not a policy.**

**A refusal is a first-class outcome.** Core must return a recorded, reason-coded rejection that Jarvis can learn from. **An intake that silently drops what it does not like teaches an agent nothing** and hides a disagreement between two systems that must not disagree silently.

---

## Promotion is earned, and acceptance is not the measure

| Stage                         | What happens                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| **Shadow**                    | Recommendations produced. **Nobody sees them.** Recorded and evaluated                    |
| **Assisted**                  | They reach humans, who act manually                                                       |
| **Approval-controlled**       | An approved recommendation becomes an execution intent **Core** issues                    |
| **Limited policy automation** | **One** narrow, low-risk, reversible class, with an off switch that costs nothing to pull |

**No recommendation class is promoted on acceptance data alone.** An agent that learns to produce plausible, agreeable, low-friction suggestions **will score beautifully on acceptance while moving no business metric at all — and it will do so _because_ acceptance was what got measured.** Outcome correlation is required, and **`unknown` is a permitted and frequently correct answer**: a manufactured correlation is worse than an admitted ignorance, because somebody will promote an agent on the strength of it.

> **A system permanently at approval-controlled that the founder trusts is a success. A system at policy automation that the founder has stopped trusting is not.**
