# Phase 12 — Horizontal Workers & Agent Scaling

## Status

Implementation branch: `feat/scale-phase12-horizontal-workers`.

Phase 12 removes the Jarvis single-process scaling assumption while preserving
QuickFurno as the external source of truth and preserving deterministic
conversation ordering.

## Deployment modes

The production WhatsApp worker supports:

- `SINGLE_OWNER` — compatible with the existing deployment.
- `MULTI_REPLICA` — allowed only when the durable turn store is PostgreSQL.

The file spool remains explicitly single-owner. Configuration validation refuses a
multi-replica worker that uses the file spool.

## Independent agent lanes

`agentLanes` selects one or more of:

- `RIYA`
- `ANISHA`
- `AAROHI`

The scheduler claims only the configured lanes while preserving the existing global
and per-agent concurrency limits. This allows separate Riya, Anisha and Aarohi
worker pools without changing deterministic routing.

The default remains all three agents, so Phase 12 does not force an immediate
production topology change.

## Shared per-conversation ordering

Process-local `activeConversations` is still used to avoid duplicate work inside
one process, but it is no longer the correctness boundary.

The PostgreSQL durable turn spool now prevents a candidate from being claimed when
the same conversation has:

- any `PROCESSING` turn; or
- an earlier `PENDING` turn ordered by
  `accepted_at, received_at, conversation_revision, inbound_message_id`.

Claims continue to use `FOR UPDATE OF turn SKIP LOCKED`, so unrelated
conversations can run concurrently.

Migration `0019_scale_phase12_horizontal_worker_ordering.sql` adds:

- a preflight that refuses an already-invalid state;
- a partial unique index allowing only one `PROCESSING` row per conversation;
- a pending conversation-order index supporting the head-of-line check.

The unique index is the final shared fence if a future claimant accidentally
regresses.

## Cross-agent handover safety

A dedicated Riya worker cannot overtake an earlier Aarohi/Anisha turn for the same
conversation. The earlier durable turn must leave pending/processing first.

Human takeover is still resolved by the existing routing and QuickFurno authority
read. Subject routing remains:

- client → Riya;
- vendor → Anisha;
- prospect → Aarohi;
- human takeover → Human.

Before specialist execution, the worker re-reads QuickFurno material, rejects stale
revisions, and verifies that the durable reference still matches the returned
material.

## Certification

The Phase 12 gate is:

1. `pnpm run check:scale:phase12`
2. dedicated agent-lane scheduler tests;
3. production config tests for Postgres-only `MULTI_REPLICA`;
4. PostgreSQL durable turn spool integration tests using separate pools;
5. container topology validation;
6. workspace typecheck, lint, tests and production build.

The PostgreSQL integration suite proves that two separate worker pools cannot claim
two turns from the same conversation simultaneously, while unrelated conversations
remain horizontally claimable. It also proves that a dedicated agent lane cannot
overtake an earlier cross-agent turn.

CI runs the Phase 12 certification against an isolated PostgreSQL service.

## Deployment and rollback

No production cutover is required to merge Phase 12.

A controlled rollout should first keep `SINGLE_OWNER` with the PostgreSQL turn
store, then introduce `MULTI_REPLICA` for one selected agent lane at a time.
Replica counts and lane membership are operational configuration, not business
policy.

Rollback is configuration-first: return workers to `SINGLE_OWNER` and all three
agent lanes. The database ordering fence remains safe and should be retained.
