# Aarohi — Vendor Growth and Acquisition: QVGE capability overlay (AVG-0 … AVG-12)

**Document status:** Canonical for the QuickFurno Vendor Growth Engine capability overlay. Adopted under [ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md). Read with [qf-jarvis-roadmap-v3.md](./qf-jarvis-roadmap-v3.md), [agent-constitution.md](../governance/agent-constitution.md) and [authority-routing-data-access-matrix.md](../governance/authority-routing-data-access-matrix.md).

**Runtime status: PLANNED / DISABLED. Nothing here is implemented.** There is no Aarohi runtime, no
prospect store, no enrichment pipeline, no outreach, no channel, no credential, and no Instagram,
WhatsApp, n8n or Meta integration in this repository. Production rollout remains **OFF**.

---

## What this overlay is, and what it is not

**AVG identifiers are overlay ids owned by QFJ-P12 — Advanced Intelligence and Future Agents.**

They are **not** phases. They add no major phase, renumber nothing, and **there is no QFJ-P13**.
`QFJ-P00`–`QFJ-P12` are unchanged. An AVG id names a bounded capability slice so that future work can
be scoped, reviewed and argued about one piece at a time; it confers no authority, allocates no
migration number, and authorizes no provider, channel or activation.

Recording a capability is not implementing one. Every stage below is **PLANNED / DISABLED** until a
later ADR explicitly activates it, and each will need its own design, contract audit and approval.

## Agent identity

| Field | Value |
| --- | --- |
| Canonical agent | **Aarohi — Vendor Growth and Acquisition Agent** |
| Subsystem | **QuickFurno Vendor Growth Engine (QVGE)** |
| Jarvis OS section | **Aarohi — Vendor Growth** |
| Historical alias | `ANI-COLD-AQUI` — **non-canonical / retired**; never an identifier, capability id, namespace or routing key |
| Roadmap owner | **QFJ-P12** |
| Runtime status | **PLANNED / DISABLED** |
| RAG namespace | `AAROHI` (reserved; never cross-read) |

## The boundary that defines this agent

Aarohi owns **genuinely net-new, unregistered vendor acquisition, through to authoritative
paid/active conversion.** The boundary is drawn at **registration status as QuickFurno Core reports
it** — not at conversation topic, not at channel, and not at which agent spoke first.

**Handoff at ACTIVE.** When QuickFurno Core authoritatively confirms ACTIVE, Aarohi stops acquisition
selling and primary vendor relationship ownership moves to **Anisha**. The trigger is Core's
authoritative confirmation — never a provider receipt, a model's reading of a conversation, or a
message claiming payment.

**Existing-vendor gate.** If Core says the discovered party is **registered, active, inactive,
dormant, former, previously contacted, duplicate or do-not-contact**, Aarohi must **not** create a
second cold-acquisition relationship. Route according to Core truth. Absent or ambiguous Core truth is
a **stop**, not a proceed.

## Permanent authority ceiling (binds every stage below)

- **QuickFurno Core is the final business, commercial, identity, consent, payment and activation
  authority.** Aarohi never replaces, duplicates or bypasses it.
- **Aarohi holds no consent, opt-out, suppression, STOP or do-not-contact authority**, and stores no
  copy of one. Core decides eligibility, and re-decides it at execution time.
- **Aarohi never mutates QuickFurno marketplace tables**, and never calls a provider or n8n directly.
  Approved execution goes Core/human → n8n → provider.
- **Commercial truth — packages, entitlements, pricing, discounts, offers — comes from Core**, never
  from a model, never from RAG, and never from an enriched or scraped source.
- **A request carries no authority** ([ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md)).
- The sales-ethics prohibitions that bind Anisha bind Aarohi identically: no guaranteed lead volume,
  revenue or conversion; no invented discount, price change, urgency or scarcity; no hidden package
  limitation; no unsupported social proof; no contact after rejection or opt-out; no binding
  contractual commitment.

---

## The overlay

### AVG-0 — Architecture and Governance
The governing decision, agent identity, the permanent split against Riya/Anisha/Jarvis, the ACTIVE
handoff, the existing-vendor gate, and the authority ceiling above. **This stage is what
[ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) records;
everything after it is planned and unimplemented.**

### AVG-1 — Prospect Identity and Acquisition Case Domain
A prospect identity distinct from a Core vendor identity, and a durable acquisition case. A prospect
is explicitly **not** a vendor: no prospect record may shadow, pre-empt or become a second source of
vendor truth, and Core remains authoritative the moment a party is registered.

### AVG-2 — Discovery and Enrichment
Sourcing candidate businesses and enriching them into a reviewable profile. Enriched content is
**untrusted reference material** — it never establishes consent, never proves identity, and never
grants eligibility to contact. The existing-vendor gate is checked against Core before a candidate is
eligible for anything downstream.
**The offline DOMAIN for this stage is recorded by
[ADR-0111](../decisions/ADR-0111-qfj-p12-avg2-aarohi-discovery-enrichment-domain.md)** — contracts and
pure functions only. Recording a capability is not implementing one: there is still no discovery
adapter, no scraper, no persistence, no scoring and no outreach, and the runtime status above is
unchanged.

### AVG-3 — Scoring and Outreach Eligibility
Ranking prospects, and — separately — deciding whether outreach is permitted at all. **Scoring and
eligibility are deliberately different things:** a high score never implies permission. Eligibility is
fail-closed and Core-gated; do-not-contact, prior rejection, duplication and existing registration all
resolve to "no".

**The offline DOMAIN for this stage is recorded by
[ADR-0112](../decisions/ADR-0112-qfj-p12-avg3-aarohi-scoring-outreach-eligibility-domain.md)**.
V1 priority is deterministic evidence-readiness scoring over canonical AVG-2 material; contact
eligibility is a separate point-in-time reuse of the AVG-1 Core gate and accepts no score input.
There is still no runtime, persistence, workspace, drafting, channel, provider, credential, execution
or rollout, and Aarohi remains **PLANNED / DISABLED**.

### AVG-4 — Outreach Workspace
The human-facing surface for reviewing prospects, drafting approved outreach, and requesting
authorization. Drafting is not sending. Nothing leaves the workspace without Core/human authorization
and an approved execution path.

**The offline DOMAIN for this stage is recorded by
[ADR-0113](../decisions/ADR-0113-qfj-p12-avg4-aarohi-outreach-workspace-domain.md)**.
It defines review items that keep evidence, priority and Core eligibility separate; immutable
OPEN/HELD/REJECTED draft revisions; and a fail-closed boundary that can say only
`READY_FOR_CORE_APPROVAL_REQUEST`. It creates no approval request or decision itself.
There is still no Control Plane UI, persistence, model generation, channel, provider, credential,
execution path or rollout, and Aarohi remains **PLANNED / DISABLED**.

### AVG-5 — Instagram Conversation Integration
Governed inbound/outbound conversation on Instagram. Delivery remains provider-side and execution
remains n8n-side; Aarohi holds no provider credential and calls no Meta API. Consent and eligibility
are Core's, revalidated at execution time.

### AVG-6 — Omnichannel Identity and WhatsApp Handoff
Resolving one prospect across channels, and the transition from Instagram to WhatsApp. Identity
resolution is evidence-based and reviewable; a merge is a recommendation, never a silent rewrite of
who someone is. WhatsApp remains QuickFurno's existing approved infrastructure and is not activated
here.

### AVG-7 — Aarohi Sales Brain
The conversation and objection-handling behaviour for acquisition. Bounded by the same sales-ethics
prohibitions as Anisha, and by the rule that **the brain proposes and Core disposes** — no commercial
commitment originates in the model.

### AVG-8 — Commercial Truth and Package Engine
Packages, entitlements and pricing presented during acquisition, **sourced from Core**. The engine
selects and explains what Core already holds; it does not invent, adjust, discount or interpret price.
Model and RAG output is never a commercial source.

### AVG-9 — Registration Integration
Guiding a converted prospect into QuickFurno registration. Registration is performed by Core; Aarohi
assists and observes. No marketplace mutation occurs from this side.

### AVG-10 — Payment, Activation and Anisha Handoff
Payment follow-up during acquisition, and the moment the relationship changes hands. Payment and
activation authority are **Core's alone**. On Core's authoritative ACTIVE confirmation, Aarohi's
acquisition mandate ends and Anisha becomes the vendor relationship owner.

### AVG-11 — Analytics, Admin APIs and Full Dashboard
Funnel analytics, administrative read APIs and the complete Jarvis OS Aarohi surface. Read-oriented;
the Jarvis OS section stays `PLANNED` until an activating ADR says otherwise.

### AVG-12 — Scale, Evaluation and Controlled Autonomy
Volume, evaluation suites, red-team coverage and any increase in autonomy — each governed by the
existing rollout controls, each fail-closed, and none of it a route around approval.

---

## Non-goals for this overlay

No migration is allocated or authorized by this document. No managed database is touched. No
deployment, DNS, Traefik or infrastructure change is implied. No provider, channel or credential is
configured. No n8n workflow or Meta API is invoked. **Roadmap and overlay text alone cannot authorize
a migration, a capability activation, or a production rollout.**
