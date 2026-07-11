# QF Jarvis

QF Jarvis is the intelligence, recommendation, coordination, and decision-support system for the QuickFurno ecosystem.

## Permanent Architecture Boundary

- QuickFurno Core = source of truth, policy, authorization, and operational state
- QF Jarvis = intelligence, reasoning, recommendations, coordination, and prioritization
- n8n = approved execution fabric
- External Providers = WhatsApp, SMS, Email, Ads, CRM, Voice, and other delivery channels

## Core Rule

Jarvis recommends.
QuickFurno authorizes.
n8n executes.
Providers deliver.
Results return to QuickFurno Core.

This repository is being rebuilt from zero using a contract-first, event-driven, modular architecture designed for long-term compatibility with QuickFurno.

---

## What QF Jarvis is

QF Jarvis is the reasoning and coordination layer for QuickFurno. It ingests
versioned facts and events, reasons over them, and produces **structured
recommendations and execution intents** for humans and for QuickFurno Core to
authorize.

## What QF Jarvis is not

- It is **not** the system of record. It never owns business truth.
- It does **not** mutate QuickFurno business state (leads, clients, vendors,
  wallets, packages, money) directly.
- It does **not** talk to delivery providers (WhatsApp, SMS, email, ads, voice,
  CRM) directly. Approved execution runs through n8n.
- It is **not** an autonomous actor. Jarvis recommends; QuickFurno authorizes;
  n8n executes; providers deliver; results return to QuickFurno Core.

See [`docs/architecture/system-boundary.md`](docs/architecture/system-boundary.md)
for the authoritative boundary.

## Phase 0A scope — Engineering Foundation

This phase establishes a clean, testable, production-oriented TypeScript
monorepo that later phases extend. It contains **no** business logic.

Delivered in Phase 0A:

- pnpm workspace with two apps and three shared packages
- strict TypeScript (ESM, project references)
- a Fastify API with health + metadata endpoints and graceful shutdown
- a worker process with the same lifecycle and logging, doing no work yet
- Zod-based environment validation, centralized per service
- a shared structured (Pino) logger used by both apps
- foundation-level shared contracts (health/service-status schemas)
- Vitest test suites, ESLint, Prettier, and a single `pnpm check` gate
- GitHub Actions CI running that gate

Explicitly **not** in this phase: any AI/LLM SDK, database, Prisma/Drizzle,
Supabase, n8n integration, QuickFurno coupling, queues/Redis, or a frontend.

## Repository structure

```
qf-jarvis/
├── apps/
│   ├── jarvis-api/        Fastify HTTP service (health + metadata)
│   └── jarvis-worker/     long-running worker (lifecycle only, no jobs yet)
├── packages/
│   ├── contracts/         @qf/contracts — Zod schemas + inferred types
│   ├── observability/     @qf/observability — shared Pino logger
│   └── testing/           @qf/testing — shared deterministic test helpers
├── docs/
│   ├── architecture/      system boundary
│   ├── decisions/         architecture decision records (ADRs)
│   └── runbooks/          operational runbooks
├── .github/workflows/     CI
├── tsconfig.base.json     shared strict compiler options
├── tsconfig.json          solution file wiring project references
├── eslint.config.js       flat ESLint config
├── vitest.config.ts       single root test config
└── pnpm-workspace.yaml
```

## Prerequisites

- **Node.js 24 LTS** (`node --version` → v24.x)
- **pnpm 11+** (`corepack enable` or install globally)

## Installation

```bash
pnpm install
```

## Development commands

```bash
pnpm dev            # run api + worker in watch mode (tsx)
pnpm build          # compile all packages/apps (tsc -b) to dist/
pnpm typecheck      # type-check the whole graph (tsc -b)
pnpm lint           # ESLint
pnpm format         # Prettier (write)
pnpm format:check   # Prettier (verify)
pnpm test           # Vitest (run once)
```

Run a single service directly after building:

```bash
node apps/jarvis-api/dist/server.js
node apps/jarvis-worker/dist/index.js
```

## Testing

```bash
pnpm test
```

Tests are deterministic (no timers, no sleeps, no real ports). API routes are
tested with Fastify's `inject()`; the logger is asserted against an in-memory
capture stream.

## Quality gate

One command runs every gate, in order, failing on the first problem. This is
exactly what CI runs:

```bash
pnpm check          # format:check → lint → typecheck → test → build
```

## Health endpoints (jarvis-api)

| Method | Path            | Response                                                              |
| ------ | --------------- | --------------------------------------------------------------------- |
| GET    | `/health/live`  | `{ "status": "ok" }`                                                  |
| GET    | `/health/ready` | `{ "status": "ready" }`                                               |
| GET    | `/`             | `{ "service": "qf-jarvis-api", "status": "running", "version": "…" }` |

`/health/live` is unconditional (process liveness). `/health/ready` returns
ready because Phase 0A has no external dependencies; real readiness checks
arrive in later phases. `/` exposes only stable, non-secret metadata.

## API vs Worker — how they differ

|          | jarvis-api                           | jarvis-worker                   |
| -------- | ------------------------------------ | ------------------------------- |
| Shape    | HTTP service (Fastify)               | long-running background process |
| Surface  | `/`, `/health/live`, `/health/ready` | none (no HTTP) in Phase 0A      |
| Purpose  | synchronous request/response         | future event/async processing   |
| Shutdown | close the server, then drain         | clear timers, then drain        |

Both load Zod-validated config, use the same `@qf/observability` logger, log a
structured startup event, and shut down gracefully on `SIGTERM`/`SIGINT`.

## Current implementation status

Phase 0A is **complete**: `pnpm check` passes (format, lint, typecheck, 39
tests, build). There is no AI, no database, no n8n integration, no QuickFurno
coupling, and no dashboard — by design.

## Security posture (Phase 0A)

- No secrets in the repository; only `.env.example` is tracked.
- Secrets are redacted from logs by the shared logger as defence-in-depth.
- All external configuration is validated at startup and fails fast.
- HTTP error responses never expose stack traces.
- Dependencies are lockfile-pinned; build scripts are explicitly vetted.

Authentication is intentionally absent because there are no business endpoints
yet. **Before any QuickFurno integration, internal service authentication and
signed event intake are mandatory** — see the ADRs.

## Next phase — Phase 1: Contracts and Event Foundation

Phase 1 introduces the Canonical Event Envelope and the versioned business
event/recommendation contracts that QuickFurno and Jarvis exchange, plus signed
event intake. It builds directly on `@qf/contracts` without changing this
foundation.

## Architecture decisions

- [ADR-0001 — Modular monolith first](docs/decisions/ADR-0001-modular-monolith.md)
- [ADR-0002 — Contract-first integration](docs/decisions/ADR-0002-contract-first-integration.md)
