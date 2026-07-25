# Report 05 — Transport / Persistence / Dashboard Deferral and Next Launch Slice

**Slice:** QFJ-M2 — Core Decision and Reply Orchestration Foundation. **ADR:** [ADR-0055](../../decisions/ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md).

## Authority and no-send boundary — reaffirmed

The Core decision is the final business decision in this slice, and it is **not** a delivery action: `ACCEPTED` means Core-approved **only**, never sent, delivered, executed, or persisted (proven — no `send`/`deliver`/`execute` on the proposal, decision, or result). QuickFurno Core is the only authority; models/agents/evaluators/retrievers authorize and execute nothing; **no message is sent, no n8n call is made, no provider transport occurs, and no delivery-state is mutated**. n8n later executes only a separately authorized delivery command. Riya stays client-only, Anisha vendor-only, Jarvis coordination. Kimi is excluded.

## Conversation Operations Center contract

The content-free operations-center projection contract (M1) is preserved; the M2 status/decision fields (proposal status, Core decision status, created-at timestamps, last safe failure reason, awaiting-human-review, retry-due placeholder) fit within it without adding any message body/prompt/subject/content field. The dashboard itself remains unimplemented; QuickFurno Core owns the authoritative conversation record.

## Non-goals — confirmed absent

No real QuickFurno Core integration; no WhatsApp/provider webhook; no n8n; no sending/transport; no persistence/DB/schema/**migration 0008**; no managed database access; no live model/provider/key/token; no semantic retrieval/RAG; no dashboard; no production Core adapter; no deployment. Migrations 0001–0007 unchanged; event-backbone root API remains **39**; the P04 packages are neither imported nor coupled; the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory is untouched.

## Limitations and exact next launch slice

The model and Core ports are deterministic fakes; nothing is sent, delivered, executed, or persisted. The exact next launch-critical slices are: a **real QuickFurno Core decision adapter** (behind the same port), a **real model reply path via `@qf-jarvis/model-gateway`** (still non-sending), then a separately authorized **delivery command + transport (WhatsApp via n8n)** and **persistence**, and finally the **Conversation Operations Center dashboard** — each its own ADR-first, owner-authorized slice. **Exact next action:** owner review of the DRAFT PR, then (if accepted) a separately authorized expected-head guarded normal two-parent merge. Managed lanes remain paused.
