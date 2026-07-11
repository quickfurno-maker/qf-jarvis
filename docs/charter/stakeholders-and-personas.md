# Stakeholders and Personas — QF Jarvis

**Status:** Phase 0 — in progress (pending review)
**Date:** 2026-07-11

---

## How to read this document

Three questions matter for every stakeholder:

1. **Do they receive recommendations?**
2. **Do they approve actions?** (Approval authority is granted by QuickFurno Core, never by Jarvis.)
3. **Do they see execution results?**

The summary table answers all three. The persona sections explain the human behind each row.

## Summary

| Stakeholder | Receives recommendations | Approves actions | Sees execution results |
| --- | --- | --- | --- |
| Keshav Sharma (Founder) | Yes — consolidated, prioritized | Yes — including all high-risk and money-related actions | Yes — summarized |
| QuickFurno administrators | Yes | Yes — within delegated policy limits | Yes |
| Operations team | Yes — lead quality and verification | Within delegated limits for low-risk operational actions | Yes — for their domain |
| Sales / vendor-acquisition team | Yes — vendor lifecycle | Within delegated limits; money-related vendor actions escalate | Yes — for their domain |
| Marketing team | Yes — campaign and channel | Proposes budget shifts; authorization escalates per policy | Yes — for their domain |
| Client-support team | Yes — client follow-up and reactivation | Within delegated limits for approved message templates | Yes — for their domain |
| Technical operators | System and platform alerts only | No business-action authority | Yes — technical execution telemetry |
| QuickFurno clients | No | No | No — they experience effects, not results |
| QuickFurno vendors | No | No | No — they experience effects, not results |
| Compliance / security responsibility | Audit and safety signals | No business-action authority; can block on policy grounds | Yes — full audit trail |

**Approval authority is always exercised inside QuickFurno Core.** Jarvis presents the recommendation; Core records who decided what, and when.

---

## Personas

### Keshav Sharma — Founder, final attention owner

The person the system exists for. Currently the escalation path for lead quality, vendor stalls, client silence, and marketing allocation all at once.

- **Wants:** to open one view, see what actually matters today, act, and move on.
- **Fears:** a system that generates fifty items a day, none of which he trusts.
- **Gets from Jarvis:** the consolidated priority view, founder briefings, proactive alerts on cross-domain risk, and final authority over high-risk and money-related actions.
- **Non-negotiable for him:** he can always ask "why?" and get evidence.

### QuickFurno administrators

Configure policy, manage delegated approval limits, and act as the operational control plane inside QuickFurno Core.

- **Get from Jarvis:** recommendations across domains, plus visibility into what policy would auto-authorize.
- **Own:** policy definitions in Core. Jarvis proposes; it never edits policy.

### Operations team

Handles lead verification and the day-to-day mechanics of getting a qualified lead ready for QuickFurno Core to assign.

- **Get from Jarvis (Kabir):** "verify this lead manually," "this lead shows fraud signals," "this lead is incomplete in a way that will hurt matching."
- **Do not:** perform assignment. QuickFurno Core assigns, subject to its own rules — including the maximum of three vendors per qualified lead.

### Sales / vendor-acquisition team

Brings vendors in and gets them to activation and beyond.

- **Get from Jarvis (Anisha):** onboarding nudges, profile-completion gaps, activation blockers, package-readiness and recharge recommendations, retention risk, win-back candidates.
- **Escalate:** anything touching wallet, package, or payment state — those are Core-owned and money-related.

### Marketing team

Owns campaigns, channels, creative, and spend.

- **Get from Jarvis (Jitin):** cost-per-verified-lead analysis by city and category, channel performance, creative fatigue, SEO opportunity, content recommendations, budget-shift proposals.
- **Note:** a budget-shift recommendation is a proposal. Authorization to change spend follows policy, and spend changes execute through n8n against the ad provider — never from Jarvis.

### Client-support team

The human voice to the client.

- **Get from Jarvis (Riya):** follow-up timing and channel recommendations, abandoned-requirement recovery, nurture and reactivation suggestions.
- **Approve:** outbound messages within approved templates and delegated limits; anything outside that escalates.

### Technical operators

Run the Jarvis platform: event processing, queues, retries, dead letters, latency, availability.

- **Get from Jarvis:** system and platform signals only. They have no business-action authority.
- **Own:** the health of the intelligence layer, not the decisions it produces.

### QuickFurno clients

People looking for interior design, carpentry, modular factories, premium interiors, sofa work, painting, or civil work — starting in Pune.

- **Relationship to Jarvis:** subjects, not users. They never interact with Jarvis. They may receive a message that originated as a Riya recommendation — but only after QuickFurno Core authorized it and n8n delivered it through an approved provider.

### QuickFurno vendors

Verified local professionals who receive qualified leads.

- **Relationship to Jarvis:** subjects, not users. A vendor may be the subject of an Anisha recommendation (activation, recharge, win-back) and may receive an authorized, executed communication as a result — but the vendor never sees Jarvis, and Jarvis never contacts them directly.
- **Business rule they rely on:** a qualified lead is shared with at most three suitable vendors. QuickFurno Core enforces this.

### Compliance and security responsibility

Currently held by the founder, delegable as the team grows.

- **Owns:** privacy posture, data retention, access control review, incident response, and the right to block an action or an automation promotion on policy grounds.
- **Gets from Jarvis:** the full audit trail — recommendation to approval to intent to execution to result — plus safety metrics ([success-metrics.md](./success-metrics.md)).

---

## Who approves what — the short version

- **Low-risk, reversible, within policy:** delegated team member, or (later, at Automation Level 4) an explicit policy.
- **Client- or vendor-facing communication:** an authorized human in the relevant team, within approved templates.
- **Money, wallet, package, payment, or ad spend:** stronger approval, escalating to the founder or an administrator with explicit authority.
- **Anything not covered by policy:** the founder.
- **Never:** an agent.
