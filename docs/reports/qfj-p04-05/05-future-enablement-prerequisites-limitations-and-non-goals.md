# Report 05 — Future Enablement Prerequisites, Limitations, and Non-Goals

**Slice:** QFJ-P04.05 — No-Op RAG Provisioning. **ADR:** [ADR-0053](../../decisions/ADR-0053-qfj-p04-05-no-op-rag-provisioning.md).

## Authority boundary

Provisioning authorizes and executes nothing — there is no retrieval tool and no provider/n8n call (proven: the provisioner exposes no business method). QuickFurno Core remains the final business authority; Riya client-only; Anisha vendor-only; Jarvis coordinates; n8n execution-only. Governed knowledge (QFJ-P04.03) remains exact, deterministic evidence. The Jarvis Conversation Operations Center remains a mandatory later phase (ADR-0053 §K) and is **absent here** (no conversation store, no WhatsApp, no dashboard — proven by source scan). Kimi is excluded.

## Future enablement preconditions (DOCUMENT ONLY — none performed)

Enabling RAG later requires ALL of the following, none done here: a **superseding ADR**; explicit **owner approval**; QFJ-P04.04 **semantic-retrieval research evidence**; exact **model/prompt/capability/knowledge binding**; **privacy/tombstone** proof; **citation/freshness/conflict** evaluation; **tenant/data-class isolation**; **cost/latency/availability** evaluation; a **rollback/kill switch**; and separate **DB/migration/deployment** authorization where applicable. Any real backend (`FUTURE_LOCAL_VECTOR`/`FUTURE_MANAGED_VECTOR`) stays refused/no-op until then.

## Non-goals — confirmed absent

No embeddings, vector DB, semantic search, chunking, indexing, retrieval, augmentation, external service, network; no DB/schema/**migration 0008**; no managed/local production database access; no live model call; no provider activation or rollout promotion; no real key/token; no agents/memory/WhatsApp/dashboard/n8n/tools; no deployment. Migrations 0001–0007 unchanged; event-backbone root API remains **39**; QFJ-P04.03/QFJ-P04.04 unchanged; the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory is untouched.

## Limitations and exact next action

By design, the package does no retrieval and provides no runtime value — it is a **disabled boundary** that makes the provisioning shape explicit, validated, testable, observable, and provably inert. Real RAG (embeddings/vector/semantic retrieval) is a later, separately authorized decision gated on QFJ-P04.04 evidence and a superseding ADR. **Exact next action:** owner review of the DRAFT PR, then (if accepted) a separately authorized expected-head guarded normal two-parent merge. This completes the planned QFJ-P04 slices (04.01A–E, 04.02, 04.03, 04.04, 04.05); managed deployment remains a separate paused lane, and no MVP runtime (M1) has begun.
