# `@qf-jarvis/api`

The synchronous, request-driven boundary of QF Jarvis.

## Status — Phase 1

**Empty by design.** [`src/index.ts`](src/index.ts) contains a documentation comment and `export {};`, and nothing else. There is no HTTP server, no framework, no route, no health check, and no dependency.

The boundary exists now so that the module structure of the modular monolith is real from the first commit rather than retrofitted onto working code later ([ADR-0004](../../docs/decisions/ADR-0004-modular-monolith-first.md), [ADR-0010](../../docs/decisions/ADR-0010-workspace-and-module-structure.md)). An empty boundary that compiles is a structure. A placeholder implementation is a liability — it is indistinguishable from an intention, and it will be built upon by someone who assumes it was.

## What this application is for

Eventually: the request-driven surface of Jarvis — the founder control plane's backing API, recommendation queries, and evidence retrieval.

When each of those arrives is decided by [the phased roadmap](../../docs/architecture/phased-roadmap.md), not by whoever needs somewhere to put something. A web framework is not chosen here until a phase actually requires one.

## What this application may never do

The [permanent architecture boundary](../../docs/architecture/system-boundary.md) is authoritative and applies to every line ever added here:

- It may not authorize anything, including its own recommendations.
- It may not call n8n, or any external provider.
- It may not write QuickFurno Core's business state.
- It may not hold a provider, WhatsApp, or telephony credential.
- It may not render an action as approved, delivered, or complete before Core's authoritative result returns.

## Commands

Run from the repository root:

```
pnpm --filter @qf-jarvis/api typecheck
pnpm --filter @qf-jarvis/api build
```

Or check and build the whole workspace with `pnpm check`. See [development setup](../../docs/engineering/development-setup.md).
