# Jarvis Phase 17 — Backup, PITR & Disaster Recovery

Jarvis is recovered after QuickFurno Core because QuickFurno remains the business authority.

Live read-only baseline on 2026-10-06: PostgreSQL 17.6, approximately 11 MB database size, and zero logical-replication slots at the observation point.

## Durable versus rebuildable state

Durable state includes PostgreSQL-backed gateway turn spool and other database-backed correctness state, source-controlled prompts/policies/contracts/registries, and signed immutable OCI releases.

Rebuildable or non-authoritative state includes host-local observation snapshots, generated build output, caches, temporary files, and per-host telemetry buffers. Host-local observations must never be used as a disaster-recovery source of truth.

## PostgreSQL recovery

Jarvis follows `qfj.dr.phase17.v1`: transactional target RPO 120 seconds when managed PITR is enabled; target RTO 60 minutes; daily provider-independent logical backup retained off-site for at least 30 days; future non-Realtime replication slots are recreated after restore and slot lag/WAL retention is monitored before CDC.

## Restore order

1. Restore and validate QuickFurno Core.
2. Restore Jarvis PostgreSQL state.
3. Restore exact signed Jarvis OS, gateway and worker digests.
4. Reissue credentials from the external secret source.
5. Start gateway and worker lanes with outbound effects still governed.
6. Validate turn durability, idempotency and the QuickFurno/Jarvis scale contract.
7. Start Jarvis OS.
8. Restore AGNI last.

## Secrets and images

Plaintext secret backups are forbidden. Recovery uses the Phase 13 secret inventory and owner model and reissues values. Keep at least 10 signed releases and at least 90 days of release history. Never garbage-collect active, rollback, or DR-referenced image digests.

## Safety

Phase 17 performs no production restore, production database mutation, traffic cutover, credential change, or authority expansion.
