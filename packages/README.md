# `packages/`

Reserved for shared modules. **It is empty, and that is deliberate.**

## Why it is empty

Phase 1 builds the engineering substrate and nothing else. A shared package created before anything shares anything is not reuse — it is a guess about what the seams will be, made at the moment we know least about them, and it is the guess that later has to be unpicked.

The first real package arrives in **Phase 2**, which defines the canonical event, recommendation, approval-decision, execution-intent, and execution-result contracts ([ADR-0003](../docs/decisions/ADR-0003-event-driven-integration.md)). **Do not create a contracts package now.** Phase 2 is where that shape is agreed, and agreeing it early — by writing an empty package for it in Phase 1 — is exactly the "discover the contract by writing the implementation" failure that [engineering principles §1](../docs/governance/engineering-principles.md) forbids.

This directory is registered in `pnpm-workspace.yaml` as `packages/*` so that the first package needs no workspace change, only a package.

## When a new package is justified

A package is justified when **two or more applications genuinely need the same thing**, and that thing has a boundary somebody can name.

It is **not** justified by:

- "This file feels shared." One consumer is not sharing.
- "We will need it eventually." Then create it eventually.
- "It keeps `apps/` tidy." Tidiness is not a boundary.

A package is a public interface with a versioning obligation and a review surface. That cost is worth paying for a contract that two applications must agree on. It is not worth paying for a utility function.

See [ADR-0010](../docs/decisions/ADR-0010-workspace-and-module-structure.md) and [repository structure](../docs/engineering/repository-structure.md).

## Dependency direction

Dependencies point **inward, one way**: `apps/*` may depend on `packages/*`. A package may never depend on an application, and it may never reach back into one. A package that needs something from an app has been drawn in the wrong place.
