# QuickFurno + Jarvis Scale Portability Contract

This is the Jarvis-side companion to QuickFurno Scale Phase 01. It records the exact boundaries that must remain true while the platform evolves from one VPS to multi-host Docker, AWS and eventual Kubernetes.

## Authority

- Jarvis remains reasoning/orchestration/proposal authority only.
- QuickFurno Core remains marketplace business truth and effect authority.
- No infrastructure migration changes that boundary.

## Already portable

- QuickFurno Core endpoints are supplied by configuration, not machine IP.
- signed Core/Jarvis contracts are versioned.
- provider access is behind bounded adapters/ports.
- Temporal owns durable orchestration where used.
- replay, conversation state and operational memory have PostgreSQL-backed stores.
- Jarvis OS and worker deployment already use hardened containers, runtime secret files and immutable revisions.
- provider/model concurrency is explicit and bounded.

## Current multi-host blockers

### 1. File-backed DurableTurnSpool

The gateway and WhatsApp production worker currently share a host filesystem spool.

This is genuinely durable turn-work state. It is safe only while a single host/shared filesystem is the owner.

**Migration rule:** preserve the `DurableTurnSpool` interface and add a PostgreSQL implementation before enabling multi-host worker ownership. The shared implementation must preserve:
- replay/conflict detection
- atomic claim
- lease/fencing or transaction-safe ownership
- release/recovery
- per-conversation ordering
- queue age/statistics

The file implementation may remain for local/single-host rollback but is not the long-term production store.

### 2. SINGLE_OWNER deployment mode

`deploymentMode: SINGLE_OWNER` is a safety feature today, not a limitation to bypass.

Do not introduce a multi-owner production mode while the file spool is active. A future shared-owner mode must be a deliberate versioned configuration and must pass N-replica ordering/replay tests.

### 3. Local filesystem kill switch

The worker uses a fail-closed local file kill switch. Preserve it as a last-resort per-instance emergency control.

Before multi-host:
- add authoritative distributed disable state
- local or distributed disable may stop work
- a local absence must never override a distributed/global disable
- control changes must be auditable

### 4. File observation snapshots

Operational and agent-flow observation files are telemetry/control-plane inputs, not business truth. Their failure is explicitly powerless over customer/business effects.

They are acceptable for the current Docker host and should move/fan out to OpenTelemetry/central observability in Phase 14.

### 5. Poll/cadence loops

Aarohi/social/provider polling may remain where external providers require polling.

Internal durable work should prefer wake-up/event notification with durable-store fallback. Any N-replica scheduler needs deterministic occurrence identities and atomic distributed ownership.

## Secret/config portability

Runtime file injection is an accepted portable contract. Kubernetes Secrets, AWS Secrets Manager, Vault or another source may materialize the same file/value later.

Do not move cloud SDK calls into agent/domain packages merely to change secret providers.

## Container/Kubernetes contract

Every Jarvis runtime role must either:
- be safe at N replicas, or
- explicitly refuse N replicas through a configuration invariant such as SINGLE_OWNER.

No role may silently depend on:
- a unique host
- an unshared durable local file
- a fixed machine IP
- a cloud/Kubernetes SDK in domain logic

## Test ratchet

`apps/api/src/tests/scale-portability-contract.test.ts` intentionally proves:
- SINGLE_OWNER remains required while production uses the file spool
- DurableTurnSpool remains an implementation seam
- local kill-switch failure stays fail-closed
- QuickFurno Core service discovery remains config-based/signed
- current multi-host blockers remain visible until their migration phases remove them

When Phase 07/12 replaces the file spool, update the ratchet as part of the same reviewed change. Do not weaken it first.
