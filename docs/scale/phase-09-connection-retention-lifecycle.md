# Phase 09 — Database Connection Budget & Data Lifecycle

## Live baseline — 2026-10-04

QF-Jarvis Supabase:

- PostgreSQL `max_connections = 60`
- 12 total connections / 1 active at the audit point
- database size: 11 MB
- canonical `qf_jarvis.event` currently has no live business rows; current risk is connection multiplication rather than table size

## Locked connection budget

The 60 server connections are divided before replica multiplication:

- platform/Auth/Storage/Realtime/admin reserve: **28**
- Jarvis application pool budget: **16**
- emergency/incident headroom: **16**

Target Phase 09 topology:

- 2 gateway replicas × 3 connections = 6
- 2 worker replicas × 5 connections = 10
- application ceiling = **16**

Production configuration loaders enforce these role caps. The worker also enforces `globalMaxConcurrentTurns <= database.maxConnections × 40`; with a 5-connection pool the existing 200-turn admission remains valid, while the pool is the hard database-concurrency limiter.

Generic library/test pools remain independently configurable; the stricter limits apply at production composition roots.

## Supabase connection mode

The event backbone depends on PostgreSQL session state:

- advisory locks
- session `statement_timeout`
- `application_name`

Therefore Supavisor/PgBouncer transaction mode is intentionally rejected for this path. Persistent Jarvis runtimes use direct connections where network support permits, or Supavisor **session mode** when IPv4 pooling is required.

## Lifecycle policy

### Canonical event ledger

`qf_jarvis.event` is canonical audit/business history:

- hot: 30 days
- retained: at least 365 days
- archive required before any future delete
- automatic deletion: **disabled**
- partition review threshold: 10 GiB
- BRIN time index added for archive/range readiness

Phase 09 contains no function capable of deleting this table.

### QuickFurno turn spool

`qf_jarvis.quickfurno_turn_spool` contains opaque routing metadata only:

- hot: 7 days
- retained: 30 days
- only `COMPLETED`/`FAILED` rows with old `finalized_at` are prunable
- max batch: 1,000
- runtime role has no prune/delete authority
- prune function is available only to the database owner or an explicitly created `qf_jarvis_maintenance` role

## Partitioning

No physical partitioning is introduced at current size. The canonical event ledger receives a BRIN accepted-time index and explicit 10 GiB review threshold. Partitioning is a measured future migration, not a default.

## Read replicas

No replica connection is enabled now. Future replicas may serve:

- analytics
- telemetry
- historical read models

Primary remains mandatory for:

- event ingestion
- turn claims
- projection checkpoints
- human-takeover state
- post-write/read-after-write confirmation

## Certification gate

Phase 09 certification proves:

- 2 gateways + 2 workers under excess concurrent queries never exceed 16 Jarvis application backends;
- worker/gateway role budgets reject oversized production pools;
- terminal turn-spool pruning is bounded and non-overlapping;
- runtime cannot execute the prune function;
- canonical event rows survive lifecycle certification unchanged;
- migration 0018 and full repository quality gates remain green.
