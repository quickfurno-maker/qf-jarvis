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

**There is no business implementation, and nothing runs.**

`apps/api` and `apps/worker` exist as **compileable boundaries**: each is a documentation comment and `export {};`. They start no server, run no loop, and print nothing. There is no `pnpm dev` and no `pnpm start`, because there is nothing to start — and adding a placeholder to make the repository feel more alive is explicitly out of scope ([ADR-0010](docs/decisions/ADR-0010-workspace-and-module-structure.md)).

Specifically, **none of the following exists in this repository**: agents, coordinator logic, AI or LLM SDKs, model prompts, canonical event contracts, recommendation or approval or execution contracts, event processing, a database, a queue, a web framework, a frontend, n8n workflows, WhatsApp or calling or telephony integration, provider credentials, environment configuration, Docker, or deployment configuration.

**Phase 2 — Contracts and Canonical Events is the next phase. It has not started.**

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

### Governance

- [Engineering principles](docs/governance/engineering-principles.md)
- [Security principles](docs/governance/security-principles.md)
- [Privacy principles](docs/governance/privacy-principles.md)
- [Auditability principles](docs/governance/auditability-principles.md)
- [Automation levels](docs/governance/automation-levels.md) — the system starts at Level 0
- [Change management](docs/governance/change-management.md) — one phase per branch

## Business Context

QuickFurno is a local home-service vendor discovery and lead-generation marketplace, connecting clients with verified local professionals in interior design, carpentry, modular factories, premium interiors, sofa work, painting, and civil work.

Pune is the first operational city; Mumbai and additional cities follow later. A qualified lead may be shared with a maximum of three suitable vendors — a QuickFurno Core business rule, enforced by QuickFurno Core, not by QF Jarvis.

## Contributing

One phase per branch, named `phase-N-short-description`. Architecture changes require an ADR. See [change management](docs/governance/change-management.md).

Run `pnpm check` before you push — it is the same gate CI runs. **CI blocks merge on failure**: `main` requires the **Quality gate** status check to pass, and administrators cannot bypass it ([continuous-integration.md](docs/engineering/continuous-integration.md)).

The question every pull request is judged against:

> **Could this change let a recommendation cause an effect without an authorization decision recorded in QuickFurno Core?**

If yes, it does not merge, regardless of what it fixes.
