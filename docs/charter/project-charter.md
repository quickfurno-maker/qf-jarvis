# Project Charter — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11
**Business owner:** Keshav Sharma, Founder, QuickFurno

---

## 1. Project name

QF Jarvis — the intelligence, recommendation, coordination, and founder decision-support layer for the QuickFurno ecosystem.

## 2. Product purpose

QF Jarvis exists to convert the operational noise of the QuickFurno marketplace into a small number of well-evidenced, explainable, prioritized decisions for the founder and the operating team.

It observes what happens inside QuickFurno Core, reasons about it through bounded specialist agents, and produces structured recommendations. It does not run the business; it helps the business decide.

## 3. Problem statement

QuickFurno is a growing local home-service vendor discovery and lead-generation marketplace. As lead volume, vendor count, city coverage, and marketing spend grow, the following pressures appear:

- Lead quality varies, and unverified or fraudulent leads consume vendor trust and wallet balance.
- Client follow-up is inconsistent, and requirements are abandoned without recovery attempts.
- Vendors stall between signup and activation, let packages lapse, or churn without anyone noticing in time.
- Marketing spend is allocated without a tight, per-city, per-category read on cost per *verified* lead.
- The founder is the default escalation path for all of the above, which does not scale.

There is no single place where cross-domain signals are synthesized into "here is what deserves your attention today, here is the evidence, and here is what I recommend."

## 4. Strategic value

- **Founder leverage.** One prioritized view replaces scattered dashboards and ad-hoc checking.
- **Lead economics.** Better verification and earlier detection of bad leads protects vendor trust and improves cost per verified lead.
- **Lifecycle continuity.** Clients and vendors are followed up consistently rather than opportunistically.
- **Expansion readiness.** City and category growth becomes a configuration and capacity question rather than an attention question.
- **Safe automation path.** Recommendations that prove themselves under evaluation can be promoted to policy-governed automation, gate by gate, without ever handing the business's authority to a model.

## 5. Scope

### In scope

- Ingestion of canonical events emitted by QuickFurno Core.
- Bounded specialist agents producing structured, evidence-backed recommendations.
- Coordination, deduplication, prioritization, and consolidation of those recommendations by Jarvis.
- Founder and operator surfaces for reviewing recommendations and attention items.
- Submission of approved recommendations into QuickFurno Core's authorization path.
- Recording of approval decisions, execution intents, execution results, and audit trails as they relate to recommendations.
- Evaluation of recommendation quality over time.

### Out of scope

- Owning any business record: leads, clients, vendors, assignments, packages, wallets, payments.
- Performing lead assignment, matching, or any money movement.
- Authorizing its own recommendations.
- Calling communication or advertising providers directly.
- Replacing, forking, or shadowing QuickFurno Core's data model as a second source of truth.

## 6. Intended users

| User | Relationship to QF Jarvis |
| --- | --- |
| Keshav Sharma (Founder) | Primary consumer of prioritized attention items and briefings; final approver for high-risk actions |
| QuickFurno administrators | Configure policy, review recommendations, approve within delegated limits |
| Operations team | Act on lead-quality and verification recommendations |
| Sales / vendor-acquisition team | Act on vendor onboarding, activation, recharge, and win-back recommendations |
| Marketing team | Act on campaign, channel, and budget recommendations |
| Client-support team | Act on client follow-up and reactivation recommendations |
| Technical operators | Run, observe, and maintain the Jarvis platform |

Clients and vendors are **subjects** of the system, never direct users of it. They experience its effects only through actions that QuickFurno Core has authorized and n8n has executed via approved providers.

## 7. System boundary

The boundary below is permanent. The authoritative statement lives in [system-boundary.md](../architecture/system-boundary.md); this section is a summary and must not contradict it.

- **QuickFurno Core** owns business truth, operational state, authorization, policy enforcement, money, wallets, packages, payments, leads, clients, vendors, assignments, and all authoritative lifecycle state. It approves or rejects actions. It is the source of truth.
- **QF Jarvis** provides intelligence, reasoning, structured recommendations, specialist-agent coordination, prioritization, cross-domain synthesis, and founder decision support. It never becomes the source of business truth, never directly mutates QuickFurno Core state, and never directly calls communication or advertising providers.
- **n8n** is the approved execution fabric. It executes only authorized execution intents, integrates with providers (WhatsApp, SMS, email, voice, CRM, Google Ads, Meta Ads, and other approved providers), and reports execution results back to QuickFurno Core.
- **External providers** deliver communications and operational actions.
- **Human approvers** hold authority that no agent holds.

## 8. Core architectural rule

> Jarvis recommends.
> QuickFurno authorizes.
> n8n executes.
> Providers deliver.
> Results return to QuickFurno Core.

Conceptual flow:

```
QuickFurno Core
  → Canonical Event
    → QF Jarvis
      → Specialist Agent
        → Structured Recommendation
          → QuickFurno Policy or Human Approval
            → Execution Intent
              → n8n
                → Provider
                  → Execution Result
                    → QuickFurno Core
```

## 9. Specialist agents

Agents recommend only. They do not authorize and they do not execute. Full definitions live in [agent-model.md](../architecture/agent-model.md).

- **Jarvis** — coordinator: routing, conflict detection, multi-domain synthesis, composite recommendations, founder prioritization, briefings, attention management, and **communication coordination**. **Jarvis supports calling and WhatsApp through governed execution** — it has controlled communication coordination and user-facing capabilities, but no direct provider transport, delivery, or authorization authority ([communication-model.md](../architecture/communication-model.md)).
- **Kabir** — lead quality, lead completeness, spam and fraud signals, budget plausibility, urgency plausibility, category consistency, location consistency, matching readiness, operational intelligence.
- **Riya** — client communication strategy, client follow-up, nurture recommendations, abandoned-requirement recovery, client reactivation, relationship intelligence, communication timing and channel recommendations.
- **Anisha** — vendor acquisition, vendor qualification, onboarding, profile completion, activation, package readiness, recharge recommendations, retention, upgrade, inactivity recovery, vendor win-back.
- **Jitin** — campaign performance intelligence, marketing channel analysis, cost-per-verified-lead analysis, city and category demand intelligence, SEO opportunity detection, content recommendations, creative fatigue detection, budget-shift recommendations, growth intelligence.

## 10. Business context and initial domains

QuickFurno is a local home-service vendor discovery and lead-generation marketplace. It connects clients with verified local professionals in:

- interior design
- carpentry
- modular factories
- premium interiors
- sofa work
- painting
- civil work

Operating principles that shape the architecture:

- **Pune is the first operational city.** Mumbai and additional cities follow later. Nothing may be built in a way that hard-codes a single city.
- **One qualified lead may be shared with a maximum of three suitable vendors.** ⚠️ **Superseded — see the note below.** This is a **QuickFurno Core business rule**, enforced by QuickFurno Core. Jarvis may reason about matching readiness and vendor suitability, and may explain or flag outcomes, but Jarvis does not perform assignment and does not own this rule.
- **Location-aware matching matters.** Vendor category, city, service area, quality, availability, package eligibility, and performance may influence matching — all evaluated and decided by QuickFurno Core.
- **QuickFurno Core remains authoritative** for matching, lead assignment, wallet, package, payment, and vendor state.
- Jarvis may assess, recommend, prioritize, and explain. It does not make final assignment or money-related decisions independently.

### ⚠️ Supersession note — the maximum-three-vendors rule

**The flat "maximum of three suitable vendors per qualified lead" rule recorded above is superseded** by the revised two-batch policy in [ADR-0015](../decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md), **Accepted by the business owner on 2026-07-12**.

The original rule is **left in place deliberately, not deleted.** It is what Phase 0 approved, and the charter is a record of what was decided and when. Editing it into agreement with a later decision would destroy exactly the history the charter exists to hold — and would make it impossible to answer *"what did we originally agree, and when did that change?"* ([change-management.md](../governance/change-management.md): superseding does not mean editing).

**The revised policy:**

| Rule | Value |
| --- | --- |
| Initial assignment batch | at most **3** eligible vendors — batch **1** |
| Replacement batch | at most **3** *additional* unique vendors — batch **2** |
| Replacement batches permitted | **exactly one.** There is no batch three |
| Lifetime maximum | **6 unique vendors per lead-category**, for all time |
| Vendor overlap between batches | **forbidden** |
| Trigger for a replacement | genuine dissatisfaction **and explicit client confirmation** |
| Who creates and authorizes a batch | **QuickFurno Core, and only Core** |
| Cross-category requirement | a **separate linked lead**, with its own fresh batch of three |

What has **not** changed: assignment remains **QuickFurno Core's business rule, enforced by Core**. Jarvis does not perform assignment, does not own the rule, and — under the revised policy — Riya may *request* a reassignment but has no field in which she could name a vendor.

> **Status: ADR-0015 is `Accepted`. The business owner approved this supersession on 2026-07-12, and the revised policy above is now the operative one.** The original rule is retained as the record of what Phase 0 approved — not as current policy.

## 11. Implementation principles

- Contract-first: canonical events and recommendation shapes are agreed before code.
- Deterministic logic before AI: if a rule reliably decides it, a rule decides it.
- Explicit boundaries over convenient shortcuts.
- Small, reversible phases with clear entry and exit criteria.
- Idempotency everywhere a message can be redelivered.
- Observability and auditability are features, not afterthoughts.
- Every architectural decision is recorded as an ADR.

Full statements: [engineering-principles.md](../governance/engineering-principles.md), [security-principles.md](../governance/security-principles.md), [privacy-principles.md](../governance/privacy-principles.md), [auditability-principles.md](../governance/auditability-principles.md).

## 12. Constraints

- QF Jarvis must not become a second source of truth, even transiently, even "just for caching decisions."
- QF Jarvis must not hold credentials for communication or advertising providers. It makes no WhatsApp API call and connects to no telephony provider.
- QF Jarvis must not bypass consent, opt-out, do-not-contact, quiet-hour, or attempt-limit rules — which QuickFurno Core owns and enforces, **and enforces even against an instruction from the founder** ([communication-model.md](../architecture/communication-model.md)).
- Every action reaching a real client, vendor, or ad account must be traceable to an authorization decision made by QuickFurno Core or an authorized human.
- The system starts at Automation Level 0 and advances only through measurable gates ([automation-levels.md](../governance/automation-levels.md)).
- Model reasoning traces (private chain-of-thought) are not stored. Rationale and evidence are stored; hidden deliberation is not.
- Personal data is minimized, purpose-limited, and redacted in logs.

## 13. Assumptions and target integration capabilities

### Target integration capabilities — present availability unverified

The following are **capabilities QuickFurno Core is targeted to have by Phase 11**. Their availability today is **unverified, and QF Jarvis does not assume it**:

- **Canonical event emission** — Core emitting versioned domain events with stable identifiers.
- **An authorization-decision interface** — Core accepting an approval request, validating it, deciding, recording the authoritative decision, and emitting a canonical decision event.

**No phase before Phase 11 depends on either capability existing.** Phase 2 defines the contracts, schemas, registries, fixtures, compatibility rules, and tests. Phase 3 builds Jarvis's durable event backbone against those contracts and its own fixtures. Phase 9 defines the approval and policy capabilities. **Phase 11 implements the integration itself** — event emitters, authorization interfaces, compatibility adapters, callbacks, and any migration Core requires ([phased-roadmap.md](../architecture/phased-roadmap.md)).

**If Core does not have these capabilities today, that changes the Phase 11 workload — it does not change the source-of-truth boundary.** Core remains authoritative for business truth and authorization regardless of what it can currently emit or accept ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md)).

### Working assumptions

- n8n remains the approved execution fabric and is reachable only through authorized execution intents.
- The founder is available as the final approver for high-risk actions during early phases.
- Pune-only operation gives sufficient signal volume to evaluate recommendation quality before expansion.

## 14. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Boundary erosion — Jarvis gradually acquires write authority "for speed" | Loss of a single source of truth; unauditable business state | Boundary is an accepted ADR ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md)); responsibility matrix reviewed each phase |
| Recommendation noise — too many low-value items | Founder ignores the system; project fails on adoption | Prioritization, expiry, consolidation; recommendation acceptance rate is a tracked metric |
| Model overreach — AI used where rules suffice | Non-determinism, cost, unexplainable outcomes | Deterministic-first principle; agent model separates rules from reasoning |
| Event contract drift between Core and Jarvis | Silent data loss, wrong recommendations | Versioned canonical events ([ADR-0003](../decisions/ADR-0003-event-driven-integration.md)); contract tests |
| Premature automation | Wrong actions reach real clients and vendors | Automation levels with explicit gates; shadow mode before assisted mode |
| Sensitive data leakage into logs or model context | Privacy and trust failure | Data minimization, redaction, no chain-of-thought storage |
| Provider compromise or misuse via n8n | Unauthorized outreach or ad spend | Bounded, expiring execution intents; Jarvis holds no provider credentials |
| Over-engineering (microservices too early) | Slow delivery, no business value | Modular monolith first ([ADR-0004](../decisions/ADR-0004-modular-monolith-first.md)) |

## 15. Phased delivery approach

Phase 0 through Phase 15, defined in [phased-roadmap.md](../architecture/phased-roadmap.md). Phases are not compressed. Each has an objective, key outputs, explicit exclusions, entry and exit criteria, dependencies, and principal risks. One phase per branch ([change-management.md](../governance/change-management.md)).

## 16. Definition of success

QF Jarvis is successful when:

1. The founder starts the day on one prioritized view rather than several dashboards, and trusts it enough to act from it.
2. Recommendations are accepted at a rate that justifies their volume, and every one of them can be traced back to the events that produced it.
3. Verified lead rate, vendor activation, and cost per verified lead move measurably in the right direction, and the movement can be attributed.
4. No action has ever reached a client, vendor, or ad account without an authorization decision recorded in QuickFurno Core.
5. At least one low-risk recommendation class has been promoted to policy automation *after* passing evaluation gates — and the promotion could be reversed tomorrow without incident.

QF Jarvis is **not** an independent marketplace, and it is **not** the source of truth. Any future statement, feature, or shortcut that implies otherwise is a defect.
