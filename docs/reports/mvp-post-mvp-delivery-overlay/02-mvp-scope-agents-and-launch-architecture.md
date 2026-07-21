# Report 02 — MVP Scope, Agents and Launch Architecture

**Date:** 2026-07-22. **Documentation only — no implementation; no migration/SQL; no external access.** Source: [qf-jarvis-mvp-post-mvp-delivery-overlay.md](../../architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md), [mvp-capability-activation-matrix.md](../../governance/mvp-capability-activation-matrix.md).

## MVP agents (canonical, provider-independent)

- **Jarvis (MVP):** conversation routing, policy enforcement, task/case coordination, memory/RAG coordination, model-provider selection, approval routing, human handoff, supervision, monitoring, evaluation metadata, audit evidence. **Does not** independently authorize payments, refunds, verification, package activation, entitlements, destructive actions, or policy exceptions.
- **Riya (MVP)** — Customer Conversation and Qualification Agent: AI disclosure, consent/opt-out, English + Hinglish, text-only WhatsApp, identification, requirement collection, city/area, property/project type, budget, timeline, qualification, FAQ, follow-up, appointment assistance, complaints, support cases, handoff, satisfaction. **Must not** guarantee availability/price/completion, invent live facts, authorize financial actions, or modify lead allocation.
- **Anisha (MVP)** — Vendor Sales, Relationship and Success Agent, **complete vendor lifecycle**: prospecting, qualification, business details, category/service area, package explanation/recommendation, objection handling, follow-up, approved-offer presentation, policy-bounded negotiation, payment-workflow initiation, onboarding, profile/portfolio/verification prep, lead-process education, support, complaints, renewal, resale, upsell/cross-sell, retention, reactivation, satisfaction, handoff. **Must not** invent prices/discounts, guarantee leads/revenue, activate packages, change credits/entitlements, verify vendors, execute refunds, or change payment records.

## Launch architecture (MVP)

- **WhatsApp runtime:** text-only; webhook verification; inbound dedup; fast acknowledgement; durable queue; per-conversation ordering; short-message bundling; inference worker; delayed delivery; outbound idempotency; delivery reconciliation; opt-out; AI pause; human takeover; provider-outage handling. **The synchronous ack path must not depend on projection completion.**
- **Model inference:** `GROQ_CLOUD` active launch profile; `HUMAN_ONLY` emergency; `LOCAL_PC` / `HYBRID_LOCAL_PRIMARY` / `HYBRID_GROQ_PRIMARY` future-compatible but **inactive**. Agents/memory/WhatsApp/Core contracts remain provider-independent.
- **RAG + pgvector (MVP):** namespaces `JARVIS`/`RIYA`/`ANISHA`; lifecycle `DRAFT→UNDER_REVIEW→APPROVED→ACTIVE→SUPERSEDED→RETIRED→REJECTED`; approved knowledge for services/process/onboarding/packages/objections/lead-education/payment-refund-policy/consent/handoff/boundaries. **RAG is not authoritative** for live price, payment/refund status, credits, subscription, entitlement, verification, active offer, or live availability. **Authority order:** Core verified fact → approved deterministic rule → approved RAG → model wording.
- **Memory (MVP):** conversation state, bounded recent context, rolling summary, structured customer/vendor facts, Core-verified facts, approved preferences, human corrections, prompt/knowledge/provider-model-adapter versions; provenance `USER_CLAIMED/MODEL_INFERRED/CORE_VERIFIED/HUMAN_CORRECTED/SUPERSEDED`.
- **Vendor sales & negotiation (MVP):** model recommends/communicates; a **deterministic commercial-policy engine** controls approved packages, published prices, eligible offers, discount bands, approval levels, payment terms, expiry, and prohibited commitments; exceptions require human approval.
- **Payment/refund (MVP, authority-controlled):** status inquiry, approved instruction, support/refund cases, reference collection, approval routing, verified-result communication; **Core/payment systems execute and record financial outcomes; agents never move money**.
- **Controlled-learning foundation (MVP):** raw → consent/retention → PII masking → candidate detection → human review → corrected answer → approved dataset → evaluation → optional training → shadow/canary → controlled promotion. **Raw conversations never auto-train/alter prompts/RAG/rules/production.**
- **LoRA/fine-tuning foundation (MVP):** dataset pipeline, human-reviewed examples, versioning, model registry, training workflow, eval comparison, shadow, canary, rollback. Launch: Groq base `ACTIVE`; Riya/Anisha LoRA `SHADOW`/`NOT_YET_TRAINED`; local custom `INTERNAL_TEST`/`DISABLED`. **Production LoRA not required for launch.**
- **Human control (MVP):** handoffs, complaints, negotiations, package exceptions, payments, refunds, case assignment, take ownership, approve/reject, resolve, pause/resume AI. **Takeover stops automatic replies.**
- **Analytics (MVP, focused):** operations, agents, conversations, qualification, vendor funnel, offers, negotiation, payment/refund cases, RAG/model quality, human correction, latency, failures, cost, handoff backlog. **Marketing analytics excluded.**
- **Resilience (MVP):** one active + one warm-standby region, backup, restore, health checks, deployment rollback, Groq kill switch, human-only switch, queue recovery, tested failover runbook. **Active-active excluded.**

## Verdicts

- MVP agents = **Jarvis + Riya + Anisha** (canonical, provider-independent). ✅
- RAG/pgvector, memory, controlled-learning foundation, LoRA/fine-tuning foundation, negotiation/payment/refund workflows (authority-controlled), active + warm standby = **MVP**. ✅
- Groq = **active launch profile**; local/hybrid = **inactive at launch**. ✅
- No agent receives financial/commercial/administrative/destructive authority; Core authoritative. ✅
