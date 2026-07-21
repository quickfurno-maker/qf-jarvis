# QF Jarvis — MVP and Post-MVP Delivery Overlay

**Status:** Canonical delivery overlay. **Not implementation.** Adopted 2026-07-22 under [ADR-0042](../decisions/ADR-0042-mvp-and-post-mvp-delivery-overlay-and-controlled-launch-sequencing.md). This overlay divides the complete QF Jarvis product into **two product-delivery phases** and maps every capability to its canonical [QFJ-P00…P12](./qf-jarvis-roadmap-v3.md) owner. It **does not** renumber, replace, or supersede Canonical Roadmap v3.0.

> **What this is.** A product-delivery view: what ships in the MVP launch vs. the Post-MVP expansion, with per-capability activation states, intra-Phase-1 milestones, canonical mapping, dependency/migration sequencing, and launch gates.
> **What this is not.** Runtime, adapters, migrations, or SQL — none exist. No external system is accessed. Migration 0006 remains absent. QFJ-P03.07 remains the active technical priority.

## The two product-delivery phases

- **PHASE 1 — MVP LAUNCH** (business priority).
- **PHASE 2 — POST-MVP EXPANSION** (deferred, not cancelled).

These are **product-delivery phases, not QFJ phases.** Every capability remains owned by its canonical QFJ phase (see [§ Canonical phase mapping](#canonical-phase-mapping)).

---

## PHASE 1 — MVP LAUNCH scope

### 1. Jarvis (MVP)

**Owns:** conversation routing · policy enforcement · task and case coordination · memory coordination · RAG coordination · model-provider selection · approval routing · human handoff · supervision · monitoring · evaluation metadata · audit evidence.
**Does NOT independently authorize:** payments · refunds · vendor verification · package activation · entitlements · destructive actions · business-policy exceptions.

### 2. Riya — Customer Conversation and Qualification Agent (MVP)

**Includes:** AI disclosure · consent and opt-out · English and Hinglish · text-only WhatsApp · customer identification · service requirement collection · city and area · property and project type · budget · timeline · qualification · QuickFurno FAQ · follow-up · appointment assistance · complaints · support cases · human handoff · customer satisfaction.
**Must NOT:** guarantee vendor availability · guarantee price or completion · invent live business facts · authorize financial actions · modify lead allocation.

### 3. Anisha — Vendor Sales, Relationship and Success Agent (MVP, complete vendor lifecycle)

**Includes:** prospect identification · vendor qualification · business details · category and service area · package explanation · package recommendation · objection handling · follow-up · approved offer presentation · package negotiation through policy · payment workflow initiation · onboarding · profile completion · portfolio guidance · verification preparation · lead-process education · support · complaints · renewal · resale · upsell and cross-sell · retention · reactivation · satisfaction · human handoff.
**Must NOT independently:** invent prices · invent discounts · guarantee leads or revenue · activate packages · change credits · modify entitlements · verify vendors · execute refunds · change payment records.

### 4. WhatsApp runtime (MVP)

Text-only WhatsApp · webhook verification · inbound deduplication · fast acknowledgement · durable queue · per-conversation ordering · short-message bundling · inference worker · delayed delivery · outbound idempotency · delivery reconciliation · opt-out · AI pause · human takeover · provider-outage handling.
**Invariant:** the synchronous WhatsApp acknowledgement path must **not** depend on projection completion.

### 5. Model inference (MVP)

- `GROQ_CLOUD` = **active launch profile**.
- `HUMAN_ONLY` = **emergency profile** (always available).
- `LOCAL_PC`, `HYBRID_LOCAL_PRIMARY`, `HYBRID_GROQ_PRIMARY` = **future-compatible but inactive** at launch.

Riya, Anisha, memory, WhatsApp, and Core contracts remain **provider-independent** ([model-provider-independence.md](./model-provider-independence.md)). Model providers perform bounded inference only; communication providers deliver approved messages only; neither has business authority.

### 6. RAG and pgvector (MVP)

Namespaces: `JARVIS`, `RIYA`, `ANISHA`. Knowledge lifecycle: `DRAFT → UNDER_REVIEW → APPROVED → ACTIVE → SUPERSEDED → RETIRED → REJECTED`.
**Approved knowledge for:** QuickFurno services · customer process · vendor process · onboarding · package explanations · objection handling · lead-process education · payment/refund policy explanations · consent · handoff · agent boundaries.
**RAG is NOT authoritative for:** live price · payment status · refund status · credits · subscription · entitlement · vendor verification · active offer · live vendor availability.
**Authority order:** QuickFurno Core verified fact → approved deterministic rule → approved RAG knowledge → model-generated wording.

### 7. Memory (MVP)

Conversation state · recent bounded context · rolling summary · structured customer facts · structured vendor facts · Core-verified facts · approved preferences · human corrections · prompt version · knowledge version · provider/model/adapter version.
**Fact provenance:** `USER_CLAIMED · MODEL_INFERRED · CORE_VERIFIED · HUMAN_CORRECTED · SUPERSEDED`. Memory is provider-independent; models are not authoritative memory.

### 8. Vendor sales and negotiation (MVP)

Full vendor-sales conversations are in scope; the model may communicate and recommend. A **deterministic commercial-policy engine** controls: approved packages · published prices · eligible offers · discount bands · approval levels · payment terms · expiry · prohibited commitments. Complex or exceptional commercial terms require **human approval**.

### 9. Payment and refund workflows (MVP, authority-controlled)

Payment-status inquiry · approved payment instruction · payment-support case · transaction-reference collection · failed-payment support · refund request · refund-policy explanation · refund case · approval routing · verified-result communication. **QuickFurno Core / payment systems execute and record authoritative financial outcomes; agents never directly move money.**

### 10. Controlled learning (MVP foundation)

`raw conversation → consent and retention check → PII masking → training-candidate detection → human review → corrected reference answer → approved dataset → evaluation → optional model training → shadow/canary → controlled promotion`.
**Raw conversations must never automatically:** train production models · change prompts · alter RAG · change business rules · change production behaviour.

### 11. Fine-tuning and LoRA (MVP foundation; production activation NOT required)

Foundation in MVP: anonymized dataset pipeline · human-reviewed examples · dataset versioning · model registry · training workflow · evaluation comparison · shadow deployment · canary controls · rollback.
**MVP launch state:** approved Groq base model = `ACTIVE`; Riya LoRA = `SHADOW` or `NOT_YET_TRAINED`; Anisha LoRA = `SHADOW` or `NOT_YET_TRAINED`; local custom model = `INTERNAL_TEST` or `DISABLED`. **Production LoRA activation is not an MVP launch requirement.**

### 12. Human control (MVP, minimal operator capability)

Handoffs · complaints · negotiations · package exceptions · payments · refunds · case assignment · take ownership · approve/reject · resolve · pause AI · resume AI. **Human takeover must stop automatic replies.**

### 13. Analytics (MVP, focused)

Jarvis operations · Riya · Anisha · conversations · qualification · vendor funnel · offers · negotiation · payment/refund cases · RAG quality · model quality · human correction · latency · failures · cost · handoff backlog. **Marketing analytics are NOT MVP scope.**

### 14. Resilience (MVP)

One active primary region · one warm standby region · backup · restore · health checks · deployment rollback · Groq kill switch · human-only switch · queue recovery · tested failover runbook. **Active-active multi-region is NOT MVP scope.**

---

## PHASE 2 — POST-MVP EXPANSION scope

1. **Advanced specialist agents** — marketing campaign · SEO · Google Business · Meta/Instagram · YouTube · content · lead-nurture · finance-operations · fraud/risk · compliance/privacy · quality-assurance · knowledge-curation · model-evaluation · analytics/forecasting · operations/incident · future approved specialists.
2. **Local and hybrid inference activation** — local RTX provider · local OpenAI-compatible inference · local-primary routing · Groq-primary routing · capability-aware fallback · privacy-aware routing · cost-aware routing · circuit breakers · multiple inference nodes · multi-GPU scheduling.
3. **Production custom models** — production Riya LoRA · production Anisha LoRA · specialist adapters · local fine-tuning · model promotion · canary · rollback · governed dataset expansion.
4. **Advanced RAG** — hybrid retrieval · reranking · semantic cache · knowledge-gap detection · document ingestion · citations · temporal/effective-date policy · regional knowledge · multilingual knowledge · automated draft suggestions with human approval.
5. **Voice, image and document** — voice notes · speech-to-text · text-to-speech · voice calling · image understanding · OCR · document extraction · quotation/invoice parsing · portfolio analysis.
6. **Advanced commercial automation** — advanced negotiation · dynamic approved offers · churn prediction · retention optimization · payment-risk classification · policy-bounded refund automation · fraud detection · revenue forecasting.
7. **Advanced marketing agents** — entirely Post-MVP. **No marketing campaign execution, SEO automation, Google/Meta/YouTube automation, advertising-spend control, or marketing analytics in MVP.**
8. **Advanced analytics** — forecasting · cohort analysis · CLV/VLV · churn · geographic demand · anomaly detection · model trends · executive summaries · finance analytics · marketing attribution.
9. **Active-active multi-region** — global traffic routing · multiple active regions · global deduplication · cross-region conversation ownership · distributed locking · queue coordination · conflict resolution · automated failover · duplicate-response prevention.
10. **Advanced Jarvis autonomy** — multi-agent planning · long-running workflows · specialist delegation · approval-aware autonomous execution · incident remediation · capacity optimization · continuous evaluation · policy-bounded automation.

---

## Activation model

Capability states: `DISABLED · SHADOW · HUMAN_APPROVAL · LIMITED_AUTONOMY · FULLY_ACTIVE · SUSPENDED`. Every MVP capability is documented with its initial activation state, activation owner, required approval, kill switch, rollback, evaluation gate, and authority boundary in [mvp-capability-activation-matrix.md](../governance/mvp-capability-activation-matrix.md). **A capability being implemented does not imply it is fully autonomous.**

## MVP milestones — NOT additional phases

Milestones inside **Phase 1** (not QFJ phases, not product phases):

- **M0 — Governance and dependency readiness:** overlay merged · QFJ-P03.07B complete · QFJ-P03.07C complete · migration 0006 created through separate authorization · Core authority contracts frozen · MVP agent capability matrix frozen.
- **M1 — Model and conversation foundation:** provider-neutral contracts · fake provider · Groq adapter · prompt assets · strict output · conversation state · durable queue · human-only fallback.
- **M2 — Riya and Anisha internal alpha:** Riya workflows · Anisha workflows · templates · field extraction · handoff · synthetic/internal conversations.
- **M3 — RAG, memory and Core integration:** pgvector · knowledge lifecycle · memory · Core read/write contracts · audit and consent.
- **M4 — Commercial pilot:** package recommendation · negotiation policy · approvals · payment cases · refund cases · renewal/upsell/retention.
- **M5 — Controlled production launch:** analytics · operational runbooks · warm standby · recovery test · security/evaluation gates · limited live users · human monitoring.

**These milestones must not be interpreted as new canonical QFJ phases.**

## Canonical phase mapping

| Capability | Product phase | QFJ owner | Dependency | Launch activation state | Authority boundary | Evaluation gate | Persistence / migration implication |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Model gateway | MVP | QFJ-P04.01 | QFJ-P03 integrity | FULLY_ACTIVE (Groq) | infra; authorizes nothing | QFJ-P04.04 | none |
| Provider adapters (Groq active; local/hybrid inactive) | MVP (Groq) / Post-MVP (local/hybrid) | QFJ-P04.01A–E | gateway | Groq FULLY_ACTIVE; local/hybrid DISABLED | no business authority | QFJ-P04.04 | none |
| Capability registry | MVP | QFJ-P04.02 | gateway | FULLY_ACTIVE | bounded capabilities only | QFJ-P04.04 | none |
| Governed RAG + pgvector | MVP | QFJ-P04.03 | gateway; Supabase pgvector | LIMITED_AUTONOMY (approved knowledge only) | non-authoritative reference | QFJ-P04.04 | future migration after 0006, separately authorized |
| Evaluation / red-team | MVP | QFJ-P04.04 | gateway | FULLY_ACTIVE | gate, not actor | self | none |
| RAG provisioning | MVP | QFJ-P04.05 | RAG | LIMITED_AUTONOMY | non-authoritative | QFJ-P04.04 | future migration after 0006 |
| Jarvis orchestration | MVP | QFJ-P05 | QFJ-P04 | LIMITED_AUTONOMY | no business authority | QFJ-P04.04 | none |
| Riya | MVP | QFJ-P06 | QFJ-P05 | HUMAN_APPROVAL → LIMITED_AUTONOMY | customer-only; no financial | QFJ-P04.04 | none |
| Anisha | MVP | QFJ-P07 | QFJ-P05 | HUMAN_APPROVAL → LIMITED_AUTONOMY | vendor-only; no price/entitlement | QFJ-P04.04 | none |
| Consent / approval / human control | MVP | QFJ-P08 | QFJ-P05 | FULLY_ACTIVE | enforces authority | self | none |
| WhatsApp / execution lifecycle | MVP | QFJ-P09 | QFJ-P08 | LIMITED_AUTONOMY | delivery only via n8n | QFJ-P04.04 | none (queue durable) |
| QuickFurno Core integration | MVP | QFJ-P10 | QFJ-P09; Core remediation | LIMITED_AUTONOMY | Core is authority | QFJ-P04.04 | none in Jarvis repo |
| Deployment / pilot / resilience (active + warm standby) | MVP | QFJ-P11 (+ QFJ-P11.06 profiles) | QFJ-P10 | LIMITED_AUTONOMY | ops-gated | self | none |
| Advanced agents / local intelligence / active-active | Post-MVP | QFJ-P12 (+ QFJ-P11 active-active) | MVP live | DISABLED | future ADR to activate | QFJ-P04.04 | own authorized design |

Each mapped item preserves its canonical QFJ owner; the overlay only assigns a product phase and a launch activation state.

## P03 and migration sequencing

1. **QFJ-P03.07A is merged and locked.**
2. **QFJ-P03.07B is the next implementation slice.**
3. **QFJ-P03.07C owns migration 0006.**
4. Migration 0006 must **not** be reused for RAG, agents, tasks, memory, WhatsApp, model gateway, Core integration, or analytics.
5. **This overlay does not authorize migration 0006.**
6. QFJ-P03.07C requires separate implementation authorization.
7. RAG and conversation persistence use the **next valid migration number only after 0006**, and only under their own authorized design.
8. **Migration 0007 is not created by this documentation task.**
9. QFJ-P03.07D–G remain required and are not cancelled.
10. MVP work may begin after the required dependency gates, but **public launch must pass an event-backbone dependency audit**.
11. When the customer-facing critical path relies on projections or event-driven execution, the required P03 failure-operation implementation must be complete **before** production activation.
12. **The synchronous WhatsApp acknowledgement path must not depend on projection completion.**

## MVP launch gates (measurable)

| Gate | Target |
| --- | --- |
| Strict response-schema validation | 100% |
| Unauthorized financial/commercial actions | 0 |
| Duplicate accepted outbound reply | 0 |
| Inbound message deduplication | 100% |
| Opt-out enforcement | 100% |
| Human takeover stops AI | 100% |
| Secret leakage | 0 |
| Provider-output validation | 100% |
| Accepted inbound-message durability | 100% |
| Payment/refund execution only through authority boundary | 100% |
| LOCAL_ONLY never uses hosted inference | 100% |
| RAG uses only approved active knowledge | 100% |
| Raw conversations never automatically train production | 100% |
| Rollback tested | yes |
| Groq kill switch tested | yes |
| HUMAN_ONLY tested | yes |
| Warm-standby recovery tested | yes |
| Critical unresolved security incident | none |
| Owner-approved limited-production cohort | required |

**No launch date is promised in repository governance.** Full readiness procedure: [mvp-launch-readiness-runbook.md](../operations/mvp-launch-readiness-runbook.md).

## Boundaries preserved

Event-backbone invariants unchanged; QuickFurno Core is the final business authority; Riya/Anisha/Jarvis hold no unrestricted financial, commercial, administrative, or destructive authority; no migration authorized; migration 0006 absent; no implementation performed.
