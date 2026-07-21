# Report 04 — Dependencies, Migrations, Sequencing and Risk Controls

**Date:** 2026-07-22. **Documentation only — no implementation; no migration/SQL; no external access.** Source: [qf-jarvis-mvp-post-mvp-delivery-overlay.md](../../architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md), [ADR-0042](../../decisions/ADR-0042-mvp-and-post-mvp-delivery-overlay-and-controlled-launch-sequencing.md), [migration-ledger.md](../../governance/migration-ledger.md).

## P03 and migration sequencing

1. **QFJ-P03.07A** is merged and locked (design; SCHEMA_REQUIRED).
2. **QFJ-P03.07B** (Failure Contracts and Error Taxonomy) is the **next implementation slice**.
3. **QFJ-P03.07C** owns **migration 0006** (Failure Persistence Foundation) under separate authorization.
4. Migration 0006 must **not** be reused for: RAG · agents · tasks · memory · WhatsApp · model gateway · QuickFurno Core integration · analytics.
5. **This overlay does not authorize migration 0006.**
6. QFJ-P03.07C requires **separate implementation authorization** (ADR-0039 migration-allocation rule: design approved · schema proven necessary · scope reviewed · prior inventory confirmed · managed rollout documented · creation separately authorized).
7. RAG and conversation persistence use the **next valid migration number only after 0006**, under their own authorized design.
8. **Migration 0007 is not created by this documentation task.**
9. QFJ-P03.07D–G remain required and are not cancelled.
10. MVP work may begin after the required dependency gates, but **public launch must pass an event-backbone dependency audit**.
11. Any customer-facing critical path relying on projections/event-driven execution requires the relevant P03 failure-operation implementation to be complete **before** production activation.
12. **The synchronous WhatsApp acknowledgement path must not depend on projection completion.**

## Migration state

| Migration                            | Status                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 0001–0005                            | Present, immutable (see [migration-ledger.md](../../governance/migration-ledger.md)); managed carries 0001 only |
| 0006                                 | **Absent**; owned by QFJ-P03.07C; not authorized here                                                           |
| 0007+ (RAG/conversation persistence) | Not created; only after 0006, under own authorized design                                                       |

## Milestone dependency chain (Phase 1)

M0 (governance + QFJ-P03.07B/C + migration 0006 authorized + Core contracts frozen + capability matrix frozen) → M1 (model/conversation foundation) → M2 (Riya/Anisha internal alpha) → M3 (RAG/memory/Core integration) → M4 (commercial pilot) → M5 (controlled production launch). Milestones are intra-Phase-1, **not** canonical QFJ phases.

## Risk controls

- **Authority boundary:** payments/refunds/verification/package activation/entitlements/policy exceptions stay behind Core/human authorization; agents never move money or mutate entitlements. Gate target: unauthorized financial/commercial actions = 0; payment/refund only via authority boundary = 100%.
- **Duplicate-reply risk:** outbound idempotency; sequential non-voting fallback; gate target: duplicate accepted outbound reply = 0.
- **Message-loss risk:** durable queue; ack path not projection-dependent; gate target: accepted inbound durability = 100%.
- **Data-egress risk:** `LOCAL_ONLY` never uses hosted inference (100%); minimized/sanitized hosted requests; local PC holds no business credentials.
- **Knowledge/authority risk:** RAG non-authoritative; authority order Core → rule → RAG → wording; gate target: RAG uses only approved active knowledge = 100%.
- **Learning risk:** raw conversations never auto-train production (100%).
- **Provider-outage risk:** Groq kill switch → HUMAN_ONLY; human takeover stops AI; warm-standby recovery tested.
- **Backbone risk:** event-backbone dependency audit before launch; P03 failure operations complete for projection-dependent critical paths.

## Verdicts

- **QFJ-P03.07B sequencing:** next implementation slice. ✅
- **Migration 0006 ownership:** QFJ-P03.07C only; absent; not authorized by overlay. ✅
- **Future RAG migration:** next number after 0006, own authorized design; no 0007 created. ✅
- **Event-backbone launch dependency:** mandatory pre-launch audit; ack path not projection-dependent. ✅
- **No migration or SQL created.** ✅
