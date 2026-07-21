# Report 03 — Post-MVP Agents, Functions and Expansion Map

**Date:** 2026-07-22. **Documentation only — no implementation; no migration/SQL; no external access.** Source: [qf-jarvis-mvp-post-mvp-delivery-overlay.md](../../architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md).

## Post-MVP scope (deferred, not cancelled — all `DISABLED` at launch)

1. **Advanced specialist agents** — marketing campaign, SEO, Google Business, Meta/Instagram, YouTube, content, lead-nurture, finance-operations, fraud/risk, compliance/privacy, quality-assurance, knowledge-curation, model-evaluation, analytics/forecasting, operations/incident, future approved specialists → **QFJ-P12**.
2. **Local and hybrid inference activation** — local RTX provider, local OpenAI-compatible inference, local-/Groq-primary routing, capability-/privacy-/cost-aware routing, circuit breakers, multiple nodes, multi-GPU scheduling → **QFJ-P04.01C/D + QFJ-P12**.
3. **Production custom models** — production Riya/Anisha LoRA, specialist adapters, local fine-tuning, model promotion, canary, rollback, governed dataset expansion → **QFJ-P04.04 + QFJ-P12**.
4. **Advanced RAG** — hybrid retrieval, reranking, semantic cache, gap detection, document ingestion, citations, temporal/effective-date policy, regional & multilingual knowledge, automated draft suggestions with human approval → **QFJ-P04.03**.
5. **Voice, image and document** — voice notes, STT, TTS, voice calling, image understanding, OCR, document extraction, quotation/invoice parsing, portfolio analysis → **QFJ-P09 + QFJ-P12**.
6. **Advanced commercial automation** — advanced negotiation, dynamic approved offers, churn prediction, retention optimization, payment-risk classification, policy-bounded refund automation, fraud detection, revenue forecasting → **QFJ-P07 + QFJ-P12**.
7. **Advanced marketing agents** — **entirely Post-MVP.** No marketing campaign execution, SEO automation, Google/Meta/YouTube automation, advertising-spend control, or marketing analytics in MVP → **QFJ-P12**.
8. **Advanced analytics** — forecasting, cohort analysis, CLV/VLV, churn, geographic demand, anomaly detection, model trends, executive summaries, finance analytics, marketing attribution → **QFJ-P11/P12**.
9. **Active-active multi-region** — global traffic routing, multiple active regions, global dedup, cross-region conversation ownership, distributed locking, queue coordination, conflict resolution, automated failover, duplicate-response prevention → **QFJ-P11**.
10. **Advanced Jarvis autonomy** — multi-agent planning, long-running workflows, specialist delegation, approval-aware autonomous execution, incident remediation, capacity optimization, continuous evaluation, policy-bounded automation → **QFJ-P05 + QFJ-P12**.

## Expansion rules

- Every Post-MVP capability is `DISABLED` at MVP launch and requires a **separate ADR** plus its own evaluation (QFJ-P04.04 where applicable) and authority gates before advancing state.
- Advanced marketing is strictly Post-MVP and never enters MVP.
- Local/hybrid inference and production LoRA activate only Post-MVP; MVP ships Groq-active with the local/hybrid contracts future-compatible.
- Active-active multi-region is Post-MVP; MVP ships active + warm standby.
- No Post-MVP capability grants agents financial/commercial/administrative/destructive authority; QuickFurno Core remains authoritative.

## Verdicts

- **Post-MVP agents:** advanced/marketing specialists → QFJ-P12; all `DISABLED` at launch. ✅
- **Advanced marketing:** Post-MVP only. ✅
- **Local/hybrid activation & production custom models:** Post-MVP. ✅
- **Active-active:** Post-MVP. ✅
- **Deferred, not cancelled:** all advanced functions retained under their canonical QFJ owners. ✅
