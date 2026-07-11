# ADR-0010 — Workspace and Module Structure

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

[ADR-0004](./ADR-0004-modular-monolith-first.md) decided that QF Jarvis is a **modular monolith**: one deployable unit, strict internal module boundaries, boundaries drawn _where a service boundary would go_ so that extraction is later a deployment change rather than a rewrite.

That decision was made on a whiteboard, against no code. This ADR is where it becomes a directory layout — and a directory layout is where architectural decisions either survive or quietly die. ADR-0004 named the risk itself: _"Discipline is required, not enforced by the network. Nothing stops a developer from importing across a module boundary except review."_

So the question Phase 1 has to answer is narrow and practical: **what is the smallest structure that makes ADR-0004's boundaries real, without inventing seams we have no evidence for?**

Two failure modes bracket the answer, and both are worse than they look:

- **Too little structure.** A single `src/` directory. Every later boundary is then a refactor, and refactors that are nobody's phase do not happen. By Phase 8 there is nothing to extract because there was never anything separate.
- **Too much structure.** Nine packages, an interface package, a utils package, a types package — all created before anything shares anything. Each is a guess about a seam, made at the moment we know least, and each guess has to be unpicked later by someone who has to first work out why it was there.

## Decision

**A pnpm workspace containing two application boundaries and a reserved, empty `packages/` directory.**

```
apps/
  api/        @qf-jarvis/api      — synchronous, request-driven boundary
  worker/     @qf-jarvis/worker   — asynchronous, background-processing boundary
packages/     (empty — reserved for shared modules, first used in Phase 2)
```

### 1. `apps/api` and `apps/worker` exist now, and are empty

Each contains a `package.json`, a `tsconfig.json`, a `README.md`, and a `src/index.ts` holding a documentation comment and `export {};`.

They start no server, run no loop, print nothing, import nothing, and register no route or handler.

**Why an empty boundary is worth having, and a placeholder is not.** The two look similar and are opposites:

- An **empty boundary that compiles** is a _structure_. It asserts where code will go and nothing about what that code does. It cannot be wrong, because it claims nothing.
- A **placeholder implementation** — a health route, a stub server, a `TODO: agent` — is a _liability_. It is indistinguishable from an intention. Someone will build on it, and the first real feature will be shaped by a decision that nobody actually made.

Phase 0 is explicit that this distinction is load-bearing: "No business logic of any kind — including 'just a small placeholder'" ([phased-roadmap.md](../architecture/phased-roadmap.md), Phase 1). This ADR is what that instruction looks like when it is a directory.

### 2. The `api` / `worker` split is the one seam we already have evidence for

This is not speculative infrastructure. The two workloads have genuinely different properties, and we know it before writing a line:

|               | `api`                     | `worker`                                                                                                                    |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Trigger       | An inbound request        | An event, or a schedule                                                                                                     |
| Duration      | Short, synchronous        | Long-running, retryable                                                                                                     |
| Failure model | The caller sees the error | Retry, dead-letter, replay                                                                                                  |
| Idempotency   | Per request               | **Load-bearing** — at-least-once delivery, always ([engineering-principles.md](../governance/engineering-principles.md) §8) |

Phase 3's durable event backbone is "the load-bearing infrastructure of the entire system" and must be idempotent and replayable. Phase 12's control plane is a request-driven surface. Those are different shapes, they fail differently, and they will eventually scale differently.

Drawing this boundary on an empty repository costs nothing. Discovering it in Phase 3, after ingestion has grown inside a request handler, costs a refactor that competes with delivering Phase 3 — and loses.

**This is exactly ADR-0004's instruction applied**: draw the boundary where a service boundary would go. If `worker` is ever extracted, it is a deployment change. Two apps is the _minimum_ structure that honors that; one app would honor nothing.

### 3. `packages/` is empty, and stays empty until Phase 2

It is registered in `pnpm-workspace.yaml` as `packages/*` and holds only a `README.md`, so the first package requires a package and not a workspace change.

**No contracts package is created now.** Phase 2 defines the canonical event, recommendation, approval-decision, execution-intent, and execution-result contracts. Creating the package in Phase 1 — even empty — would start that conversation a phase early, in the phase least equipped to have it. Phase 0's first engineering principle is _contract-first_, and it forbids precisely this: "discovering the contract by writing the implementation and seeing what shape falls out."

### 4. Dependency direction is one-way, and enforced

```
apps/*  ──depends on──▶  packages/*
```

- An application **may** depend on a package.
- A package **may never** depend on an application.
- An application **may never** depend on another application. If `api` and `worker` need the same thing, that thing is a package — that is what the word means.

This is not merely convention. pnpm's isolated `node_modules` means a workspace project can import only what it _declares_ ([ADR-0009](./ADR-0009-runtime-language-and-package-manager.md)). An undeclared cross-boundary import does not resolve. The package manager enforces what code review would otherwise have to catch, which is the difference between a rule and a hope.

### 5. Module boundaries inside an application are as real as the ones between them

Within `apps/worker`, the eventual modules — ingestion, coordination, each agent, evaluation — communicate through explicit internal interfaces. A cross-module import that bypasses an interface is a **review blocker**, not a style comment ([change-management.md](../governance/change-management.md)).

The compiler does not enforce this one; people do. That is the accepted cost recorded in ADR-0004, and naming it here is the honest thing to do rather than pretending the directory layout solved it.

### 6. When a new package is justified

A package is justified when **two or more consumers genuinely need the same thing**, and that thing has a boundary someone can name.

It is **not** justified by:

- _"This feels shared."_ One consumer is not sharing.
- _"We will need it eventually."_ Then create it eventually.
- _"It keeps `apps/` tidy."_ Tidiness is not a boundary.

A package is a public interface with a versioning obligation and a review surface. That cost is right for a contract two applications must agree on. It is wrong for a utility function, and a `packages/utils` is how a workspace starts rotting — it is a package with no boundary, so everything ends up in it, and then everything depends on everything.

Known and justified: **Phase 2's contracts.**

## Alternatives considered

**1. A single `src/` directory, no workspace.**
Rejected. It is genuinely simpler today, and that is its whole case. But it makes every future boundary a refactor, and ADR-0004's entire argument is that the boundaries must be _drawn where the seams are_ so extraction stays cheap. A structure that defers all boundaries defers them until it is too expensive to draw them — which is the "single unstructured application" that ADR-0004 explicitly rejected as "the failure mode people actually mean when they say monolith."

**2. One app now; split `worker` out when we need it.**
Rejected, and this was the closest call. The argument for it is good: two empty applications look like ceremony, and YAGNI is usually right. It loses on timing. The moment we will "need it" is Phase 3, which is the phase that can least afford a structural refactor — it is described as the load-bearing infrastructure of the whole system, and its exit criteria are about proving idempotency and replay, not about moving files. The split costs nothing now and cannot be done cheaply then. **This is the one place where anticipating a boundary is correct, because we are not guessing at it: Phase 0 already told us the seam is there.**

**3. A package per agent — `packages/kabir`, `packages/riya`, and so on.**
Rejected, firmly. This is ADR-0004's "design by anthropomorphism" arriving through the back door. Agents are _reasoning_ components behind interfaces, not deployment or distribution units. Giving each a package because it has a human name would create four versioning surfaces and four review surfaces for four modules that will share almost everything and be deployed together. They are modules inside `worker`.

**4. Create `packages/contracts` now, empty.**
Rejected. It looks harmless and it is not. An empty contracts package invites the first person who needs a type to put it there — and Phase 2's contracts would then be discovered by implementation rather than agreed by design, which is exactly what [engineering-principles.md](../governance/engineering-principles.md) §1 forbids. Phase 2 creates it, deliberately, with fixtures and contract tests.

**5. Nx, Turborepo, or another monorepo build system.**
Rejected as premature. pnpm workspaces plus TypeScript project references already give us dependency-ordered, incremental builds across two projects. A build orchestrator solves cache and task-graph problems that a two-project repository does not have. Revisit when the build is actually slow — with evidence, which is the same standard ADR-0004 sets for extraction.

**6. Separate repositories per application.**
Rejected. Same reasoning as ADR-0004's alternative 4: a monorepo gives atomic cross-module changes and one CI pipeline, which is what a system with unproven internal boundaries needs.

## Consequences

**Positive.**

- **The seam that matters exists from the first commit**, and Phase 3 can build on it instead of first creating it.
- **Extraction stays a deployment change**, exactly as ADR-0004 requires.
- **Undeclared cross-boundary imports do not resolve.** The package manager enforces the dependency direction.
- **Each application type-checks independently** (TypeScript project references), so a break in one is attributable to one — while the root still checks and builds everything with a single command.
- **The empty `packages/` directory is a statement.** It says _we have not decided what is shared yet_, which is true, and it says it in the place where somebody would otherwise assume.

**Negative — accepted.**

- **Two empty applications look like ceremony** to a reader who has not read this ADR. That is why the ADR, both app READMEs, and both `index.ts` files each say plainly why they are empty. If a reader still concludes it is ceremony, the documentation failed, not the structure.
- **Internal module boundaries are enforced by review, not by the compiler.** Inherited from ADR-0004, and unchanged by this layout. It remains the main cost of the modular monolith, and it is cultural.
- **A workspace has more moving parts** than a single package: three `package.json` files, three `tsconfig.json` files, project references to keep in order.
- **Someone will eventually want `packages/utils`.** The answer is in this ADR so that the discussion is short.

## Risks

| Risk                                                                                                   | Mitigation                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A placeholder appears in an empty app** — a health route, a stub server, "just to prove it runs"     | The Phase 1 exclusions are explicit, both app READMEs say it, and the pull-request template asks. Phase 1's exit criteria do not include a running process, so nothing is gained by faking one             |
| **`packages/` fills with premature packages**                                                          | A package requires two real consumers and a nameable boundary. `packages/README.md` states the bar; a new package is an architectural change and gets reviewed as one                                      |
| **A `packages/utils` grab-bag emerges** — a package with no boundary, which everything then depends on | Explicitly rejected here so the answer already exists. A shared _thing_ needs a shared _reason_, and "utility" is not one                                                                                  |
| **`api` and `worker` drift into importing each other**                                                 | Structurally impossible: neither declares the other, and pnpm's isolated `node_modules` means the import does not resolve. Shared code must become a package, which is the correct forcing function        |
| **The `api`/`worker` split turns out to be wrong**                                                     | Then it is one deployment decision to merge them, and no contract changes. This is a far cheaper error than the reverse, which is the reason for accepting the risk                                        |
| **Domain logic leaks into tooling or configuration**                                                   | There is no domain logic in Phase 1 to leak. From Phase 2, the review question is unchanged: does this belong to a module with a name, or is it hiding in a config file because it had nowhere else to go? |

## Follow-up

- **Phase 2** creates the first real package — the contracts — with fixtures and contract tests. It is the first test of whether this workspace carries the contracts as intended.
- **Phase 3** builds the event backbone in `apps/worker`. Its idempotency and replay rules are developed test-first.
- **Phase 4** builds the coordination layer with **zero agents registered**, which is what makes domain leakage into the coordinator structurally difficult ([ADR-0006](./ADR-0006-agent-responsibility-boundaries.md)).
- **Each phase gate** reviews whether module boundaries have eroded, whether a package was created without justification, and whether any extraction trigger from ADR-0004 has fired.
- [repository-structure.md](../engineering/repository-structure.md) is the working reference for contributors and is kept in agreement with this ADR.
