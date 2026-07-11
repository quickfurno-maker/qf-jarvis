# ADR-0001: Begin QF Jarvis as a modular monolith (monorepo), not microservices

- **Status:** Accepted
- **Date:** 2026-07-11
- **Phase:** 0A — Engineering Foundation

## Context

QF Jarvis is being rebuilt from zero. It will eventually host multiple concerns
— event intake, reasoning, recommendation generation, specialist-agent
orchestration, and founder decision support. It is tempting to start by
splitting these into separate deployable services.

At this stage, however:

- The domain boundaries inside Jarvis are not yet proven; they will move as the
  first real phases land.
- There is exactly one team and no independent scaling pressure yet.
- Premature service splits impose distributed-systems cost (network hops,
  partial failure, versioned inter-service APIs, cross-service transactions,
  duplicated ops) before we have any evidence we need it.
- We still want strong internal modularity and the option to extract services
  later without a rewrite.

## Decision

Start QF Jarvis as a **modular monolith in a pnpm monorepo**:

- Shared, versionable **packages** (`@qf/contracts`, `@qf/observability`,
  `@qf/testing`) hold cross-cutting primitives.
- **Apps** (`jarvis-api`, `jarvis-worker`) are thin process hosts that compose
  those packages.
- Modules communicate through explicit, typed interfaces (and, at the system
  edge, versioned contracts), never through hidden shared state.
- The API and worker are already **separate processes** sharing the same code,
  so compute can scale by process type without a service split.

We deliberately do **not** adopt Turborepo or a service mesh yet; plain pnpm
workspace commands and TypeScript project references are sufficient and simpler.

## Reasons

- **Speed and simplicity:** one repo, one install, one quality gate, atomic
  cross-cutting changes.
- **Refactor-friendly:** module boundaries can move cheaply while the domain is
  still being discovered — no cross-service API renegotiation.
- **Modularity without distribution cost:** package boundaries and project
  references enforce separation and dependency direction at compile time.
- **Extraction stays open:** a package or app can later become its own
  deployable with minimal churn, because coupling is already explicit.
- **Operational clarity:** one artifact set to build, test, and observe.

## Consequences

Positive:

- Low ceremony; the whole system is understandable and testable in one place.
- The API/worker split already models the most likely first scaling axis.
- Contracts live in a shared package, so the eventual external boundary is
  first-class from day one.

Negative / trade-offs:

- A single repo can accumulate coupling if discipline lapses; the dependency
  direction (apps → packages, never the reverse; packages do not depend on each
  other except where declared) must be enforced in review.
- All apps share one language/runtime toolchain (acceptable and intended here).

## Future extraction criteria

Extract a module into an independently deployable service only when at least one
is clearly true:

1. **Independent scaling:** its resource profile diverges sharply from the rest
   (e.g. heavy async processing) and co-scaling is wasteful.
2. **Independent lifecycle:** it must deploy or roll back on a materially
   different cadence.
3. **Isolation:** it needs a separate failure, security, or compliance domain.
4. **Ownership:** a distinct team needs autonomous ownership.
5. **Proven, stable interface:** its boundary has been stable across several
   phases, so a network contract will not thrash.

Absent one of these, keep it in the monorepo.
