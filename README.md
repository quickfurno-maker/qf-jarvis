# QF Jarvis

QF Jarvis is the intelligence, recommendation, coordination, and founder decision-support layer for the QuickFurno ecosystem.

## Permanent Architecture Boundary

- QuickFurno Core owns business truth, operational state, authorization, policy, money, leads, clients, vendors, packages, and wallets.
- QF Jarvis provides intelligence, reasoning, recommendations, coordination, prioritization, and specialist-agent orchestration.
- n8n executes only actions authorized by QuickFurno Core or an approved human authority.
- External providers deliver communications and operational actions.
- Execution results return to QuickFurno Core.

The authoritative statement of this boundary is [docs/architecture/system-boundary.md](docs/architecture/system-boundary.md). Where any other document differs from it, that document is a defect.

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

## Current Status

**Phase 0 — Project Charter and Architecture: documentation in progress, pending review by the business owner.**

Phase 0 is not complete. Its documents exist and are internally consistent, but the phase closes only when the business owner has reviewed and approved the charter and the boundary.

This repository is **implementation-free by design**. No application framework, database, AI SDK, agent runtime, workflow integration, provider integration, frontend, CI, or deployment architecture has been implemented — and none will be until Phase 1. There is no package manager, no dependency manifest, and no application code.

## Documentation

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
