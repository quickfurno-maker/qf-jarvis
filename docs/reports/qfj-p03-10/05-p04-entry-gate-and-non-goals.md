# Report 05 — QFJ-P04 Entry Gate and Locked Boundaries

**Date:** 2026-07-24. **Slice:** QFJ-P03.10.

## QFJ-P04 entry gate — satisfied at the repository level

**QFJ-P04 — Model Gateway, Knowledge and Evaluation Foundation** depends on QFJ-P03 with the entry gate _"Projection integrity complete."_ QFJ-P03 is repository-complete (reports 01–03), so **QFJ-P04 repository work is UNBLOCKED**. Managed deployment is a separate paused lane (report 04) and does not gate it.

QFJ-P04's first canonical slice per the roadmap is **QFJ-P04.01 — Model Gateway** (with provider-neutral sub-slices QFJ-P04.01A–E under ADR-0041). The next safe step is a **read-only QFJ-P04.01 design/readiness audit** (performed separately); this report authorizes no P04 implementation.

## Locked permanent agent / authority boundary (governs P04 and later)

These are locked and must govern every future phase. **None of these agents is implemented yet** — they are recorded here as the boundary future work must honour:

- **Riya = client-side only.**
- **Anisha = vendor-side only** — all vendor actions and vendor relationship work.
- **Jarvis = central coordinator** — routing, memory, policy, model/tool orchestration, evaluation, recommendations; holds no business authority.
- **QuickFurno Core = final business authority** and authoritative system of record (approvals, assignments, credits, payments, packages, eligibility, verification, rankings, suspensions, protected business state).
- **n8n = controlled execution/integration layer only** — provider webhooks, approved WhatsApp delivery, reminders, external API execution, status callbacks; **decides no business rule**.
- **Agents never directly mutate authoritative business state** — they request approved Core tools, which enforce permissions and business rules.
- **Kimi / Kimi K3 is EXCLUDED** from the architecture (teacher, evaluator, fallback, coding model, or production component) unless the owner explicitly reintroduces it.

The canonical roadmap already encodes this authority spine (QuickFurno Core final authority; Riya customer side; Anisha vendor side; Jarvis coordination without business authority; n8n executes only approved intents; providers have no business authority). **No contradiction** with accepted ADRs was found.

## QFJ-P03.10 non-goals (preserved)

No source/test/config/package/schema/migration/CI/app/worker/script change; no migration 0008; no managed/local database access; no migration execution; no secret access; no deployment; no P04 implementation; no change to the locked agent/Core/n8n boundary; no production-readiness overclaim; no new ADR (this slice records completed evidence/status only).

## Verdict

QFJ-P03 is repository-complete; QFJ-P04 is unblocked at the repository level. The recommended next action is a read-only QFJ-P04.01 (Model Gateway) design/readiness audit that honours the locked boundary above and keeps the provider layer neutral and business-authority-free (ADR-0041).
