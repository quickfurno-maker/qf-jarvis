# `@qf-jarvis/api`

The synchronous, request-driven boundary of QF Jarvis.

## Status

[`src/index.ts`](src/index.ts) is still a documentation comment and `export {};` — there is no HTTP server, no framework, no route, and no health check, and this application still exports nothing from its package root.

The boundary exists so that the module structure of the modular monolith is real from the first commit rather than retrofitted onto working code later ([ADR-0004](../../docs/decisions/ADR-0004-modular-monolith-first.md), [ADR-0010](../../docs/decisions/ADR-0010-workspace-and-module-structure.md)). An empty boundary that compiles is a structure. A placeholder implementation is a liability — it is indistinguishable from an intention, and it will be built upon by someone who assumes it was.

### QFJ-S2-D-B — production credential acquisition

[`src/secrets/`](src/secrets) is the first content here. It acquires the **model-inference** credential from a mounted file and hands it to the existing `GroqCredentialResolver` seam ([ADR-0064](../../docs/decisions/ADR-0064-production-credential-binding.md)).

It lives here because reusable packages receive configuration explicitly and read no environment; only an **executable process boundary** acquires deployment configuration. That rule is stated in [`database-config.ts`](../../packages/event-backbone/src/persistence/database-config.ts) and is why `@qf-jarvis/model-gateway` stays a pure library.

Nothing is activated: no provider is constructed, no transport is opened, no `process.env` is read, and the production model-gateway composition remains OFF-only.

## What this application is for

Eventually: the request-driven surface of Jarvis — the founder control plane's backing API, recommendation queries, and evidence retrieval.

When each of those arrives is decided by [the phased roadmap](../../docs/architecture/phased-roadmap.md), not by whoever needs somewhere to put something. A web framework is not chosen here until a phase actually requires one.

## What this application may never do

The [permanent architecture boundary](../../docs/architecture/system-boundary.md) is authoritative and applies to every line ever added here:

- It may not authorize anything, including its own recommendations.
- It may not call n8n, or any external provider.
- It may not write QuickFurno Core's business state.
- It may not hold an **execution or communication** provider credential — WhatsApp, SMS, email, voice, telephony, CRM, or advertising. It has none and must never be given any.
- It may not render an action as approved, delivered, or complete before Core's authoritative result returns.

> **Open item for owner review.** [`system-boundary.md`](../../docs/architecture/system-boundary.md) states "Hold provider credentials. It has none and must never be given any" without qualification. That document predates the model gateway and names no model-inference provider — every neighbouring clause concerns execution and advertising providers reached through n8n after Core authorizes. The repository has since authorized Jarvis to hold a **model-inference** credential ([ADR-0046](../../docs/decisions/ADR-0046-qfj-p04-01b-groq-cloud-adapter.md), [ADR-0060](../../docs/decisions/ADR-0060-qfj-s1-groq-staging-provider-binding.md), [ADR-0064](../../docs/decisions/ADR-0064-production-credential-binding.md)), which is a different thing from an execution credential: it buys inference, it cannot deliver, pay, or mutate business state. **`system-boundary.md` should be amended to say so explicitly. That is an owner decision and was not made here.**

## Commands

Run from the repository root:

```
pnpm --filter @qf-jarvis/api typecheck
pnpm --filter @qf-jarvis/api build
```

Or check and build the whole workspace with `pnpm check`. See [development setup](../../docs/engineering/development-setup.md).
