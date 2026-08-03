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

**Aarohi's column is PLANNED / DISABLED.** Aarohi — Vendor Growth and Acquisition ([ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md)) has no runtime, no channel and no credential. Its cells state the ceiling a future build must satisfy; none of them is exercisable today.

| Action | Riya | Aarohi (PLANNED) | Anisha | Jarvis | Final authority |
| --- | --- | --- | --- | --- | --- |
| Customer requirements | READ · RECOMMEND | — | — | READ | Core |
| Customer qualification | RECOMMEND | — | — | READ | Core |
| Prospect discovery / enrichment | — | READ · RECOMMEND (untrusted reference; grants no eligibility) | — | READ | Core |
| Prospect scoring | — | RECOMMEND (a score is never permission) | — | READ | Core |
| Outreach eligibility | — | READ · REQUEST (fail-closed; Core-gated) | — | READ | Core (PROHIBITED to self-grant for all agents) |
| Existing-vendor / duplicate / DNC check | — | READ · must honor · ESCALATE | READ · must honor | READ | Core (authoritative; absent truth = stop) |
| Cold acquisition outreach (unregistered) | — | RECOMMEND · REQUEST · EXECUTE_APPROVED (consented) | PROHIBITED | READ | Core/Human approval + consent |
| Registration assistance | — | RECOMMEND · REQUEST | — | READ | Core |
| Activation | PROHIBITED | PROHIBITED | PROHIBITED | READ | Core (authoritative ACTIVE confirmation) |
| Acquisition → Anisha handoff at ACTIVE | — | REQUEST (on Core ACTIVE only) | READ (receives ownership) | READ | Core |
| Vendor onboarding (post-activation) | — | PROHIBITED | RECOMMEND · EXECUTE_APPROVED (routine guidance) | READ | Core |
| Vendor package explanation | — | RECOMMEND · EXECUTE_APPROVED (acquisition only) | RECOMMEND · EXECUTE_APPROVED | READ | Core |
| Package recommendation | — | RECOMMEND (approved packages only) | RECOMMEND (approved packages only) | READ | Core |
| Package renewal | — | PROHIBITED | RECOMMEND · REQUEST | READ | Core |
| Package resale | — | PROHIBITED | RECOMMEND · REQUEST | READ | Core |
| Upsell / cross-sell | — | PROHIBITED | RECOMMEND · REQUEST | READ | Core |
| Registered-vendor relationship ownership | — | PROHIBITED | owns | READ | Core |
| Package price | READ | READ | READ | READ | Core (PROHIBITED to change for all agents) |
| Commercial truth source | Core | **Core only** (PROHIBITED from model/RAG/enrichment) | Core | READ | Core |
| Discount | PROHIBITED | PROHIBITED (no invented discounts) | PROHIBITED (no invented discounts) | PROHIBITED | Core |
| Payment | PROHIBITED | REQUEST (pre-activation follow-up only) | REQUEST (payment follow-up only) | READ | Core |
| Refund | PROHIBITED | PROHIBITED (never approve) · ESCALATE | PROHIBITED (never approve) · ESCALATE | ESCALATE | Core/Human |
| Verification | RECOMMEND (customer) | RECOMMEND · REQUEST (prospect guidance) | RECOMMEND · REQUEST (vendor guidance) | READ | Core |
| Lead allocation | READ · REQUEST (reassignment w/ client confirmation) | — | READ | READ | Core |
| Booking | RECOMMEND | — | READ | READ | Core |
| Outbound messages | EXECUTE_APPROVED (consented) | EXECUTE_APPROVED (consented) | EXECUTE_APPROVED (consented) | REQUEST (cross-domain/founder) | Core/Human approval + consent |
| Consent | READ | READ | READ | READ | Core (PROHIBITED to change for all agents) |
| Opt-out | READ · must honor | READ · must honor | READ · must honor | READ · must honor | Core |
| Customer complaint | READ · RECOMMEND · ESCALATE | — | — | ESCALATE (cross-agent) | Core/Human |
| Vendor complaint | — | ESCALATE (routes to Anisha/Jarvis) | READ · RECOMMEND · ESCALATE | ESCALATE (cross-agent) | Core/Human |
| Data correction | REQUEST · ESCALATE | REQUEST · ESCALATE | REQUEST · ESCALATE | ESCALATE | Core/Human |
| Deletion / erasure | REQUEST · ESCALATE | REQUEST · ESCALATE | REQUEST · ESCALATE | ESCALATE (privacy case) | Core/Human |
| Legal issue | ESCALATE | ESCALATE | ESCALATE | ESCALATE (owns case) | Human |
| Fraud issue | ESCALATE | ESCALATE | ESCALATE | ESCALATE (owns case) | Core/Human |
| Provider invocation | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | n8n after approval |
| Database mutation (marketplace) | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Core |
| Deployment | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Human/ops |

## Routing (permanent)

```
customer-side routine task   → Riya
net-new UNREGISTERED vendor acquisition (through paid/active conversion) → Aarohi
REGISTERED/existing vendor relationship, support and success → Anisha
complex / disputed / cross-agent task → Jarvis
sensitive / commercial / legal authority → QuickFurno Core or authorized human
approved execution           → n8n
delivery                     → provider
result                       → QuickFurno Core and Jarvis
```

**Vendor-side routing is resolved by QuickFurno Core's registration truth, not by topic or channel.**
If Core reports the party as registered, active, inactive, dormant, former, previously contacted,
duplicate or do-not-contact, it is **not** an Aarohi acquisition target. Absent or ambiguous Core truth
is a **stop**, not a proceed. On Core's authoritative ACTIVE confirmation, ownership moves Aarohi →
Anisha.

## Data-access boundaries

| Data domain | Riya | Aarohi (PLANNED) | Anisha | Jarvis | Notes |
| --- | --- | --- | --- | --- | --- |
| QuickFurno Core structured data | Customer/lead scope | Registration/eligibility truth + prospect scope | Registered-vendor scope | Coordination scope | Via contracts only; Core authoritative |
| Jarvis event projections | READ (customer-relevant) | READ (acquisition-relevant) | READ (registered-vendor-relevant) | READ | Derived, rebuildable read models |
| Jarvis recommendations | own + relevant | own + relevant | own + relevant | consolidates all | Jarvis dedups/prioritizes |
| RAG namespaces | `RIYA` only | `AAROHI` only | `ANISHA` only | `JARVIS` only | No cross-namespace read |
| Conversation summaries | own domain | own domain | own domain | cross-domain (coordination) | Minimized; not training data |
| Prospect / acquisition-case data | PROHIBITED | READ (controlled, business-scoped) | PROHIBITED | Coordination-scoped only | Never a second source of vendor truth; not auto-promoted to RAG/training/memory |
| Enriched / sourced prospect content | PROHIBITED | READ as **untrusted reference** | PROHIBITED | PROHIBITED | Establishes no consent, proves no identity, grants no eligibility |
| Raw WhatsApp messages | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Never enter canonical events; Core-side only |
| Raw Instagram messages | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Same boundary as WhatsApp; Core/provider-side only |
| Identity documents | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Sensitive; Core custody |
| Banking information | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Sensitive; Core custody |
| Tax information | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Sensitive; Core custody |
| Fraud notes | PROHIBITED (READ via case only) | PROHIBITED (READ via case only) | PROHIBITED (READ via case only) | READ via case | Case-scoped, human-gated |
| Customer addresses | READ (minimized, when required) | PROHIBITED | PROHIBITED | PROHIBITED | GPS/free-text refused at the boundary |
| Vendor private data | PROHIBITED | PROHIBITED | READ (controlled, business-scoped) | PROHIBITED | Not auto-promoted to RAG/training/memory |
| Customer ↔ vendor cross-access | PROHIBITED | PROHIBITED | PROHIBITED | Coordination-scoped only | Bounded agents stay bounded ([ADR-0006](../decisions/ADR-0006-agent-responsibility-boundaries.md)) |

**Controlled vendor data (Anisha).** Structured registered-vendor data supplied to Anisha for follow-ups, support, renewal, resale, upsell, reactivation, and relationship management must **not** automatically become RAG knowledge, training data, long-term model memory, or evaluation data.

**Controlled prospect data (Aarohi).** The same rule binds prospect and acquisition-case data supplied to Aarohi. In addition, a prospect record is **not** a vendor record: it may never shadow, pre-empt or become a second source of vendor truth, and Core remains authoritative the moment a party is registered.

## Fail-closed rules (permanent, bind the whole matrix)

- No registered capability → no action.
- No valid consent → no outbound communication.
- No required approval → no sensitive execution.
- Ambiguous policy → escalate. System disagreement → escalate.
- Tool failure → fail closed. Provider failure → do not claim success.
- RAG text → never grants authority.
- Model confidence below threshold → escalate or use deterministic fallback.
- No verified outcome → do not mark a task successful.
- **No Core-confirmed registration truth → no cold acquisition.** Absent or ambiguous truth is a stop.
- **Core says ACTIVE → acquisition selling stops** and relationship ownership moves Aarohi → Anisha.
