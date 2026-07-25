# Report 05 — Authority Boundaries, Limitations, and Next Slices

**Slice:** QFJ-P04.03 — Governed Knowledge System. **ADR:** [ADR-0051](../../decisions/ADR-0051-qfj-p04-03-governed-knowledge-system.md).

## Authority boundary (the central discipline)

Governed knowledge is **evidence, never business authority**. A registry resolution and a retrieval result are **data summaries with citations** — they carry no `authorize`/`execute`/`invoke`/`run`/`send`/`callN8n` method (proven). QuickFurno Core remains the **final business authority and authoritative system of record** for current leads, vendors, wallets, subscriptions, packages, consent, assignments, and policies; retrieved knowledge informs _how_ an agent reasons, never _what is currently true_. Models/providers authorize and execute nothing; n8n is execution-only. Riya=CLIENT, Anisha=VENDOR, Jarvis=COORDINATION — kept distinct, never blurred by retrieval. The excluded vendor is absent.

## Declared vs approved (P04.04 boundary)

A record records **declared/reviewed** reference material with attributable approval metadata (`approvedBy`/`approvedAt`); there is **no boolean `approved` field** and no evaluation-evidence fabrication (proven). **QFJ-P04.04** owns evaluation/red-team evidence and the authority to activate a model; **registry presence or knowledge retrieval never activates a model or a rollout**.

## Conversation Operations Center — mandatory later, absent here

The Jarvis Conversation Operations Center remains **mandatory** in later agent/WhatsApp/dashboard phases (all active Riya/Anisha/Jarvis/human conversations visible; searchable WhatsApp history; assignment/status/delivery/escalation/follow-up/AI-pause/human-takeover; Core owns the authoritative conversation record; n8n transport/execution only). It is **documented as mandatory** (ADR-0051 §O) and **implemented nowhere** in this slice (no conversation store, no WhatsApp, no dashboard — proven by source scan).

## Non-goals — confirmed absent

No persistence/database/schema/**migration 0008**; no managed/local production database access; no document upload/scanning runtime; **no vector database, embeddings, semantic search, cosine ranking, or RAG**; no live Groq/local model call; no real key/token; no provider activation; no model tools/MCP/web/code execution/provider tools; no agent runtime, Riya/Anisha prompts, memory, WhatsApp, dashboard, or n8n; no deployment. Migrations 0001–0007 unchanged; event-backbone root API remains **39**; the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory is untouched.

## Operator prerequisites (all separately owner-authorized, none done here)

To use the registry against real records later, at composition time: build a `ModelCapabilityRegistry`-style set of `KnowledgeRecord`s from reviewed/approved reference data; construct one `GovernedKnowledgeRegistry`; inject a real `KnowledgePrivacyGate` bound to Core erasure state; and call `retrieveGovernedKnowledge` from a future agent. Any real content, persistence, or evaluation approval is a later, separately authorized step.

## Limitations and exact next action

The registry is populated from configured/declared records validated only against deterministic tests here — real content, persistence, and evaluation approval come later. Retrieval is intentionally exact and bounded (no free-text or semantic retrieval) until QFJ-P04.04 evidence justifies more. This completes the QFJ-P04.03 foundation. **Exact next action:** owner review of the DRAFT PR, then (if accepted) a separately authorized expected-head guarded normal two-parent merge. The next roadmap slices are **QFJ-P04.04** (Evaluation and Red-Team Framework — the authority for ACTIVE approval and for justifying any future semantic retrieval) and **QFJ-P04.05** (No-Op RAG Provisioning, disabled by default).
