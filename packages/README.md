# `packages/`

Shared modules.

## `@qf-jarvis/contracts` — the first package

[`contracts/`](./contracts/) holds the versioned, runtime-validatable data contracts of the system: canonical events, recommendations, approval decisions, execution intents, execution results, and governed communication lifecycle records.

It arrived in **Phase 2**, which is exactly where [ADR-0010](../docs/decisions/ADR-0010-workspace-and-module-structure.md) said the first package would arrive — and it is the package that justified the bar:

> **Two or more consumers genuinely need the same thing, and that thing has a boundary somebody can name.**

The contracts qualify without argument. Every later phase depends on them: ingestion parses canonical events (Phase 3), the coordination layer routes recommendations (Phase 4), the agents produce them (Phases 5–8), the approval path submits them (Phase 9), n8n validates execution intents (Phase 10), and Core integration adapts to them (Phase 11). A contract that two systems must agree on is the textbook case for a package with a versioning obligation and a review surface.

**It contains no business logic and no transport.** It is data and validation. Importing it cannot cause an effect.

See [docs/contracts/](../docs/contracts/) for the full documentation set.

## `@qf-jarvis/event-backbone` — the second package

[`event-backbone/`](./event-backbone/) holds the durable event backbone. It arrived in **Phase 3, Stage 3.1**, and at the moment it contains **persistence and nothing else**: a validated database configuration, a connection pool, a transaction helper, a forward-only migration runner with checksum verification, and the **immutable canonical event log**.

**It clears the two-consumer bar, and not speculatively.** `apps/worker` will run the projection runner (Stage 3.4). At **Phase 11**, `apps/api` gains an HTTP webhook that must call **the same** `ingest()` — and _apps may never depend on apps_. Drawing the boundary now costs nothing; discovering it in Phase 11 would cost a refactor that competes with the integration and loses.

**What it does not contain:** ingestion, signature verification, contract parsing, deduplication _behaviour_, projections, checkpoints, retries, dead letters, replay, quarantine, read models, a test emitter, metrics, or a worker loop. Those are Stages 3.2–3.8, each with an Accepted ADR.

It depends on **nothing in this workspace** — its only dependency is `pg`. It does not import `@qf-jarvis/contracts`, because Stage 3.1 does no contract parsing.

`packages/persistence` was **deliberately not created**: [ADR-0010](../docs/decisions/ADR-0010-workspace-and-module-structure.md) §6 requires two or more consumers, and it has one. **Extraction trigger, recorded now:** extract it when Phase 4's coordination layer needs to own its own migrations.

See [docs/architecture/event-backbone.md](../docs/architecture/event-backbone.md) and [ADR-0019](../docs/decisions/ADR-0019-durable-event-store-and-persistence.md) through [ADR-0022](../docs/decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md).

## When a new package is justified

The bar has not moved.

A package is justified when **two or more consumers genuinely need the same thing**, and that thing has a boundary somebody can name.

It is **not** justified by:

- "This file feels shared." One consumer is not sharing.
- "We will need it eventually." Then create it eventually.
- "It keeps `apps/` tidy." Tidiness is not a boundary.

A package is a public interface with a versioning obligation and a review surface. That cost is worth paying for a contract that two applications must agree on. It is not worth paying for a utility function.

**There will be no `packages/utils`.** A package with no boundary attracts everything, and then everything depends on it. See [ADR-0010](../docs/decisions/ADR-0010-workspace-and-module-structure.md) and [repository structure](../docs/engineering/repository-structure.md).

## Dependency direction

Dependencies point **inward, one way**: `apps/*` may depend on `packages/*`. A package may never depend on an application, and it may never reach back into one. A package that needs something from an app has been drawn in the wrong place.

This is not merely convention. pnpm's isolated `node_modules` means a workspace project can import only what it **declares** — an undeclared cross-boundary import does not resolve.

**No application imports either package yet**, and that is correct.

Phase 2 defined contracts; it did not wire them into anything. Phase 3 Stage 3.1 builds persistence; it does not run anything either. `apps/worker` starts consuming `@qf-jarvis/event-backbone` in **Stage 3.4**, when there is finally a projection runner for it to run.
