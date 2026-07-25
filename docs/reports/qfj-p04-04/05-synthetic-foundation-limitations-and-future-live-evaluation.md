# Report 05 — Synthetic-Foundation Limitations, Non-Goals, and Future Live Evaluation

**Slice:** QFJ-P04.04 — Evaluation and Red-Team Foundation. **ADR:** [ADR-0052](../../decisions/ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md).

## Declared vs observed vs approved (the central discipline)

Three registers, kept distinct: (1) **declared** technical capability — QFJ-P04.02; (2) **observed** evaluation result — QFJ-P04.04 (this slice); (3) **rollout approval** — QFJ-P04.01E, referencing exact P04.04 evidence. Registry presence is not evaluation success; evaluation success is not automatic rollout approval; **there is no automatic promotion**. Evidence is marked `synthetic: true` / `productionApproval: false` and can never be mistaken for a real Groq/local approval.

## Authority boundary

Evaluation produces **evidence only** — it authorizes and executes nothing (proven: results/evidence carry no `authorize`/`execute`/`send`/`callN8n`/`promote`/`activate` method). QuickFurno Core remains the final business authority; n8n execution-only; models/evaluators authorize and execute nothing. Riya=CLIENT, Anisha=VENDOR, Jarvis=COORDINATION — kept distinct. The **Jarvis Conversation Operations Center** remains a mandatory later phase (ADR-0052 §Q) and is **absent here**. Kimi is excluded.

## Semantic-retrieval boundary

`SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY` is a **research evidence target label only**. This slice implements **no** semantic retrieval, embeddings, vector DB, or RAG, and does **not** modify QFJ-P04.03 governed-knowledge retrieval (proven by source scan). Any future semantic retrieval requires QFJ-P04.04 evidence to justify it and a superseding ADR to enable it; QFJ-P04.05 owns disabled-by-default RAG provisioning.

## Non-goals — confirmed absent

No live model/provider call; no real key/token; **no LLM-as-judge, no model voting**; no real conversation data; no provider activation; **no rollout promotion**; no persistence/database/schema/**migration 0008**; no managed/local production database access; no agents/memory/WhatsApp/dashboard/n8n/tools; no semantic retrieval/vector/RAG; no deployment. Migrations 0001–0007 unchanged; event-backbone root API remains **39**; the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory is untouched.

## Limitations and exact next action

Evidence here is produced from **synthetic fixtures and pre-supplied observations** validated only by deterministic tests — it is explicitly **non-production foundation** evidence. A future, separately authorized slice would supply real (still normalized, content-free) observations from real provider output and any live-evaluation path. **Exact next action:** owner review of the DRAFT PR, then (if accepted) a separately authorized expected-head guarded normal two-parent merge. The next roadmap slice is **QFJ-P04.05** (No-Op RAG Provisioning, disabled by default); managed lanes remain paused.
