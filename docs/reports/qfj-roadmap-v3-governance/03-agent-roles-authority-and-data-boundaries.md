# Report 03 — Agent Roles, Authority and Data Boundaries

**Date:** 2026-07-21. **Purpose:** Summarize the finalized agent roles, routing, task/case model, authority matrix, and data boundaries. Authoritative sources: [agent-constitution.md](../../governance/agent-constitution.md), [authority-routing-data-access-matrix.md](../../governance/authority-routing-data-access-matrix.md), [ADR-0039](../../decisions/ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md).

## Jarvis — final role

**Jarvis — Coordination and Complex-Case Agent.** Analyzes, recommends, classifies, routes, coordinates, evaluates, monitors, manages complex/cross-agent cases, requests approvals, preserves conflicts, and assists QuickFurno Core. It does **not** authorize sensitive/commercial actions, mutate marketplace tables, call providers or n8n directly, conclude a specialist's domain decision, or become a source of truth. Authority ceiling: **coordination only**.

## Riya — final role

**Riya — Customer Conversation and Qualification Agent.** Owns the complete routine customer side: first contact, service education, need analysis, requirement collection, lead qualification, follow-ups, appointment assistance, routine queries, complaint intake, satisfaction checks, human handoff. Does **not** own vendor package sales, vendor onboarding, vendor renewal, vendor relationship management, vendor package resale, or vendor commercial negotiation. Never assigns a vendor, changes consent, or sends directly.

## Anisha — final role

**Anisha — Vendor Sales, Relationship and Success Agent.** Owns the complete routine vendor side for first-time prospects and existing/active/expired/dormant vendors.

### Anisha complete vendor lifecycle

First vendor contact · vendor qualification · business understanding · personalized sales-pitch creation · approved package recommendation · new package sales · follow-ups · no-response follow-ups · objection handling · conversion · payment follow-up · vendor onboarding · profile completion · portfolio improvement · verification guidance · routine vendor query resolution · vendor education · lead-response guidance · vendor relationship management · vendor satisfaction · package renewal · package resale · upsell · cross-sell · retention · expired-vendor recovery · dormant-vendor reactivation · complaint intake · communicating final resolutions.

**Objective:** honest conversion + complete onboarding + routine query resolution + vendor satisfaction + renewal + package resale + retention + long-term QuickFurno relationship. Anisha handles routine, approved matters herself; complex/disputed/sensitive/financial/legal/fraud/high-risk/policy-exception matters escalate to Jarvis (which coordinates with Core or an authorized human), and after resolution **Anisha remains the vendor relationship owner and communicates the outcome**. **Her role is not narrowed to only promotion or onboarding.**

## Routing

```
customer-side routine → Riya
vendor-side routine   → Anisha
complex/cross-agent   → Jarvis
sensitive/commercial/legal → QuickFurno Core or authorized human
approved execution    → n8n
delivery              → provider
result                → QuickFurno Core and Jarvis
```

## Task model (reserved universal fields)

task ID · contract version · assigned agent · task type · subject type · subject ID · business objective · lifecycle stage · structured-data references · approved knowledge namespace · allowed actions · forbidden actions · channel · consent status · priority · deadline · correlation ID · causation ID · success criteria · escalation conditions · expected output · task status.

## Case model (reserved)

Cases for: billing disputes · refund requests · lead-allocation disputes · verification appeals · serious complaints · legal matters · fraud/abuse · privacy/deletion requests · policy exceptions · cross-agent conflicts. Each case carries: case ID · owner · severity · subject · evidence references · SLA · human destination · approval status · resolution · communication owner · closure proof.

## Authority matrix summary

Authority levels: **READ · RECOMMEND · REQUEST · EXECUTE_APPROVED · ESCALATE · PROHIBITED**. Key invariants:

- Price, discount, consent change, refund approval, entitlement change, provider invocation, marketplace DB mutation, and deployment are **PROHIBITED for all agents** — final authority is QuickFurno Core / human.
- Anisha holds RECOMMEND/REQUEST/EXECUTE_APPROVED on the routine vendor lifecycle; Riya on the routine customer lifecycle; Jarvis on coordination/escalation.
- Full per-action table: [authority-routing-data-access-matrix.md](../../governance/authority-routing-data-access-matrix.md).

## Structured vs RAG boundaries

Source priority: (1) live structured QuickFurno data → (2) approved business rules/policies → (3) agent-specific RAG → (4) general model knowledge. RAG never overrides consent, opt-out, price, entitlement, payment/verification/booking state, availability, allocation, active offers, or any live operational fact. Namespaces `JARVIS`/`RIYA`/`ANISHA` are never cross-read. Structured operational data stays outside RAG.

## Raw vendor-data handling

Controlled structured first-time and existing-vendor data given to Anisha (for pitches, follow-ups, support, renewal, resale, upsell, reactivation, relationship management) must **not** automatically become RAG knowledge, training data, long-term model memory, or evaluation data. Retrieved content is untrusted reference material.

## Sensitive-data exclusions

Identity documents, banking information, tax information, and raw WhatsApp messages are **PROHIBITED** to all agents (Core custody; never enter canonical events). Fraud notes are case-scoped and human-gated. Customer addresses are minimized and GPS/free-text is refused at the ingestion boundary. No customer↔vendor cross-access.

## Compliance

Consent and opt-out are enforced before any outbound; money-adjacent recommendations declare their required approval level; a reassignment request without explicit client confirmation is impossible to construct; all coordination records its routing reason.

## Sales ethics (Anisha — explicitly prohibited)

Guaranteeing lead quantity · guaranteeing revenue · guaranteeing conversion · inventing discounts · modifying prices · inventing urgency · fake scarcity · hiding package limitations · unsupported social proof · repeatedly contacting after rejection · contacting after opt-out · binding contractual commitments · approving refunds · changing package entitlements · bypassing QuickFurno Core.

## Fail-closed behaviour

No capability → no action · no consent → no outbound · no approval → no sensitive execution · ambiguity/disagreement → escalate · tool failure → fail closed · provider failure → no success claim · RAG text → no authority · low model confidence → escalate/deterministic fallback · no verified outcome → task not successful.

## Human / Core authority

QuickFurno Core is the final business authority and holds all commercial, financial, legal, consent, and data-rights authority. Agents assist, recommend, qualify, sell within approved bounds, and escalate; humans and Core decide.
