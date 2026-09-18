# ADR-0153 — Jarvis Action Kernel submission firewall

**Status:** Accepted
**Superseded integration assumption:** any external workflow/execution fabric between QuickFurno Core and providers.
**Current execution owner:** QuickFurno Core Automation.

## Decision

Jarvis uses one deterministic **Action Kernel** as the only application-facing submission seam for business proposals. The kernel is **not** a policy or authorization engine. It snapshots and fingerprints the exact semantic proposal, collapses identical in-flight duplicates, refuses same-identity/different-content conflicts, normalizes Core failures closed, and records content-free observability. It then delegates the decision to QuickFurno Core.

An `ACCEPTED` Core response still produces a Jarvis receipt with `executionAuthority: "NONE"` and `canExecute: false`. Execution is owned by QuickFurno Core Automation after Core authorization.

## Package boundary

The kernel originally lived inside `apps/api` while it had one consumer. Native Temporal durable orchestration creates a second genuine consumer (`apps/temporal-worker`), so the repository's two-consumer extraction rule is now met. The shared package is `@qf-jarvis/action-kernel`.

## Permanent negative capabilities

The package exposes no database handle, provider credential, Core Automation client, provider client, send/execute/authorize method, or durable approval cache. Temporal may call the kernel from an Activity, but that gives Temporal no business authority.

## Resulting chain

`Jarvis/Mastra -> Temporal Activity (when durable) -> Action Kernel -> QuickFurno Core -> QuickFurno Core Automation -> provider/integration -> Core truth/events`.
