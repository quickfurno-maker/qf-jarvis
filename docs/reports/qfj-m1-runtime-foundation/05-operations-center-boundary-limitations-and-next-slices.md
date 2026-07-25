# Report 05 — Operations-Center Boundary, Limitations, and Next Slices

**Slice:** QFJ-M1 — Agent and Conversation Runtime Foundation. **ADR:** [ADR-0054](../../decisions/ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md).

## Conversation Operations Center — contract preserved, not implemented

The mandatory future dashboard projection is **documented** as a content-free contract (`CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS`): conversation id, assigned actor, party type, conversation state, last activity time, AI-paused/human-takeover, escalation/follow-up status, a delivery-state placeholder, and a safe audit reference. Proven: the field list contains **no** content/text/message/subject/body/prompt field. **No dashboard, no persistence, and no WhatsApp/n8n** is implemented here; QuickFurno Core owns the authoritative conversation record. A later agent/WhatsApp/dashboard phase will project these fields.

## Authority boundary — reaffirmed

The runtime coordinates **proposals only** and authorizes, sends, and executes nothing (proven: proposals and the decision carry no `execute`/`send`/`authorize`/`callN8n` method). QuickFurno Core is the final business authority and system of record; n8n is transport/execution-only; Riya is client-only, Anisha vendor-only, Jarvis the coordinator; models/knowledge/evaluation grant no business authority, and RAG remains disabled/no-op. Kimi is excluded.

## Non-goals — confirmed absent

No DB/schema/**migration 0008**; no managed/local production database access; no WhatsApp/n8n/provider API; no live model call; no real messages/keys/tokens; no memory/RAG/tools/execution; no dashboard/deployment. Migrations 0001–0007 unchanged; event-backbone root API remains **39**; QFJ-P04 packages are neither imported nor coupled; the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory is untouched.

## Limitations and exact next action

The runtime produces deterministic proposals from content-free contracts, validated only by deterministic tests — it sends nothing, persists nothing, and calls no model. A later, separately authorized slice adds Core proposal-validation, transport (WhatsApp via n8n), the model-gateway reply path, persistence, and the Conversation Operations Center dashboard. **Exact next action:** owner review of the DRAFT PR, then (if accepted) a separately authorized expected-head guarded normal two-parent merge. The QFJ-P04 model/knowledge/evaluation foundation is complete (04.01A–E, 04.02, 04.03, 04.04, 04.05); this slice begins the MVP runtime (QFJ-P05 Jarvis Orchestration). Managed lanes remain paused.
