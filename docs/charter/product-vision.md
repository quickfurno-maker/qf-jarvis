# Product Vision — QF Jarvis

**Status:** Phase 0 — in progress (pending review)
**Date:** 2026-07-11

---

## The one-sentence vision

QF Jarvis is the founder intelligence and operational decision-support layer for QuickFurno: it turns the marketplace's continuous event stream into a short, ranked, evidence-backed list of decisions worth making — and, once a decision is authorized, it gets out of the way.

## What this is not

This is not "AI runs the business." QF Jarvis has no authority. It cannot move money, assign a lead, message a client, or change an ad budget. It can only observe, reason, and recommend. Everything it proposes passes through QuickFurno Core's authorization before anything real happens.

We state this plainly because the failure mode of intelligence layers is authority creep. The vision below is deliberately constrained: more useful, less autonomous.

## Long-term vision

### 1. One prioritized founder command view

A single surface that answers "what deserves attention right now, and why." Ranked by business impact and time sensitivity, not by recency. Items expire. The list stays short on purpose — a view with fifty items is a view nobody reads.

### 2. Proactive operational alerts

Jarvis notices before a human would: a spike in unverifiable leads from one campaign, a vendor cohort stalling at profile completion, a city where demand is outrunning verified vendor capacity. Alerts arrive with evidence attached, not as bare notifications.

### 3. Structured recommendations

Every agent output is a structured object — subject, evidence, rationale, confidence, risk, priority, expiry, and the approval it would require — not a paragraph of chat. Structure is what makes recommendations rankable, auditable, evaluable, and safely convertible into execution intents.

### 4. Lead-quality intelligence

Kabir reads each lead for completeness, plausibility, internal consistency, spam and fraud signals, and matching readiness — so that vendor trust and vendor wallets are spent on leads worth spending on. QuickFurno Core still decides what a lead *is* and where it goes.

### 5. Client-lifecycle intelligence

Riya keeps client relationships from going quiet by accident: follow-up timing, channel choice, nurture sequences, abandoned-requirement recovery, reactivation of dormant clients. Recommendations, not messages — the message is sent only after approval, and only by n8n through an approved provider.

### 6. Vendor-lifecycle intelligence

Anisha watches the vendor journey end to end — acquisition, qualification, onboarding, profile completion, activation, package readiness, recharge, retention, upgrade, inactivity recovery, and win-back — and surfaces where a vendor is about to stall or churn while there is still time to act.

### 7. Marketing intelligence

Jitin reads campaigns against the metric that actually matters: cost per **verified** lead, by city and by category. Channel analysis, demand intelligence, SEO opportunity, content recommendations, creative fatigue detection, and budget-shift proposals — all of which remain proposals until authorized.

### 8. Approval-controlled execution

Nothing reaches a real client, vendor, or ad account without an explicit authorization decision recorded in QuickFurno Core. Approval is either a human decision or an explicit policy — never an implicit default, never an agent's own judgment.

The founder will be able to approve **from the Jarvis Control Plane**, because that is where the evidence is — but the click submits an approval *request*. QuickFurno Core validates it, decides, records the authoritative decision, and emits it; Jarvis then displays a result it did not choose. Hosting the button is not holding the authority ([ADR-0007](../decisions/ADR-0007-founder-approval-interface-and-authority.md)).

### 9. Explainable recommendations

Every recommendation carries the events it was derived from and the rationale for it. A founder can always ask "why is this here?" and get a real answer that points at real evidence. Recommendations that cannot be explained are defects, not features.

### 10. Measurable business outcomes

The system's worth is judged on QuickFurno's numbers — verified lead rate, response times, vendor activation, recharge, retention, cost per verified lead, conversion quality — and on whether its recommendations get accepted. See [success-metrics.md](./success-metrics.md).

### 11. Controlled automation, not uncontrolled autonomy

Automation is earned, one narrow capability at a time, by passing evaluation gates. The system starts at Level 0 (observation only) and advances through defined levels ([automation-levels.md](../governance/automation-levels.md)). Every automated capability remains reversible: a policy that automates something today can be switched off tomorrow without touching the business's authoritative state.

## What "good" feels like, concretely

- The founder opens one view in the morning, sees seven items instead of seven dashboards, acts on four, dismisses three, and the dismissals feed evaluation.
- An operator sees "this lead looks fabricated — here are the five signals" instead of discovering it after three vendors have paid for it.
- A vendor about to lapse gets a well-timed, approved recharge conversation instead of silence and churn.
- Marketing shifts budget away from a city-category pair with poor verified-lead economics because the evidence was surfaced, not because someone happened to check.
- Six months in, a handful of low-risk recommendation classes run under policy automation, each one having earned it, each one switchable off.

## What we will refuse to build

- A chat interface that "just does things" to the marketplace.
- Any Jarvis-side write path into leads, assignments, wallets, packages, or payments.
- Any direct Jarvis-to-provider integration.
- Autonomy justified by model confidence rather than by measured outcomes and explicit policy.
