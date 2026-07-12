# Development Setup

**Status:** Phase 1 — Engineering Foundation
**Date:** 2026-07-11

How to get from a clone to a green `pnpm check`. **From Stage 3.1 that route runs through a running PostgreSQL** — see [PostgreSQL 17](#postgresql-17--required-from-stage-31).

Commands are given for **Windows PowerShell** and **POSIX** (Linux, macOS, Git Bash). Where a command is identical on both — which is nearly all of them, because the toolchain is deliberately cross-platform — it is given once.

---

## Prerequisites

| Requirement                       | Version     | Why exactly this                                                                                                                                                                                                                                       |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node.js**                       | **24.18.0** | Pinned in `.nvmrc`, `.node-version`, `engines.node`, and CI. `engineStrict: true` in `pnpm-workspace.yaml` means an install on any other major **fails** rather than warns ([ADR-0009](../decisions/ADR-0009-runtime-language-and-package-manager.md)) |
| **pnpm**                          | **11.11.0** | Pinned in `packageManager`. Install it via Corepack, below — do not install it globally                                                                                                                                                                |
| **Git**                           | any recent  | —                                                                                                                                                                                                                                                      |
| **Docker + Compose v2**           | any recent  | Runs the local PostgreSQL. **Required from Stage 3.1** — see [PostgreSQL](#postgresql-17--required-from-stage-31) below                                                                                                                                |
| **PostgreSQL** (via the database) | **17.10**   | Pinned to the exact patch release in `compose.yml` **and** in CI, so a laptop and CI run the same database ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md))                                                                  |

You do **not** need to install TypeScript, ESLint, Prettier, or Vitest. They are development dependencies of this repository and are installed by `pnpm install`.

### 1. Install Node.js 24.18.0

The exact version matters. If you already manage Node versions, both `.nvmrc` and `.node-version` are present, so most version managers will pick it up automatically.

**nvm (POSIX) / nvm-windows**

```
nvm install 24.18.0
nvm use 24.18.0
```

**fnm, asdf, mise, Volta** — all read `.nvmrc` or `.node-version` from the repository root:

```
fnm use
```

**No version manager.** Download Node 24.18.0 from <https://nodejs.org/dist/v24.18.0/>, or:

```
# Windows (winget)
winget install OpenJS.NodeJS.LTS

# macOS (Homebrew)
brew install node@24
```

Verify — this must print `v24.18.0`:

```
node --version
```

> If it prints anything else, stop here. `pnpm install` will refuse to run, and it will be right to.

### 2. Enable pnpm 11.11.0 via Corepack

Corepack ships with Node. It reads the `packageManager` field in `package.json` and uses **exactly** that version of pnpm — which is how your pnpm and CI's pnpm are guaranteed to be the same.

```
corepack enable pnpm
corepack prepare pnpm@11.11.0 --activate
```

Verify — this must print `11.11.0`:

```
pnpm --version
```

> **Do not `npm install -g pnpm`.** A globally installed pnpm is a version nobody pinned, and it will eventually differ from CI's.

---

## Install

From the repository root:

```
pnpm install
```

**Reproducing CI exactly** — the lockfile is authoritative and the install fails if `package.json` and `pnpm-lock.yaml` disagree:

```
pnpm install --frozen-lockfile
```

This is what CI runs. Use it when you want to be certain you are running what was reviewed.

### Where the package-manager policy lives

**`pnpm-workspace.yaml`**, not `.npmrc`.

pnpm 11 reads project policy — exact saves, strict peers, engine enforcement, the target Node version, the release cooldown, the build-script allowlist — from `pnpm-workspace.yaml`, using camelCase keys. It reads only **authentication and registry** settings from `.npmrc`, and this repository declares neither.

Put project policy in `.npmrc` and pnpm **silently ignores it**: no warning, and `pnpm config get` reports the key as `undefined`. If you are changing a package-manager setting, change it in `pnpm-workspace.yaml` and then **prove it took effect**:

```
pnpm config get strictPeerDependencies
```

### What a healthy install looks like

- No peer-dependency warnings. The dependency set is verified compatible ([supported-toolchain.md](./supported-toolchain.md)); a peer warning means something changed and it needs investigating, not ignoring. `strictPeerDependencies: true` means an unmet peer **fails** the install rather than warning.
- **No "ignored build scripts" message.** No package in this dependency tree runs an install or build script, and `onlyBuiltDependencies` is deliberately empty. If pnpm ever reports an ignored build script, **do not run `pnpm approve-builds` to make it go away** — approving a build script grants that package arbitrary code execution at install time. Investigate it, then record the decision ([security-principles.md](../governance/security-principles.md)).

---

## PostgreSQL 17 — required from Stage 3.1

**Phase 1's exit criterion was: clone, install, run checks. From Stage 3.1 it is: clone, install, START THE DATABASE, run checks.**

That is a real regression in developer ergonomics, and it is named here rather than hidden. [ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §6 accepted it with its eyes open: the event backbone's entire job is to make _"the same event twice has the effect of once"_ an invariant the storage engine enforces, and that claim can only be proven against a real PostgreSQL. The alternative — testing against SQLite locally and PostgreSQL in production — was rejected outright, because a suite that green-lights code under a different concurrency model than the one it will run under has not tested the code; it has tested a lookalike.

So the database is now a prerequisite of the full gate, and it stays one.

### Start it

**PowerShell**

```powershell
$env:QF_JARVIS_POSTGRES_PASSWORD = "<a local-only password you choose>"
docker compose up -d --wait

$env:DATABASE_URL = "postgresql://qf_jarvis_dev:<that password>@127.0.0.1:55432/qf_jarvis_test"
pnpm.cmd db:migrate
pnpm.cmd check
```

**POSIX**

```
export QF_JARVIS_POSTGRES_PASSWORD="<a local-only password you choose>"
docker compose up -d --wait

export DATABASE_URL="postgresql://qf_jarvis_dev:<that password>@127.0.0.1:55432/qf_jarvis_test"
pnpm db:migrate
pnpm check
```

`docker compose up -d --wait` blocks until PostgreSQL's healthcheck passes, so `db:migrate` cannot race a database that is still booting. `--wait` is not decoration; without it the next command fails intermittently, and an intermittent failure is the kind nobody debugs.

> **`db:migrate` runs the _compiled_ CLI** (`packages/event-backbone/dist/persistence/migrate-cli.js`), so the workspace must have been built at least once — run `pnpm build` first on a fresh clone. CI builds before it migrates, for exactly this reason, and that step also proves the executable a deploy would call actually works, rather than only the runner the tests exercise.

### The database commands

| Command                                    | What it does                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:up`                               | `docker compose up -d --wait` — start PostgreSQL and wait until it is genuinely accepting connections                                    |
| `pnpm db:down`                             | Stop the container. **The volume survives**, so your data is still there when you bring it back up                                       |
| `pnpm db:migrate`                          | Apply the forward-only migrations in `packages/event-backbone/src/persistence/migrations/` to whatever `DATABASE_URL` points at          |
| `pnpm test:integration`                    | Run only the PostgreSQL tests. Requires `DATABASE_URL`                                                                                   |
| **`pnpm db:reset:destroy-all-local-data`** | **DESTRUCTIVE.** `docker compose down --volumes`, then up again — it **deletes the local volume**. Everything in `qf_jarvis_dev` is gone |

The reset script is named the way it is on purpose. A command called `db:reset` reads like "put it back how it was"; this one deletes a volume, and the name should say so before you press Enter, not after.

### Two databases, and why

| Database         | For                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------- |
| `qf_jarvis_dev`  | Yours. Experiment in it                                                                 |
| `qf_jarvis_test` | The test suite's. It **drops the `qf_jarvis` schema on every run** — keep nothing there |

`qf_jarvis_test` is created on first boot by `scripts/dev-postgres-init.sql`, which runs once, on an empty volume.

**The tests drop the `qf_jarvis` schema, and only that schema.** They do **not** touch `public`. An earlier version ran `DROP SCHEMA public CASCADE`, which was wrong: `public` is not ours — an extension, a provider, or a colleague may have put something in it, and a suite that destroys a shared schema to clean up after itself has a blast radius of the whole database rather than the one schema it created. There is a test asserting `public` survives.

### Two test suites: one parallel and database-free, one serial and real

| Command                 | Files                   | Execution    | `DATABASE_URL` |
| ----------------------- | ----------------------- | ------------ | -------------- |
| `pnpm test:unit`        | `*.test.ts`             | **parallel** | not used       |
| `pnpm test:integration` | `*.integration.test.ts` | **serial**   | **required**   |
| `pnpm test`             | both                    | —            | **required**   |
| `pnpm check`            | runs `pnpm test`        | —            | **required**   |

They are split because they need different things, and **the naming convention is the boundary: a test that needs PostgreSQL is named `*.integration.test.ts`.**

The integration tests drop and recreate the `public` schema so that each one starts from nothing, which means two of them running at once destroy each other mid-run. They must be serial. But making the _whole repository_ serial to achieve that would take a thousand database-free contract tests — no shared state, no I/O, nothing to wait for — and queue them behind a database. **The cost of a correct integration test should not be paid by every test that is not one.** So the serialisation lives in `vitest.integration.config.mjs` and stops there.

### The database tests fail without a database. They never skip.

- **Unit tests are database-free and always run.** They need nothing started.
- **Integration tests require `DATABASE_URL` and fail loudly without it.**

They do not skip, and that is deliberate. **A skipped database test is a green build that proves nothing** — the suite reports success, coverage looks fine, and the behaviour you believed was tested was never executed. On a machine with no database that is precisely the outcome you must not get, because proving the database behaviour is the entire point of the stage.

If `DATABASE_URL` is missing, the failure message tells you how to fix it rather than merely reporting that something is absent.

### The guards on the test database

The destructive test helpers drop and recreate a schema. A destructive operation pointed at the wrong host is how people lose production data at 2am, so the target is checked three ways and **all three must pass**:

1. The **host** is loopback — nothing else is permitted.
2. The **database name identifies it as a test database** (`qf_jarvis_test` does; `jarvis` does not).
3. The target contains **none of** `prod`, `production`, `live`, `supabase`, or `quickfurno`.

The guards are deliberately paranoid. The cost of a false refusal is a developer renaming a database; the cost of a false acceptance is unbounded.

### What this database is, and what it is not

**`compose.yml` is DEVELOPMENT ONLY, and it must never become production configuration.** There is no application container, no reverse proxy, no TLS, no backup, no resource limit, and no secret management in it. It exists so that a developer can run `pnpm check` on a laptop, and for nothing else ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §6). Phase 0 excluded Docker as a _deployment_ artifact; a local database for a developer is a different thing, and that distinction is recorded rather than assumed.

**The port is `127.0.0.1:55432`.** Loopback only — never `0.0.0.0`, because a laptop on café Wi-Fi should not be serving PostgreSQL. And `55432` rather than `5432`, so it cannot collide with a PostgreSQL a developer already runs, and cannot silently point the suite at it.

**The password has no default.** Compose's `:?` syntax makes startup **fail with a clear message** when `QF_JARVIS_POSTGRES_PASSWORD` is absent, rather than booting a database with a password somebody committed once and never rotated.

**The database is Jarvis's own.** Never QuickFurno Core's database. **Never QuickFurno Core's Supabase project.** Never a QuickFurno business table. A shared database is an integration point, and an integration point is one `UPDATE` away from being a write path — which is exactly the erosion the boundary exists to prevent ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md), [ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §2).

### Where the deployed database lives — and why it changes nothing here

Production PostgreSQL is a **dedicated, Supabase-managed QF-Jarvis project** ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md)) — **its own** project, credentials and blast radius, and **not QuickFurno Core's**.

**None of that is a development concern, and it must not become one:**

|                         |                                                                      |
| ----------------------- | -------------------------------------------------------------------- |
| **Your local database** | The loopback PostgreSQL 17 above. **Not Supabase**                   |
| **CI's database**       | The GitHub Actions PostgreSQL 17 service. **Not Supabase**           |
| **QF-Jarvis Supabase**  | A **deployment** target. Not a development target, not a test target |

**Do not point `DATABASE_URL` at Supabase to run the tests.** They drop the `qf_jarvis` schema. The guard below will refuse — and that refusal is the point, because the target it is now protecting is Jarvis's own event log.

Supabase is used **only as a Postgres host**: no Auth, no Storage, no Realtime, no Edge Functions, no Data API, and **`@supabase/supabase-js` must not be added**. The driver is `pg`; the configuration is `DATABASE_URL`. **Nothing above the driver knows who the provider is**, which is exactly what keeps a laptop, a CI runner, and production running the same code against the same engine.

### Everything Jarvis owns lives in the `qf_jarvis` schema

Not in `public`. The event log, the migration history, the functions, the triggers, the indexes — all of it, and every reference to it is fully qualified. **Nothing depends on `search_path`**, so nothing breaks when a pooler hands back a different session ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §3).

If you write a diagnostic query by hand, qualify it: `SELECT * FROM qf_jarvis.event`, not `SELECT * FROM event`.

### Connection mode: direct or session-mode. Never transaction-mode.

`createDatabaseConfig` **refuses** a Supabase Supavisor **transaction-mode** pooler (port `6543`) — for every pool, not just `db:migrate`.

The package depends on **session state**: `pg_advisory_lock()` for the migration lock, and `statement_timeout` and `application_name` set on connect. Transaction pooling multiplexes clients across backends, so the migration lock could be taken on one session and released on another. **It would fail silently** — green logs, migrations applied, and no serialisation between two concurrent migrators. Hence a hard error rather than a warning ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §6).

**Your local database on `127.0.0.1:55432` is not affected.** The guard keys on a Supabase host, not on an unusual port.

### Local PostgreSQL versions

**PostgreSQL major 17 is the requirement.** `compose.yml` and CI pin the exact image (`17.10-alpine`) so a laptop and a CI runner agree with _each other_. The managed deployment database runs a provider-chosen 17.6.x build — **that is expected, and it is not a problem to fix.** Major 17 is the contract; the patch level is not ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §7).

---

## Everyday commands

All are run from the repository root and behave identically on Windows and POSIX.

| Command                 | What it does                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm format`           | Rewrite files to Prettier's formatting                                                                      |
| `pnpm format:check`     | Fail if anything is unformatted — no writes                                                                 |
| `pnpm lint`             | ESLint, **zero warnings tolerated**                                                                         |
| `pnpm typecheck`        | Type-check every project                                                                                    |
| `pnpm test`             | **Both suites**: `test:unit` then `test:integration`. Requires `DATABASE_URL`                               |
| `pnpm test:unit`        | Database-free tests only, in **parallel**. Needs no database                                                |
| `pnpm test:integration` | The PostgreSQL tests only, **serially**. Requires `DATABASE_URL` and **fails without it**                   |
| `pnpm test:watch`       | Vitest in watch mode, over the **unit** suite                                                               |
| `pnpm build`            | Compile every project, then copy `.sql` assets into `dist/` (`scripts/copy-sql-assets.mjs`). Starts nothing |
| `pnpm clean`            | Remove generated build and test artifacts                                                                   |
| **`pnpm check`**        | **The full gate: format:check → lint → typecheck → test → build**                                           |

The database commands — `db:up`, `db:down`, `db:migrate`, `db:reset:destroy-all-local-data` — are documented [above](#the-database-commands).

### Before you push

```
pnpm check
```

This is the exact command CI runs. **It needs the database running and `DATABASE_URL` set**; without them the integration tests fail, which is the design.

If it is green locally and red in CI, that is a bug in the setup, not in your patch — please report it.

### Working on one application

Each application type-checks and builds independently:

```
pnpm --filter @qf-jarvis/api typecheck
pnpm --filter @qf-jarvis/worker build
```

### Cleaning

```
pnpm clean
```

Removes `dist/` and `tsconfig.tsbuildinfo` from every workspace project — `apps/*` **and** `packages/*` — plus `coverage/` and `.eslintcache`. It is a small Node script (`scripts/clean.mjs`) rather than `rm -rf`, because `rm -rf` does not exist on Windows PowerShell and `rimraf` would be a dependency added purely for convenience. Every target is checked to be inside the repository before it is deleted.

`pnpm clean` does not touch the database. Nothing that deletes data hides behind a name as gentle as "clean" — that is what `db:reset:destroy-all-local-data` is for, and why it is called that.

**A full reset** — dependencies and all:

```
# PowerShell
pnpm clean
Remove-Item -Recurse -Force node_modules, apps/api/node_modules, apps/worker/node_modules
pnpm install --frozen-lockfile
pnpm check
```

```
# POSIX
pnpm clean
rm -rf node_modules apps/*/node_modules
pnpm install --frozen-lockfile
pnpm check
```

---

## What you cannot run

**There is still nothing to start.** There is no `pnpm dev`, no `pnpm start`, and no server.

Starting PostgreSQL starts a _database_, not Jarvis. `apps/api` and `apps/worker` each remain a documentation comment and `export {};` — they start no server, run no loop, consume no event, and print nothing ([ADR-0010](../decisions/ADR-0010-workspace-and-module-structure.md)). Stage 3.1 is **persistence only**: a pool, a transaction helper, a migration runner, and the immutable event log. There is no ingestion, no worker loop, and no HTTP endpoint, and nothing here should be read as implying otherwise.

Adding a placeholder process to make the repository feel more alive remains explicitly out of scope — including "just a small placeholder" ([phased-roadmap.md](../architecture/phased-roadmap.md)).

---

## Environment configuration: one variable, and no `.env`

Two environment variables exist, both set **in your shell**, both local-only:

| Variable                      | Read by                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `QF_JARVIS_POSTGRES_PASSWORD` | Compose, to boot the local database. **No default** — Compose fails to start without it           |
| `DATABASE_URL`                | The migration CLI and the integration tests. **Nothing else** — library code reads no environment |

**There is no `.env` file, no `.env.example`, and no configuration loader — and there must not be one.** A committed `.env.example` becomes a copied `.env`, a copied `.env` becomes a habit, and the habit is how a real credential eventually lands in a working tree. Two shell variables need no file.

Library code in `@qf-jarvis/event-backbone` reads **no** environment at all. The only place that reads `DATABASE_URL` is the migration CLI, because a CLI _is_ a process boundary. A library that reaches into `process.env` behaves according to something the caller cannot see and a test cannot control — and that is precisely how a test suite ends up pointed at a production database because a shell variable was left set.

Configuration arrives under [security-principles.md](../governance/security-principles.md): secrets live in a secret store, never in source, never in committed configuration, never in a log line — and **a developer never needs a production secret to do their job**. The local database password guards a loopback-only container full of synthetic fixtures; it is not a secret, and it is not treated as though it protects something.

**QF Jarvis holds no provider credential, and never will.** Not for WhatsApp, not for telephony, not for any advertising or communication provider. That is not a configuration gap; it is [the boundary](../architecture/system-boundary.md), and it is the reason a compromised Jarvis cannot call anyone.

---

## Troubleshooting

**`pnpm install` fails with an engine error.**
You are on the wrong Node version. This is `engineStrict` working. Run `node --version`; if it is not `v24.18.0`, fix that first.

**`pnpm` is not the pinned version.**
You likely have a global pnpm shadowing Corepack. Run `corepack prepare pnpm@11.11.0 --activate`, and consider removing the global install.

**`pnpm install` reports an ignored build script.**
Do not approve it to move on. See "What a healthy install looks like" above.

**`docker compose up` fails saying `QF_JARVIS_POSTGRES_PASSWORD` is not set.**
That is the control working. The password is required and has no default. Set it in your shell and try again.

**The tests fail with "DATABASE_URL is not set".**
They are supposed to. Database tests fail rather than skip. Start the database and export `DATABASE_URL` — the error message contains the exact commands.

**The tests refuse to run, saying the target is unsafe.**
A guard rejected the connection target: it is not loopback, its database name does not identify it as a test database, or it contains `prod`, `production`, `live`, `supabase`, or `quickfurno`. Point `DATABASE_URL` at `qf_jarvis_test` on `127.0.0.1:55432`. Do not weaken the guard.

**`Refusing to migrate: … TRANSACTION-mode port`.**
`DATABASE_URL` points at a Supabase Supavisor pooler on port `6543`. Use a direct connection or the pooler in **session** mode. This is not a warning that can be dismissed — the migration lock does not work through a transaction pooler, and it would fail without telling you.

**A test fails saying it could not create `anon` / `authenticated` / `service_role`.**
The revocation test creates those roles so it is not asserting against an empty set. The connected role needs `CREATEROLE`. With `compose.yml` it already has it; on a hand-rolled PostgreSQL, run `ALTER ROLE <your_dev_role> CREATEROLE;` once, as a superuser. It fails rather than skips on purpose: a security test that silently does not run is worse than one that was never written, because it looks like coverage.

**A hand-written query says `relation "event" does not exist`.**
Qualify it. Every Jarvis object is in the `qf_jarvis` schema: `SELECT * FROM qf_jarvis.event`. Nothing here relies on `search_path`, deliberately.

**`pnpm db:migrate` fails to find a module.**
The CLI runs from `dist/`. Run `pnpm build` first.

**Port 55432 is already in use.**
Something else is bound to it. Stop that, or stop a previous `qf-jarvis-postgres-dev` container (`pnpm db:down`). The port is deliberately not 5432 so that a PostgreSQL you already run cannot be mistaken for this one.

**`pnpm format:check` fails on a file you did not touch.**
The approved Phase 0 documents are exempt from Prettier and listed in `.prettierignore` ([ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md)). If a _different_ file is failing, run `pnpm format`.

**Line-ending noise in `git diff` on Windows.**
`.gitattributes` normalizes everything to LF. If you cloned before it existed, refresh the working tree:

```
git add --renormalize .
```
