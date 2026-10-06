# Phase 20 — Final Scale Launch Certification

Status: implementation and reproducible certification evidence.

Jarvis remains a separate reasoning/orchestration plane. QuickFurno Core validates and executes business effects. Phase 20 grants no new Jarvis authority.

## Final gates

- Revalidate the byte-identical `qfj.phase20.launch-cert.v1` contract.
- Re-run the Phase 09 database connection-budget proof: **2 gateways x 3 + 2 workers x 5 = 16** application backends maximum under excess concurrency.
- Revalidate Phase 12 horizontal-worker/agent boundaries and distributed ownership.
- Rehearse expand/backfill/coexist/contract on disposable PostgreSQL.
- Revalidate hardened container contract and immutable artifact identity through normal CI/supply-chain gates.
- Preserve no-AWS/no-Kubernetes launch dependency.
- Preserve PostgreSQL durable truth, Redis/Valkey coordination-only semantics and bounded QuickFurno↔Jarvis transport.
- Preserve Riya/Anisha/Aarohi proposal/orchestration role; Core remains effect authority.

## Database migration rule

The Phase 20 expand/contract drill is synthetic. It demonstrates deployment compatibility mechanics without changing the Jarvis production schema or migration history.

## Provider independence

Jarvis must consume identity/actor context through stable signed Core contracts. It must not deepen dependence on Supabase Auth identifiers. QuickFurno Phase 22 owns the internal principal/provider mapping.

## Exit gate

Phase 20 is complete only after exact-head CI, final-certification workflow and signed supply-chain publication are green on the merged main SHA.
