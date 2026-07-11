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
├── packages/                    Shared modules — EMPTY, reserved for Phase 2
│   └── README.md
│
├── docs/                        Charter, architecture, decisions, governance, engineering
├── scripts/clean.mjs            Cross-platform artifact removal
├── .github/workflows/ci.yml     The quality gate
│
├── package.json                 Root: scripts and dev tooling. No runtime dependencies
├── pnpm-workspace.yaml          Workspace members and supply-chain policy
├── tsconfig.base.json           Shared strict compiler options
├── tsconfig.json                Solution config — references every project
├── eslint.config.mjs
├── prettier.config.mjs
└── vitest.config.mjs
```

---

## `apps/` versus `packages/`

|                    | `apps/*`                     | `packages/*`                            |
| ------------------ | ---------------------------- | --------------------------------------- |
| **Is**             | A deployable boundary        | A shared module                         |
| **Depends on**     | `packages/*`                 | Nothing in this repository              |
| **Depended on by** | Nothing                      | `apps/*`                                |
| **Justified by**   | A distinct workload          | **Two or more real consumers**          |
| **Today**          | `api`, `worker` — both empty | Empty. First package arrives in Phase 2 |

### Dependency direction — one way, and enforced

```
apps/*  ──depends on──▶  packages/*
```

- An application **may** depend on a package.
- A package **may never** depend on an application, or reach back into one.
- An application **may never** depend on another application. If `api` and `worker` need the same thing, that thing is a package — that is what the word means.

This is not merely a convention that review has to police. pnpm's isolated `node_modules` means a workspace project can import only what it **declares** ([ADR-0009](../decisions/ADR-0009-runtime-language-and-package-manager.md)). An undeclared cross-boundary import does not resolve. The package manager enforces the rule; review does not have to remember it.

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

## Future shared packages

`packages/` is registered as `packages/*` in the workspace and holds only a README, so the first package needs a package and not a workspace change.

**The first one is Phase 2's contracts** — canonical events, recommendations, approval decisions, execution intents, execution results ([ADR-0003](../decisions/ADR-0003-event-driven-integration.md)). **Do not create it now.** An empty contracts package invites the first person who needs a type to put it there, and the contracts would then be _discovered by implementation_ rather than agreed by design — which [engineering-principles.md](../governance/engineering-principles.md) §1 forbids by name.

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
