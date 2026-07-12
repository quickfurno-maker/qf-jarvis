# QF Jarvis

QF Jarvis is the intelligence, recommendation, coordination, and founder decision-support layer for the QuickFurno ecosystem.

## Permanent Architecture Boundary

- QuickFurno Core owns business truth, operational state, authorization, policy, money, leads, clients, vendors, packages, and wallets.
- QF Jarvis provides intelligence, reasoning, recommendations, coordination, prioritization, and specialist-agent orchestration.
- n8n executes only actions authorized by QuickFurno Core or an approved human authority.
- External providers deliver communications and operational actions.
- Execution results return to QuickFurno Core.

The authoritative statement of this boundary is [docs/architecture/system-boundary.md](docs/architecture/system-boundary.md). Where any other document differs from it, that document is a defect.

**The boundary is unchanged by Phase 1.** It may be changed only by a superseding ADR, never by an implementation decision, and never by convenience.

## Permanent Rule

Jarvis recommends.

QuickFurno authorizes.

n8n executes.

Providers deliver.

Results return to QuickFurno Core.

## Specialist Agents

- Jarvis — coordination, synthesis, prioritization, and founder briefings
- Kabir — lead quality, verification, fraud risk, and operations intelligence
- Riya — client relationship, follow-up, nurture, and reactivation intelligence
- Anisha — vendor acquisition, onboarding, package, recharge, retention, and win-back intelligence
- Jitin — marketing, campaign, SEO, channel, and growth intelligence

Agents recommend only. They do not authorize and they do not execute.

**None of them is implemented.** They are a design, described in [agent-model.md](docs/architecture/agent-model.md). Jarvis coordination is introduced in Phase 4. Kabir, Riya, Anisha, and Jitin are introduced in Phases 5 through 8.

## Current Status

**Phase 0 — Project Charter and Architecture: complete and approved.**

The business owner has approved the charter and the permanent architecture boundary. All Phase 0 exit criteria are met: the documentation set is complete and internally consistent, no document contradicts the [system boundary](docs/architecture/system-boundary.md), and **eight ADRs are Accepted** (ADR-0001 through ADR-0008).

**Phase 1 — Engineering Foundation: complete and approved.**

The repository now contains an **engineering toolchain and nothing else**: a pnpm workspace, strict TypeScript, ESLint, Prettier, Vitest, a CI quality gate, and three new ADRs recording those choices. Three further ADRs are Accepted (ADR-0009 through ADR-0011), bringing the total to eleven.

**All Phase 1 exit criteria are met:**

- The repository can be **installed from a clean clone** — `pnpm install --frozen-lockfile` resolves from the committed lockfile.
- **Formatting, linting, type checking, tests, and build all pass** — `pnpm check` runs the complete gate and is green.
- **CI runs on every pull request** ([ci.yml](.github/workflows/ci.yml)).
- **`main` is protected**: the **Quality gate** status check is required, branches must be up to date before merging, a pull request is required, and **administrators cannot bypass the protection**. A red Quality gate cannot be merged — by anyone.
- **ADR-0009 through ADR-0011 are Accepted**, so every foundational technology choice is recorded.

**Phase 2 — Contracts and Canonical Events: complete and approved.**

The business owner approved Phase 2 on **2026-07-12**.

The repository now contains [`@qf-jarvis/contracts`](packages/contracts/) — versioned, runtime-validatable **data contracts** for canonical events, recommendations, approval requests and decisions, execution intents and results, governed communication lifecycle records, vendor assignment and reassignment, cross-category linked leads, and agent memory and learning.

**Eighteen ADRs are Accepted.** ADR-0012 through [ADR-0018](docs/decisions/ADR-0018-governed-request-communication-and-control-contracts.md) were accepted by the business owner alongside Phase 2, joining ADR-0001 through ADR-0011.

**Every contract in the package is governed by exactly one ADR:** the authorized-effect chain by [ADR-0014](docs/decisions/ADR-0014-governed-lifecycle-contracts.md), requests and communication authority by [ADR-0018](docs/decisions/ADR-0018-governed-request-communication-and-control-contracts.md), the client journey and reassignment by [ADR-0015](docs/decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md), and memory and learning by [ADR-0016](docs/decisions/ADR-0016-agent-memory-and-learning-boundaries.md).

The revised requirements are recorded in [quickfurno-compatibility-directive.md](docs/architecture/quickfurno-compatibility-directive.md), which is authoritative and approved.

**All Phase 2 exit criteria are met:**

- **973 tests pass** across 11 files, **none skipped**. 98 valid fixtures, 171 invalid fixtures.
- **41 canonical events registered**, every one with a valid fixture — a contract cannot be registered and left unexercised.
- **31 contracts**, each versioned, strict, and covered by `parse`/`safeParse` and fixtures.
- **`pnpm check` is green** — format, lint, typecheck, test, build.
- Personal data is minimized and justified; deletion propagation is representable and checkable.

**Phase 2 creates contracts, not transport.** The contracts describe shapes; they move nothing and they **cannot cause an effect**. Parts of the permanent boundary are now _structural_ rather than merely documented:

- A recommendation's `producingSystem` can only be `qf-jarvis`, and a recommendation is inert — no `approved` field, no recipient address, no credential.
- An **approval request** is a separate contract from an approval **decision**. It has no outcome field, and one cannot be added. **An unanswered request expires; it never ripens into an approval** — silence is never consent.
- An approval decision's `issuer` can only be `quickfurno-core`, and its deciding actor can only be a **human or a versioned policy**. There is no agent variant, so **agent self-approval is unrepresentable**.
- An execution intent's `issuer` can only be `quickfurno-core` and its `executor` only `n8n`. **Jarvis cannot construct a valid execution intent**, and there is no provider to address one to.
- An ambiguous execution result **cannot be recorded as a success**, and **`provider-accepted` cannot be recorded as `delivered`**.
- A communication recipient can only be an opaque Core reference; a phone number or email address will not parse. There is **no consent field** — the QuickFurno Communication Core decides, and a stale copy of a permission cannot exist because there is nowhere to put one.
- An assignment batch can only be issued by `quickfurno-core`. **Riya cannot construct one.** Three vendors per batch, one replacement batch, **six unique vendors per lead-category, for all time** — and a seventh does not parse ([ADR-0015](docs/decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md)).
- Agent memory carries `authoritative: false` and `rebuildable: true` as **literals**. Memory that claimed to be authoritative would not parse, and **QuickFurno truth overrides memory, always** ([ADR-0016](docs/decisions/ADR-0016-agent-memory-and-learning-boundaries.md)).
- **No data becomes training data automatically.** Eligibility exists only as an explicit decision by a named human or versioned policy, against complete provenance. **Sensitive personal data is never eligible.**

**There is still no business implementation, and nothing runs.**

`apps/api` and `apps/worker` remain **compileable boundaries** — a documentation comment and `export {};`. They start no server, run no loop, and print nothing. No application imports the contracts yet; the first consumer is Phase 3's ingestion.

Specifically, **none of the following exists in this repository**: agents, coordinator logic, AI or LLM SDKs, **a model gateway**, model prompts, event transport or ingestion, event persistence, message brokers or queues, webhooks, HTTP endpoints, a database, a web framework, a frontend, n8n workflows, WhatsApp or calling or telephony integration, provider integrations, provider credentials, environment configuration, Docker, or deployment configuration.

The client, vendor, assignment, and governance events are **target contracts**. **No claim is made that QuickFurno Core emits any of them today** — establishing the live emitters is Phase 11's work, and where Core's shapes differ, an adapter absorbs the difference and the contract does not bend ([event-catalog.md](docs/contracts/event-catalog.md)).

**Phase 3 — Durable Event Backbone has not started, and must not begin until Phase 2 is merged into `main`.**

## Getting Started

**Prerequisites:** Node.js **24.18.0** and pnpm **11.11.0**. Both are pinned, and the versions are enforced — an install on a different Node major fails rather than warns.

```bash
# Use the pinned pnpm (Corepack ships with Node; do not install pnpm globally)
corepack enable pnpm
corepack prepare pnpm@11.11.0 --activate

# Install
pnpm install

# Run the complete quality gate — this is exactly what CI runs
pnpm check
```

`pnpm check` runs `format:check` → `lint` → `typecheck` → `test` → `build`, and fails on the first problem.

The test suite is **empty, by design**. Phase 1 has no business logic, and a test that asserts nothing is worse than no test — it makes a green build mean "the fake tests still pass" rather than "the system works". From Phase 2, the critical deterministic rules — idempotency, expiry, authorization, bounds, signature and replay, and anything touching money — are developed **test-first**, without exception.

Full instructions, including per-platform commands and troubleshooting: [development-setup.md](docs/engineering/development-setup.md).

## Documentation

### Contracts

- [Contracts overview](docs/contracts/README.md) — what Phase 2 is, and what it defers
- [Contract principles](docs/contracts/contract-principles.md) — the rules every contract obeys
- [Canonical event envelope](docs/contracts/canonical-event-envelope.md)
- [Event catalog](docs/contracts/event-catalog.md) — the six registered events, and the ones deliberately absent
- [Recommendation contract](docs/contracts/recommendation-contract.md)
- [Approval and execution contracts](docs/contracts/approval-and-execution-contracts.md)
- [Communication contract](docs/contracts/communication-contract.md) — the eighteen authoritative states
- [Versioning and compatibility](docs/contracts/versioning-and-compatibility.md)
- [Privacy and data minimization](docs/contracts/privacy-and-data-minimization.md)
- [Testing and fixtures](docs/contracts/testing-and-fixtures.md)

### Engineering

- [Development setup](docs/engineering/development-setup.md) — prerequisites, install, and every command
- [Repository structure](docs/engineering/repository-structure.md) — apps, packages, dependency direction, and how ADR-0004 is applied
- [Supported toolchain](docs/engineering/supported-toolchain.md) — exact versions, verified peer compatibility, supply chain, update policy
- [Quality gates](docs/engineering/quality-gates.md) — what each gate catches, the zero-warning policy, and review blockers
- [Continuous integration](docs/engineering/continuous-integration.md) — triggers, least privilege, caching, frozen lockfile, and how failures block merge

### Charter

- [Project charter](docs/charter/project-charter.md) — purpose, scope, boundary, constraints, risks, definition of success
- [Product vision](docs/charter/product-vision.md)
- [Goals and non-goals](docs/charter/goals-and-non-goals.md)
- [Stakeholders and personas](docs/charter/stakeholders-and-personas.md)
- [Success metrics](docs/charter/success-metrics.md)
- [Glossary](docs/charter/glossary.md)

### Architecture

- [System boundary](docs/architecture/system-boundary.md) — **authoritative**
- [System context](docs/architecture/system-context.md)
- [Responsibility matrix](docs/architecture/responsibility-matrix.md)
- [Domain map](docs/architecture/domain-map.md)
- [Agent model](docs/architecture/agent-model.md)
- [Communication model](docs/architecture/communication-model.md) — Jarvis supports calling and WhatsApp through governed execution
- [Recommendation lifecycle](docs/architecture/recommendation-lifecycle.md)
- [Execution governance](docs/architecture/execution-governance.md)
- [Data ownership](docs/architecture/data-ownership.md)
- [Trust boundaries](docs/architecture/trust-boundaries.md)
- [Phased roadmap](docs/architecture/phased-roadmap.md) — Phases 0 through 15

### Decisions

- [ADR-0001 — Source of truth boundary](docs/decisions/ADR-0001-source-of-truth-boundary.md)
- [ADR-0002 — Recommend / authorize / execute model](docs/decisions/ADR-0002-recommend-authorize-execute-model.md)
- [ADR-0003 — Event-driven integration](docs/decisions/ADR-0003-event-driven-integration.md)
- [ADR-0004 — Modular monolith first](docs/decisions/ADR-0004-modular-monolith-first.md)
- [ADR-0005 — Human and policy approval](docs/decisions/ADR-0005-human-and-policy-approval.md)
- [ADR-0006 — Agent responsibility boundaries](docs/decisions/ADR-0006-agent-responsibility-boundaries.md)
- [ADR-0007 — Founder approval interface and authority](docs/decisions/ADR-0007-founder-approval-interface-and-authority.md)
- [ADR-0008 — Controlled communication capability (calling and WhatsApp)](docs/decisions/ADR-0008-controlled-communication-capability.md)
- [ADR-0009 — Runtime, language, and package manager](docs/decisions/ADR-0009-runtime-language-and-package-manager.md) — Node 24 LTS, TypeScript, pnpm 11, native ESM
- [ADR-0010 — Workspace and module structure](docs/decisions/ADR-0010-workspace-and-module-structure.md) — pnpm workspace, `apps/api`, `apps/worker`, future `packages/*`
- [ADR-0011 — Quality toolchain and continuous integration](docs/decisions/ADR-0011-quality-toolchain-and-continuous-integration.md) — strict TypeScript, ESLint, Prettier, Vitest, GitHub Actions
- [ADR-0012 — Runtime contract validation](docs/decisions/ADR-0012-runtime-contract-validation.md) — Zod, strict schemas, why types alone are insufficient at a trust boundary
- [ADR-0013 — Canonical event envelope and versioning](docs/decisions/ADR-0013-canonical-event-envelope-and-versioning.md) — the envelope, the static registry, failing closed on unknown versions
- [ADR-0014 — Governed lifecycle contracts](docs/decisions/ADR-0014-governed-lifecycle-contracts.md) — recommendation, approval, execution, communication, and why they cannot execute anything

### Governance

- [Engineering principles](docs/governance/engineering-principles.md)
- [Security principles](docs/governance/security-principles.md)
- [Privacy principles](docs/governance/privacy-principles.md)
- [Auditability principles](docs/governance/auditability-principles.md)
- [Automation levels](docs/governance/automation-levels.md) — the system starts at Level 0
- [Change management](docs/governance/change-management.md) — one phase per branch

## Business Context

QuickFurno is a local home-service vendor discovery and lead-generation marketplace, connecting clients with verified local professionals in interior design, carpentry, modular factories, premium interiors, sofa work, painting, and civil work.

Pune is the first operational city; Mumbai and additional cities follow later.

**Vendor assignment is a QuickFurno Core business rule, enforced by QuickFurno Core, and never by QF Jarvis.** The current policy:

- **Initial assignment batch: at most 3 eligible vendors.**
- **One replacement batch**, on genuine dissatisfaction **and explicit client confirmation**: at most **3 additional unique vendors**, none of whom appeared in the first batch.
- **Lifetime maximum: 6 unique vendors per lead-category**, for all time. There is no third batch.
- **QuickFurno Core alone creates and authorizes assignment batches.** Riya may _request_ a reassignment; she never assigns a vendor, and `ClientReassignmentRequestV1` has no field in which she could name one.
- **A cross-category requirement creates a separate linked lead** — its own identity, consent, verification, scoring, matching, and its own fresh batch of three.

This supersedes the earlier flat "maximum of three vendors per qualified lead" rule ([ADR-0015](docs/decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md), **Accepted 2026-07-12**).

## Contributing

One phase per branch, named `phase-N-short-description`. Architecture changes require an ADR. See [change management](docs/governance/change-management.md).

Run `pnpm check` before you push — it is the same gate CI runs. **CI blocks merge on failure**: `main` requires the **Quality gate** status check to pass, and administrators cannot bypass it ([continuous-integration.md](docs/engineering/continuous-integration.md)).

The question every pull request is judged against:

> **Could this change let a recommendation cause an effect without an authorization decision recorded in QuickFurno Core?**

If yes, it does not merge, regardless of what it fixes.
