# Repository Structure

**Status:** Phase 1 — Engineering Foundation
**Date:** 2026-07-11

The working reference for where code goes and why. The decision behind it is [ADR-0010](../decisions/ADR-0010-workspace-and-module-structure.md); the architecture it serves is [ADR-0004](../decisions/ADR-0004-modular-monolith-first.md).

---

## Layout

```
qf-jarvis/
├── apps/                        Deployable application boundaries
│   ├── api/                     @qf-jarvis/api    — synchronous, request-driven
│   │   ├── src/index.ts         Empty by design: a comment and `export {};`
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   └── worker/                  @qf-jarvis/worker — asynchronous, background
│       ├── src/index.ts         Empty by design: a comment and `export {};`
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
│
├── packages/                    Shared modules
│   ├── contracts/               @qf-jarvis/contracts — versioned data contracts (Phase 2)
│   │   ├── src/
│   │   │   ├── common/          identifiers, timestamps, entity refs, actors,
│   │   │   │                    policy refs, classification, bounded + governed JSON
│   │   │   ├── events/          envelope, catalog (41 events), static registry,
│   │   │   │                    target client / vendor / governance events
│   │   │   ├── recommendations/ RecommendationV1, lifecycle record
│   │   │   ├── approvals/       ApprovalRequestV1 (asks), ApprovalDecisionV1 (decides)
│   │   │   ├── execution/       ExecutionIntentV1, ExecutionResultV1
│   │   │   ├── communications/  channels, the eighteen states, request,
│   │   │   │                    authorization, result, state record, human handoff
│   │   │   ├── assignments/     vendor batch policy, client confirmation,
│   │   │   │                    reassignment, additional services, linked leads
│   │   │   ├── learning/        agent runs, model + prompt provenance, corrections,
│   │   │   │                    evaluations, outcome feedback, training eligibility
│   │   │   ├── memory/          AgentMemoryRecordV1, MemoryInvalidationRequestV1
│   │   │   ├── privacy/         erasure request and record
│   │   │   ├── governance/      policy version changes
│   │   │   ├── fixtures/        valid and invalid payloads
│   │   │   ├── tests/           contract tests, grouped by domain
│   │   │   └── index.ts         the public surface
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── event-backbone/          @qf-jarvis/event-backbone — durable persistence (Phase 3, Stage 3.1)
│   │   ├── src/
│   │   │   ├── persistence/
│   │   │   │   ├── database-config.ts      validated, bounded config — supplied, never read from env
│   │   │   │   ├── pool.ts                 created by an explicit call. No module-level pool
│   │   │   │   ├── transaction.ts          withClient / withTransaction — release on every path
│   │   │   │   ├── migration-runner.ts     forward-only, checksummed, advisory-locked
│   │   │   │   ├── migration-types.ts
│   │   │   │   ├── migration-errors.ts
│   │   │   │   ├── migrations-directory.ts resolves the migrations beside the compiled code
│   │   │   │   ├── migrate-cli.ts          the ONLY reader of DATABASE_URL — a CLI is a boundary
│   │   │   │   └── migrations/             0001_event_log.sql — the immutable log, in schema `qf_jarvis`
│   │   │   ├── tests/
│   │   │   │   ├── database-config.test.ts              a UNIT test — parallel, no database
│   │   │   │   ├── *.integration.test.ts                PostgreSQL tests — serial, DATABASE_URL required
│   │   │   │   └── database-test-utils.ts               the destructive-operation guards
│   │   │   └── index.ts         the public surface
│   │   ├── package.json         its own dependency: `pg`. Nothing from this workspace
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── event-ingestion/         @qf-jarvis/event-ingestion — signature verification (Phase 3, Stage 3.2)
│   │   ├── src/
│   │   │   ├── signature/        field formats, strict envelope parser, key registry,
│   │   │   │                     computed digest, signing input, verify
│   │   │   ├── tests/            unit tests + test-only key fixtures (excluded from dist)
│   │   │   └── index.ts          the public surface
│   │   ├── package.json          NO runtime dependency — node:crypto only
│   │   ├── tsconfig.json         no-emit: type-checks everything incl. tests
│   │   ├── tsconfig.build.json   the emitting build — excludes src/tests from dist
│   │   └── README.md
│   └── README.md
│
├── docs/                        Charter, architecture, contracts, decisions, governance, engineering
├── scripts/
│   ├── clean.mjs                Cross-platform artifact removal
│   ├── copy-sql-assets.mjs      Copies src/**/*.sql into dist/. `tsc` does not
│   └── dev-postgres-init.sql    Creates qf_jarvis_test on first boot. DEVELOPMENT ONLY
├── compose.yml                  Local PostgreSQL 17.10. DEVELOPMENT ONLY — never production config
├── .github/workflows/ci.yml     The quality gate — and, from Stage 3.1, a PostgreSQL service
│
├── package.json                 Root: scripts and dev tooling. No runtime dependencies
├── pnpm-workspace.yaml          Workspace members and supply-chain policy
├── tsconfig.base.json           Shared strict compiler options
├── tsconfig.json                Solution config — references every project
├── eslint.config.mjs
├── prettier.config.mjs
├── vitest.config.mjs             UNIT tests — parallel, database-free
└── vitest.integration.config.mjs PostgreSQL tests — serial, DATABASE_URL required
```

### Two test configurations, because they need different things

A test that needs PostgreSQL is named **`*.integration.test.ts`**, and the name is the boundary — `vitest.config.mjs` excludes that pattern, and `vitest.integration.config.mjs` includes nothing else.

The integration tests drop and recreate the `public` schema so each starts from nothing, so two of them running at once destroy each other. They run **serially**. The database-free tests — nearly a thousand contract tests with no shared state and no I/O — run in **parallel**, as they always did. Making the whole repository serial to accommodate the database was the first fix, and it was the wrong one: **the cost of a correct integration test should not be paid by every test that is not one.**

### The migrations live inside the package, and the build copies them

`0001_event_log.sql` sits in `packages/event-backbone/src/persistence/migrations/`, beside the runner that loads it — not in a top-level `migrations/` directory, because a migration is part of the module whose schema it defines, and splitting the two means a package can be imported without the schema it assumes.

**`tsc` compiles TypeScript; it does not copy assets.** Left alone, `dist/persistence/migrations/` would simply be empty — and the migration CLI, which runs from `dist/`, would find no migrations and cheerfully report "already up to date" against a database with no tables. That failure is **silent**, which is why the root `build` script runs `node scripts/copy-sql-assets.mjs` rather than a README noting that someone should remember to copy the files.

Resolving the migrations back out of `src/` at runtime was the alternative, and it was rejected: a compiled artifact that reaches into its own source tree breaks the moment anything is deployed without `src/`. Making `dist/` self-contained is what `dist/` is for.

---

## `apps/` versus `packages/`

|                    | `apps/*`                     | `packages/*`                                                                                               |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Is**             | A deployable boundary        | A shared module                                                                                            |
| **Depends on**     | `packages/*`                 | Nothing in this repository                                                                                 |
| **Depended on by** | Nothing                      | `apps/*`                                                                                                   |
| **Justified by**   | A distinct workload          | **Two or more real consumers**                                                                             |
| **Today**          | `api`, `worker` — both empty | `contracts` — data contracts · `event-backbone` — persistence · `event-ingestion` — signature verification |

### Dependency direction — one way, and enforced

```
apps/*  ──depends on──▶  packages/*
```

- An application **may** depend on a package.
- A package **may never** depend on an application, or reach back into one.
- An application **may never** depend on another application. If `api` and `worker` need the same thing, that thing is a package — that is what the word means.

This is not merely a convention that review has to police. pnpm's isolated `node_modules` means a workspace project can import only what it **declares** ([ADR-0009](../decisions/ADR-0009-runtime-language-and-package-manager.md)). An undeclared cross-boundary import does not resolve. The package manager enforces the rule; review does not have to remember it.

**The direction still holds, unchanged, with three packages in the tree.** `@qf-jarvis/event-backbone` depends on **nothing in this workspace** — not on `contracts`, not on an application. Its only dependency is `pg`. `@qf-jarvis/event-ingestion` (Stage 3.2) also depends on **nothing in this workspace** and has **no third-party runtime dependency at all** — `node:crypto` only. And `apps/api` and `apps/worker` still import nothing: none has grown a dependency on any package. A shared module that already reached across to another shared module in its first stage would have told you the boundary was drawn in the wrong place.

---

## The `api` boundary

**What it is.** The synchronous, request-driven surface: eventually the founder control plane's backing API, recommendation queries, and evidence retrieval.

**What it is today.** A documentation comment and `export {};`. No HTTP server, no framework, no route, no health check, no dependency.

**Why empty is the point.** An empty boundary that compiles is a _structure_ — it asserts where code will go and claims nothing about what it does. A placeholder implementation is a _liability_ — it is indistinguishable from an intention, and the first real feature gets shaped by a decision nobody made. Phase 1 excludes business logic "of any kind — including 'just a small placeholder'" ([phased-roadmap.md](../architecture/phased-roadmap.md)).

A web framework is not chosen until a phase actually needs one. Choosing it now would be choosing it with the least information we will ever have.

## The `worker` boundary

**What it is.** The asynchronous surface: durable event ingestion, idempotent processing, replay, agent runs, and the evaluation loop.

**What it is today.** A documentation comment and `export {};`. No loop, no scheduler, no queue client, no consumer.

**Why it is separate from `api` on day one.** This is the one seam we already have evidence for — Phase 0 told us it is there. The two workloads differ in the ways that matter:

|               | `api`                     | `worker`                                          |
| ------------- | ------------------------- | ------------------------------------------------- |
| Trigger       | An inbound request        | An event, or a schedule                           |
| Duration      | Short, synchronous        | Long-running, retryable                           |
| Failure model | The caller sees the error | Retry, dead-letter, replay                        |
| Idempotency   | Per request               | **Load-bearing** — at-least-once delivery, always |

Phase 3's event backbone is _"the load-bearing infrastructure of the entire system."_ Drawing this boundary on an empty repository costs nothing; discovering it in Phase 3, after ingestion has grown inside a request handler, costs a refactor that competes with delivering Phase 3 — and loses.

## Shared packages

### `@qf-jarvis/contracts` — the first

Phase 2 created it: the versioned, runtime-validatable data contracts — canonical events, recommendations, approval decisions, execution intents, execution results, and governed communication lifecycle records ([ADR-0003](../decisions/ADR-0003-event-driven-integration.md), [ADR-0012](../decisions/ADR-0012-runtime-contract-validation.md), [ADR-0013](../decisions/ADR-0013-canonical-event-envelope-and-versioning.md), [ADR-0014](../decisions/ADR-0014-governed-lifecycle-contracts.md)).

It clears the bar without argument: every later phase depends on it, and a contract two systems must agree on is exactly what a versioning obligation and a review surface are for.

It contains **no business logic and no transport**. It is data and validation — importing it cannot cause an effect. **No application imports it yet**, and that is correct: Phase 2 defines contracts, it does not wire them into anything. The first consumer is Phase 3's ingestion.

Documentation: [docs/contracts/](../contracts/).

### `@qf-jarvis/event-backbone` — the second

Phase 3, Stage 3.1 created it, and it currently holds **the PostgreSQL persistence foundation and nothing else**: a validated database configuration, a connection pool, a transaction helper, a forward-only migration runner with checksum verification, and the immutable canonical event log ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md)).

**What is deliberately not in it: no ingestion, no signature verification, no deduplication behaviour, no projections, no checkpoints, no retries, no dead letters, no replay, no test emitter, and no worker loop.** Those are later stages of Phase 3, each with its own Accepted ADR. The `UNIQUE (event_id)` constraint lays the _foundation_ for eventId idempotency; it is not yet the behaviour that distinguishes a benign duplicate from a conflicting one, and the package does not claim it is.

Two structural properties are worth naming, because they are what keep this package a _module_ rather than an ambient service:

- **Importing it connects to nothing.** There is no module-level pool and no ambient configuration. `createDatabasePool` is a function a caller invokes with an explicit config.
- **Library code reads no environment.** The only reader of `DATABASE_URL` is `migrate-cli.ts`, because a CLI is a process boundary. A library that reaches into `process.env` behaves according to something the caller cannot see and a test cannot control.

**No application imports it yet**, and that is correct: Stage 3.1 provides persistence. Stage 3.2 adds pure signature verification in a **separate** package (`event-ingestion`) that does **not** touch persistence; **Stage 3.3** is where ingestion composes the verifier, contract validation, and this persistence. `apps/api` and `apps/worker` remain `export {};`.

The database it talks to is **Jarvis's own** — never QuickFurno Core's database, **never QuickFurno Core's Supabase project**, never a QuickFurno business table ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md), [ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §2). Deployment uses a **dedicated, Supabase-managed QF-Jarvis project** ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md)), as a Postgres host and nothing more — **the package's only dependency is still `pg`, and there is no `@supabase/supabase-js` in this repository.**

**Every object it creates lives in the private `qf_jarvis` schema, never in `public`**, and every reference to one is fully qualified — nothing depends on an ambient `search_path`. The schema is revoked from `PUBLIC`, and from the provider's own roles wherever those roles exist, on **every** migration run.

Documentation: [packages/event-backbone/README.md](../../packages/event-backbone/README.md) · [event-backbone.md](../architecture/event-backbone.md) · [development-setup.md](./development-setup.md).

### `@qf-jarvis/event-ingestion` — the third

Phase 3, Stage 3.2 created it, and it currently holds **pure Ed25519 signature verification and nothing else**: the `verifySignature` function, a validated public-key registry, the strict envelope parser, and the protocol constants ([ADR-0027](../decisions/ADR-0027-stage-3-2-signature-verification-protocol.md)). It is the **trust boundary in front of the event log** — the layer that authenticates what arrives from Core before anything believes it.

**What is deliberately not in it: no ingest function, no persistence, no contract parsing, no idempotency, no deduplication, no dead letters, no replay, no HTTP endpoint, and no worker loop.** Those are **Stage 3.3 (validated signed ingestion) and later**, which _compose_ this verifier with `@qf-jarvis/contracts` (validation) and `@qf-jarvis/event-backbone` (persistence). Stage 3.2 refuses a forged, altered, stale, or wrongly-keyed body; it does not yet decide what a good one becomes.

**It depends on nothing** — not `contracts`, not `event-backbone`, not `pg`; `node:crypto` only. It reads no environment, file, or network: time and keys are injected. Importing it causes no effect.

**Reconciling the "two or more real consumers" bar.** This package is created ahead of its consumers, which is normally exactly what the bar forbids. It is justified not by "it feels shared" but by an **owner-approved architectural decision**: [ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §10 already established that _"ingestion is a package,"_ and [ADR-0027](../decisions/ADR-0027-stage-3-2-signature-verification-protocol.md) accepts the staged boundary in which Stage 3.2 seeds the package with the verifier and its two real consumers arrive next — the Stage 3.3 ingest path in `worker`, and `apps/api` in Phase 11. A new package remains an architectural change reviewed as one; here that review happened, and it is recorded. **No application imports it yet**, and `apps/api` and `apps/worker` remain `export {};`.

Documentation: [packages/event-ingestion/README.md](../../packages/event-ingestion/README.md).

### The bar for the next one

**A new package is justified when two or more consumers genuinely need the same thing, and that thing has a boundary someone can name.** It is not justified by "this feels shared" (one consumer is not sharing), by "we will need it eventually" (then create it eventually), or by "it keeps `apps/` tidy" (tidiness is not a boundary).

There will be no `packages/utils`. A package with no boundary attracts everything, and then everything depends on it.

---

## How ADR-0004 is applied here

[ADR-0004](../decisions/ADR-0004-modular-monolith-first.md) requires that **module boundaries be drawn where a service boundary would go**, so that extraction is later a deployment change rather than a rewrite. This layout is that instruction, made concrete:

| ADR-0004 says                                          | This repository does                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| One deployable unit, strict internal boundaries        | One workspace; `api` and `worker` are separate projects                                     |
| Boundaries drawn where a service boundary would go     | The `api`/`worker` split is exactly where one would go                                      |
| Modules communicate through explicit interfaces        | Cross-boundary code must become a package. Undeclared imports do not resolve                |
| **Agents are modules, not services**                   | There is no `packages/kabir`. Agents will be modules **inside `worker`**, behind interfaces |
| Extraction requires _evidence_, not "it feels cleaner" | Unchanged. A new package or a new app is an architectural change, and gets reviewed as one  |

**Agents get no package each.** Giving Kabir, Riya, Anisha, and Jitin a package apiece because they have human names is ADR-0004's "design by anthropomorphism" arriving through the back door. They are reasoning components behind interfaces — modules in `worker`, sharing almost everything, deployed together.

### Boundaries the compiler does not enforce

Inside an application, module boundaries — ingestion, coordination, each agent, evaluation — are enforced by **review, not by the compiler**. A cross-module import that bypasses an interface is a **review blocker**, not a style comment ([change-management.md](../governance/change-management.md)).

This is the main cost of the modular monolith, ADR-0004 accepted it explicitly, and no directory layout removes it. Saying so plainly is better than pretending the structure solved it.

---

## Two rules about what does not go here

### No domain logic in tooling or configuration

Configuration configures tools. It does not encode business rules.

A threshold, a lead-quality rule, a vendor limit, or an approval level in an ESLint config, a `tsconfig`, a CI workflow, or a build script is domain logic hiding somewhere nobody will look for it — and somewhere no test covers. Business rules live in modules with names, and the deterministic ones are developed **test-first** ([engineering-principles.md](../governance/engineering-principles.md) §2).

Phase 1 has no domain logic to misplace. The rule is written down now so that it is already the rule when there is.

### No direct provider integrations in Jarvis — ever

This is not a Phase 1 convention. It is [the permanent boundary](../architecture/system-boundary.md), and it is authoritative.

**No code in this repository — in any application, in any package, in any phase — may:**

- call n8n, or dispatch an execution intent;
- call a communication or advertising provider: WhatsApp, SMS, email, voice, telephony, SIP, CRM, Google Ads, Meta Ads, or any other;
- hold or store a provider credential;
- write QuickFurno Core's business state;
- authorize anything, including its own recommendations;
- record or render an action as approved, delivered, or complete before Core's authoritative result returns.

**The four edges that do not exist:** Jarvis → provider · Jarvis → n8n · Jarvis → business state · agent → approval.

Introducing any of them is a boundary violation. It requires a superseding ADR and the business owner's explicit decision — not a code review comment, and not a sprint deadline.

The reason this survives contact with a real deadline is that it is not a permission check that could be misconfigured: **Jarvis holds no credential and has no integration.** A fully compromised agent still cannot dial anyone. Its maximum output is a misleading recommendation aimed at a human who can see the evidence ([security-principles.md](../governance/security-principles.md)).

---

## The question every pull request is judged against

> **Could this change let a recommendation cause an effect without an authorization decision recorded in QuickFurno Core?**

If yes, it does not merge, regardless of what it fixes.

CI cannot answer that question. A human must ([change-management.md](../governance/change-management.md)).
