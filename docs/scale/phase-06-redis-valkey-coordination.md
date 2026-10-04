# Phase 06 — Redis/Valkey Coordination Layer

## Boundary

Jarvis now has a provider-neutral coordination contract and an isolated Redis coordination adapter. Redis/Valkey is optional and must never become business authority.

PostgreSQL/Core remain authoritative for conversation turns, approvals, execution state, durable jobs and effect-bearing decisions.

## Uses

- distributed rate limiting
- short-TTL cache + tag invalidation
- short-lived dedupe/counters where appropriate
- owned locks with fencing tokens
- best-effort durable-work wake-up signals

## Failure behavior

The adapter converts connection/runtime failures to explicit unavailable results. Base gateway and worker production manifests contain no required Redis dependency. Coordination is attached only through removable Compose overlays.

For a coordination outage:

- cache is bypassed;
- rate-limit callers use their documented fallback;
- correctness-sensitive lock callers use PostgreSQL authority or refuse the unsafe operation;
- missed wake-ups are recovered by the durable DB poll/recovery path.

## Valkey runtime

The production reference service is digest pinned, has no public port, disables RDB/AOF persistence, stores runtime data only in tmpfs, bounds memory and uses TTL-aware eviction.

## Exit gate

The integration suite uses two web-style clients plus two worker-style clients and proves shared rate limiting, cross-replica cache invalidation, lock ownership/fencing, wake-up publication, TTL/opaque-key discipline and no durable-state mutation during Redis outage.
