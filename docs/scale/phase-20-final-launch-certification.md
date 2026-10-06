# Phase 20 — Final Scale Launch Certification

Status: final evidence gate for Jarvis. The canonical contract is `contracts/qfj-phase20-final-launch-v1.json`.

## Role in the final gate

- Jarvis remains reasoning/orchestration, never QuickFurno business authority.
- PostgreSQL application connection budget remains 16: two gateway replicas x3 + two worker replicas x5.
- Phase 20 reruns the real PostgreSQL connection-budget certificate under excess concurrency.
- Phase 18 bounded-soak/provider-failure evidence remains required through normal CI.
- Phase 19 Kubernetes portability remains evidence only; launch continues on Docker/VPS.
- Live managed-project migration head observed during Phase 20 is internal ledger version 1 / `0001_event_log.sql`; later repository migrations are not falsely claimed as production-applied.
- Supabase-specific infrastructure is inventoried for Phase 21; Jarvis event-backbone semantics remain portable PostgreSQL/session semantics.
- No production DB mutation, AWS dependency, Kubernetes production cluster, or authority expansion is introduced.

## Phase 20 focused proof

The dedicated workflow validates the canonical contract, re-runs the 16-connection budget, and executes an isolated expand/backfill/compatibility/contract migration rehearsal on disposable PostgreSQL.

Normal CI and supply-chain workflows remain the authoritative full-regression and signed-image gates.
