# `@qf-jarvis/worker`

The asynchronous, background-processing boundary of QF Jarvis.

## Status — Phase 1

**Empty by design.** [`src/index.ts`](src/index.ts) contains a documentation comment and `export {};`, and nothing else. There is no worker loop, no scheduler, no queue client, no event consumer, and no dependency.

The boundary exists now so that the module structure of the modular monolith is real from the first commit rather than retrofitted onto working code later ([ADR-0004](../../docs/decisions/ADR-0004-modular-monolith-first.md), [ADR-0010](../../docs/decisions/ADR-0010-workspace-and-module-structure.md)). An empty boundary that compiles is a structure. A placeholder implementation is a liability — it is indistinguishable from an intention, and it will be built upon by someone who assumes it was.

## Why it is separate from `api` on day one

The split is not speculative infrastructure; it is the seam this system is already known to have. Event ingestion, agent runs, and evaluation are **long-running, retryable, and replayable**. Serving a request is **short, synchronous, and not retryable in the same way**. Those two workloads have different failure modes, different idempotency requirements, and — eventually — different scaling characteristics.

Drawing the boundary now costs nothing. Discovering it later, after ingestion has grown inside a request handler, costs a refactor that nobody schedules ([ADR-0010](../../docs/decisions/ADR-0010-workspace-and-module-structure.md)).

## What this application is for

Eventually: durable event ingestion, idempotent processing, replay, agent runs, and the evaluation loop — each arriving in its own phase, with its own contracts and its own exit criteria. See [the phased roadmap](../../docs/architecture/phased-roadmap.md).

Idempotency is the property this application exists to protect. It is developed **test-first**, without exception ([engineering principles §2](../../docs/governance/engineering-principles.md)).

## What this application may never do

The [permanent architecture boundary](../../docs/architecture/system-boundary.md) is authoritative and applies to every line ever added here:

- It may not authorize anything.
- It may not call n8n, or any external provider.
- It may not write QuickFurno Core's business state.
- It may not hold a provider, WhatsApp, or telephony credential.

## Commands

Run from the repository root:

```
pnpm --filter @qf-jarvis/worker typecheck
pnpm --filter @qf-jarvis/worker build
```

Or check and build the whole workspace with `pnpm check`. See [development setup](../../docs/engineering/development-setup.md).
