# Report 02 — Roadmap Reconciliation and Historical Mapping

**Date:** 2026-07-21. **Purpose:** Record how the historical Phase/Stage taxonomy maps to the canonical QFJ-P00…P12 taxonomy, which conflicts were found, and how they were resolved.

## Old stage/phase names found (and their canonical replacement)

| Historical name (found in docs)                             | Canonical replacement                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Phase 0 — Charter and Architecture                          | QFJ-P00 — Governance and Delivery Control                         |
| Phase 1 — Engineering Foundation                            | (foundation; folded into QFJ-P00 governance substrate)            |
| Phase 2 — Contracts and Canonical Events                    | QFJ-P01 — Contracts, Identity and Trust Boundary                  |
| Phase 3 — Durable Event Backbone (Stage 3.0–3.3.5)          | QFJ-P02 — Event Ingestion and Durable Storage                     |
| Stage 3.4.1 — projection foundation (migration 0004)        | QFJ-P03.01 / QFJ-P03.02                                           |
| Stage 3.4.2 — projection registry                           | QFJ-P03.04                                                        |
| Stage 3.4.3 — gap-free projection ordering (migration 0005) | QFJ-P03.03                                                        |
| Stage 3.4.4 — projection runner `runProjectionOnce`         | QFJ-P03.05                                                        |
| Stage 3.4.5A — projection worker `runProjectionWorker`      | QFJ-P03.05 / QFJ-P03.06 supporting work                           |
| Stage 3.4.5B — production projection activation             | **QFJ-P03.06 — Production Projection Activation**                 |
| Stage 3.4.5C — broad rebuild proposal                       | absorbed into QFJ-P03.08                                          |
| Stage 3.5 — dead letters and replay                         | QFJ-P03.07 — Projection Failure Operations                        |
| Stage 3.6 — rebuild and erasure / `rm_subject_activity`     | QFJ-P03.08 (rebuild/erasure) + QFJ-P03.09 (`rm_subject_activity`) |
| Stage 3.7–3.9 — emitter / metrics / exit audit              | QFJ-P03.10 — Operational Readiness and Exit Audit                 |
| Stage 4.0 — model gateway                                   | QFJ-P04.01                                                        |
| Stage 4.1 — knowledge / capabilities                        | QFJ-P04.02 (capabilities) + QFJ-P04.03 (knowledge)                |
| Stage 4.2 — evaluation / observability                      | QFJ-P04.04                                                        |
| Stage 4.3 — Jarvis coordination layer                       | QFJ-P05                                                           |
| Phase 5 — Kabir (lead intelligence)                         | QFJ-P12 (future specialist; PLANNED/DISABLED)                     |
| Phase 6 — Riya (client journey)                             | QFJ-P06 — Riya Customer Journey                                   |
| Phase 7 — Anisha (vendor intelligence)                      | QFJ-P07 — Anisha Vendor Journey (broadened to full lifecycle)     |
| Phase 8 / 8.5 — Jitin / identity & access                   | QFJ-P08 (approval/human control); Jitin → QFJ-P12                 |
| Phase 9 — approval and policy                               | QFJ-P08 — Consent, Approval and Human Control                     |
| Phase 10 / 10.5 — n8n bridge / production readiness         | QFJ-P09 — Execution Gateway and Communication Lifecycle           |
| Phase 11 — live Core integration                            | QFJ-P10 — QuickFurno Core Integration and Reconciliation          |
| Phase 11A / 12–15 — pilot / control plane / automation      | QFJ-P11 — Pilot, Resilience and Scale                             |
| Future specialist agents                                    | QFJ-P12 — Advanced Intelligence and Future Agents                 |

## Conflicts identified

The contradiction audits (Step 11) were run against `docs`:

- **Audit A** (`Stage 4.0.*Agent Constitution | Stage 4.1.*task | Stage 4.2.*structured | Stage 4.3.*Anisha | RAG migration.*0006 | migration 0006.*RAG`): **NO MATCHES.** There is no document asserting a RAG-to-0006 allocation or a conflicting active taxonomy claim.
- **Audit B** (`3.4.5C | Stage 3.5 | Stage 3.6 | rm_subject_activity | QFJ-P03.07…09`): matches appear **only** in historical documents — `phased-roadmap.md`, `event-backbone.md`, `projection-authoring-guide.md`, and ADRs 0022/0032/0034–0038. All are **correctly historical** (forward-looking statements made before these stages existed) and are preserved for traceability.
- **Audit D** (`0006`): every Jarvis-side mention is either "there is **no** 0006" or "Stage 3.5's eventual migration shifts to 0006+" — consistent with 0006 being _conditionally reserved_ for QFJ-P03.07. The only other `0006` is `20260621000006_superadmin_foundation.sql` in `quickfurno-compatibility-manifest.json`, which is a **QuickFurno Core** migration timestamp, unrelated to the Jarvis migration series — **not a conflict**.
- **Audit E** (authority drift): every match is a statement of the boundary being **enforced** (e.g. "Jarvis recommends, Core authorizes", "Jarvis must not directly invoke WhatsApp APIs", "Jarvis executes nothing"). **No document asserts that Jarvis holds business authority.** No drift.
- **Role consistency** (`Anisha | Riya | Jarvis | vendor | customer | renewal | resale | relationship | satisfaction`): the new governance documents define the final roles; no active document narrows Anisha or transfers vendor work to Riya. Historical `agent-model.md` etc. retain Kabir/Jitin as bounded specialists — now mapped to QFJ-P12.

## Conflicts resolved

No hard contradiction required a body rewrite of a historical document. The single reconciliation risk — two _active_ taxonomies competing — is resolved by declaring the "Phase N / Stage N.N.N" numbering a **historical alias** of the canonical QFJ-P** taxonomy, via a banner at the top of the two active status documents.

## Files corrected

| File                                  | Change                                           | Rationale                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/phased-roadmap.md` | Added a canonical taxonomy banner (top of file). | Primary active roadmap: points to Roadmap v3, declares Phase/Stage names historical aliases, states QFJ-P03.06 merged (PR #24) and QFJ-P03.07 next, and notes the pre-merge branch narrative in its body is historical. |
| `docs/architecture/event-backbone.md` | Added a canonical taxonomy banner (top of file). | Active Phase-3 status doc: maps Stage 3.4.x → QFJ-P02/P03, states the merged baseline, and marks in-body "Draft PR #24 under review" text as pre-merge.                                                                 |

No other active document presented a conflicting **active** phase number, so — per the task's "avoid unnecessary document churn" and "do not convert every historical mention" — no further files were edited.

## Historical references preserved

All historical PR numbers, merge commits, stage names, and ADR bodies (ADR-0001…ADR-0038) are unchanged. The historical Phase/Stage tables in `phased-roadmap.md` and `event-backbone.md` remain, now framed by the canonical banner.

## Paths

- Superseding ADR: `docs/decisions/ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md`
- Canonical roadmap: `docs/architecture/qf-jarvis-roadmap-v3.md`

## Remaining intentionally historical wording

- The long pre-merge narratives in `phased-roadmap.md` and `event-backbone.md` describing `stage-3.4.5b-projection-handlers` as "under review in Draft PR #24" are **left in place deliberately** (framed by the banner) — rewriting them would churn history without adding governance value.
- ADRs 0036/0037/0038 stating "Stage 3.5's migration shifts to 0006+" are historical forward statements, consistent with 0006's conditional reservation for QFJ-P03.07.

## Contradiction-search result

**No active contradiction found.** All taxonomy, migration, role, and authority audits either returned no matches or returned only correctly-historical / boundary-enforcing statements. Details in report 05 and the final response's contradiction section.
