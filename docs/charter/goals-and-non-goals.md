# Goals and Non-Goals — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11

---

## Goals

### G1 — Reduce founder attention overload

Collapse scattered signals into one short, ranked, expiring list of attention items. Success looks like fewer things demanding the founder's judgment, each one better prepared.

### G2 — Improve lead quality

Detect incomplete, implausible, inconsistent, spam, and fraudulent leads before they consume vendor trust and vendor wallet balance. Raise the verified lead rate; lower the cost per verified lead.

### G3 — Improve response speed

Surface time-sensitive situations — a hot lead going untouched, a vendor waiting on onboarding — early enough that acting on them still changes the outcome.

### G4 — Improve client follow-up consistency

Make follow-up a systematic recommendation rather than a matter of who remembered. Recover abandoned requirements; reactivate dormant clients; recommend the right timing and channel.

### G5 — Improve vendor activation and retention

Reduce the number of vendors who stall between signup and first assignment, let packages lapse, or churn silently. Recommend intervention while intervention still works.

### G6 — Improve marketing efficiency

Give marketing a per-city, per-category read on cost per *verified* lead, plus channel analysis, creative fatigue detection, SEO opportunity, and evidence-backed budget-shift proposals.

### G7 — Create auditable recommendation and execution flows

Every recommendation traceable to its source events. Every approval attributable to a decider. Every execution traceable to an authorized intent. Every provider result recorded. No gaps in the chain.

### G8 — Support city and category expansion

Nothing hard-codes Pune. Adding Mumbai, or a new service category, is configuration and capacity — not a rebuild and not a new source of founder attention.

### G9 — Enable safe gradual automation

Provide the evaluation machinery that lets a narrow, low-risk recommendation class earn policy automation — and lets it be revoked instantly if it stops earning it.

---

## Non-goals

### N1 — Replacing QuickFurno Core

QF Jarvis is a layer beside QuickFurno Core, not a successor to it. Core owns business truth and authorization permanently. See [ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md).

### N2 — Allowing Jarvis to own money or wallet truth

Wallets, packages, payments, recharges, and every balance in the system are owned by QuickFurno Core. Jarvis may *recommend* a recharge conversation; it may never *credit* a wallet, hold a balance, or cache one as authoritative.

### N3 — Direct provider execution by Jarvis

Jarvis holds no provider credentials and makes no calls to WhatsApp, SMS, email, voice, CRM, Google Ads, Meta Ads, or any other provider. Execution belongs to n8n, and only for authorized execution intents. See [ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md).

### N4 — Uncontrolled autonomous decisions

No agent authorizes its own recommendation. High confidence is not authority. Autonomy is granted by explicit policy, scoped narrowly, after evaluation — never assumed.

### N5 — Premature microservices

We start as a modular monolith. Service extraction happens when a real scaling or ownership boundary demands it, with evidence. See [ADR-0004](../decisions/ADR-0004-modular-monolith-first.md).

### N6 — Building all agents simultaneously

Kabir, Riya, Anisha, and Jitin arrive in separate phases (5 through 8), each with its own evaluation. Parallel construction of four agents on an unproven coordination layer is how you get four unevaluated agents.

### N7 — Collecting unnecessary personal data

Jarvis reads what it needs to reason and nothing more. It prefers identity *references* to identity *copies*. Data minimization and purpose limitation are enforced, not aspirational. See [privacy-principles.md](../governance/privacy-principles.md).

### N8 — Storing private model chain-of-thought

Rationale and evidence are first-class, stored, and auditable. Hidden model deliberation is not stored, not logged, and not surfaced. What we keep is the reasoning we can stand behind, not the model's internal scratch work.

### N9 — Using AI for deterministic tasks that rules can handle reliably

If a rule decides it correctly, a rule decides it. Model reasoning is reserved for judgment under ambiguity — plausibility, prioritization, synthesis, strategy — not for arithmetic, threshold checks, completeness validation, or anything with a right answer.

---

## Explicit tensions we accept

| We chose | Over | Because |
| --- | --- | --- |
| Slower, gated automation | Faster autonomous action | An incorrect automated action reaches a real client, vendor, or ad budget |
| Fewer, higher-quality recommendations | Comprehensive coverage | An ignored list has zero value regardless of its recall |
| Modular monolith | Microservices | Business value first; distribution costs are real and premature here |
| Deterministic rules where possible | Model reasoning everywhere | Explainability, cost, and reproducibility |
| Strict boundary discipline | Convenient direct writes | A single source of truth is worth more than any shortcut it forbids |
