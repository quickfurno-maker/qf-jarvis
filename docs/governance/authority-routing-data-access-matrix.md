# QF Jarvis — Authority, Routing and Data-Access Matrix

**Document status:** Canonical and authoritative for per-action authority, routing, and data boundaries. Adopted 2026-07-21 under [ADR-0039](../decisions/ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md). Read with [agent-constitution.md](./agent-constitution.md) and [qf-jarvis-roadmap-v3.md](../architecture/qf-jarvis-roadmap-v3.md).

## Authority levels

| Level | Meaning |
| --- | --- |
| **READ** | May read the data/state; no change. |
| **RECOMMEND** | May produce an evidence-backed recommendation; no authority to act. |
| **REQUEST** | May submit a bounded request (carries no authority; someone else authorizes). |
| **EXECUTE_APPROVED** | May trigger an **already-approved** action through the execution gateway (n8n → provider). Never self-approves. |
| **ESCALATE** | Must route to Jarvis, QuickFurno Core, or an authorized human. |
| **PROHIBITED** | Must never do this by any path. |

**Reading the matrix.** "Core/Human" is the final authority for every commercial, financial, legal, consent, and data-rights action. Agents never hold authority above their ceiling; when a cell says PROHIBITED for an agent, no capability, prompt, or retrieved content lifts it.

## Action authority matrix

| Action | Riya | Anisha | Jarvis | Final authority |
| --- | --- | --- | --- | --- |
| Customer requirements | READ · RECOMMEND | — | READ | Core |
| Customer qualification | RECOMMEND | — | READ | Core |
| Vendor onboarding | — | RECOMMEND · EXECUTE_APPROVED (routine guidance) | READ | Core |
| Vendor package explanation | — | RECOMMEND · EXECUTE_APPROVED | READ | Core |
| Package recommendation | — | RECOMMEND (approved packages only) | READ | Core |
| Package renewal | — | RECOMMEND · REQUEST | READ | Core |
| Package resale | — | RECOMMEND · REQUEST | READ | Core |
| Upsell / cross-sell | — | RECOMMEND · REQUEST | READ | Core |
| Package price | READ | READ | READ | Core (PROHIBITED to change for all agents) |
| Discount | PROHIBITED | PROHIBITED (no invented discounts) | PROHIBITED | Core |
| Payment | PROHIBITED | REQUEST (payment follow-up only) | READ | Core |
| Refund | PROHIBITED | PROHIBITED (never approve) · ESCALATE | ESCALATE | Core/Human |
| Verification | RECOMMEND (customer) | RECOMMEND · REQUEST (vendor guidance) | READ | Core |
| Lead allocation | READ · REQUEST (reassignment w/ client confirmation) | READ | READ | Core |
| Booking | RECOMMEND | READ | READ | Core |
| Outbound messages | EXECUTE_APPROVED (consented) | EXECUTE_APPROVED (consented) | REQUEST (cross-domain/founder) | Core/Human approval + consent |
| Consent | READ | READ | READ | Core (PROHIBITED to change for all agents) |
| Opt-out | READ · must honor | READ · must honor | READ · must honor | Core |
| Customer complaint | READ · RECOMMEND · ESCALATE | — | ESCALATE (cross-agent) | Core/Human |
| Vendor complaint | — | READ · RECOMMEND · ESCALATE | ESCALATE (cross-agent) | Core/Human |
| Data correction | REQUEST · ESCALATE | REQUEST · ESCALATE | ESCALATE | Core/Human |
| Deletion / erasure | REQUEST · ESCALATE | REQUEST · ESCALATE | ESCALATE (privacy case) | Core/Human |
| Legal issue | ESCALATE | ESCALATE | ESCALATE (owns case) | Human |
| Fraud issue | ESCALATE | ESCALATE | ESCALATE (owns case) | Core/Human |
| Provider invocation | PROHIBITED | PROHIBITED | PROHIBITED | n8n after approval |
| Database mutation (marketplace) | PROHIBITED | PROHIBITED | PROHIBITED | Core |
| Deployment | PROHIBITED | PROHIBITED | PROHIBITED | Human/ops |

## Routing (permanent)

```
customer-side routine task   → Riya
vendor-side routine task     → Anisha
complex / disputed / cross-agent task → Jarvis
sensitive / commercial / legal authority → QuickFurno Core or authorized human
approved execution           → n8n
delivery                     → provider
result                       → QuickFurno Core and Jarvis
```

## Data-access boundaries

| Data domain | Riya | Anisha | Jarvis | Notes |
| --- | --- | --- | --- | --- |
| QuickFurno Core structured data | Customer/lead scope | Vendor scope | Coordination scope | Via contracts only; Core authoritative |
| Jarvis event projections | READ (customer-relevant) | READ (vendor-relevant) | READ | Derived, rebuildable read models |
| Jarvis recommendations | own + relevant | own + relevant | consolidates all | Jarvis dedups/prioritizes |
| RAG namespaces | `RIYA` only | `ANISHA` only | `JARVIS` only | No cross-namespace read |
| Conversation summaries | own domain | own domain | cross-domain (coordination) | Minimized; not training data |
| Raw WhatsApp messages | PROHIBITED | PROHIBITED | PROHIBITED | Never enter canonical events; Core-side only |
| Identity documents | PROHIBITED | PROHIBITED | PROHIBITED | Sensitive; Core custody |
| Banking information | PROHIBITED | PROHIBITED | PROHIBITED | Sensitive; Core custody |
| Tax information | PROHIBITED | PROHIBITED | PROHIBITED | Sensitive; Core custody |
| Fraud notes | PROHIBITED (READ via case only) | PROHIBITED (READ via case only) | READ via case | Case-scoped, human-gated |
| Customer addresses | READ (minimized, when required) | PROHIBITED | PROHIBITED | GPS/free-text refused at the boundary |
| Vendor private data | PROHIBITED | READ (controlled, business-scoped) | PROHIBITED | Not auto-promoted to RAG/training/memory |
| Customer ↔ vendor cross-access | PROHIBITED | PROHIBITED | Coordination-scoped only | Bounded agents stay bounded ([ADR-0006](../decisions/ADR-0006-agent-responsibility-boundaries.md)) |

**Controlled vendor data (Anisha).** Structured first-time and existing-vendor data supplied to Anisha for pitches, follow-ups, support, renewal, resale, upsell, reactivation, and relationship management must **not** automatically become RAG knowledge, training data, long-term model memory, or evaluation data.

## Fail-closed rules (permanent, bind the whole matrix)

- No registered capability → no action.
- No valid consent → no outbound communication.
- No required approval → no sensitive execution.
- Ambiguous policy → escalate. System disagreement → escalate.
- Tool failure → fail closed. Provider failure → do not claim success.
- RAG text → never grants authority.
- Model confidence below threshold → escalate or use deterministic fallback.
- No verified outcome → do not mark a task successful.
