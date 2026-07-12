# Supported Toolchain

**Status:** Phase 1 — Engineering Foundation
**Date:** 2026-07-11

The exact versions this repository runs on, why each is pinned, and the rules for changing them.

The decisions behind them: [ADR-0009](../decisions/ADR-0009-runtime-language-and-package-manager.md) (runtime, language, package manager), [ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md) (quality toolchain and CI), and [ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) (the database and its driver).

---

## Runtime and package manager

|             | Version                       | Pinned in                                                                                   |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| **Node.js** | **24.18.0** — LTS ("Krypton") | `.nvmrc`, `.node-version`, `engines.node` (`>=24.18.0 <25.0.0`), `.github/workflows/ci.yml` |
| **pnpm**    | **11.11.0**                   | `packageManager: pnpm@11.11.0`                                                              |

**Node is pinned in four places, and they are one decision.** `engineStrict: true` (in `pnpm-workspace.yaml`) means an install on any other major **fails**, rather than warning and continuing. `nodeVersion: 24.18.0` additionally makes pnpm evaluate every dependency's engine range against the **target** runtime rather than against whichever Node 24 patch happens to be running the command. CI runs the same pinned version, so a drift between the four cannot pass quietly.

**pnpm is pinned by `packageManager` and activated through Corepack.** CI reads that same field, so the pnpm in CI and the pnpm on a developer's machine cannot diverge. Do not install pnpm globally — a global install is a version nobody pinned.

## Language

|                | Version   |
| -------------- | --------- |
| **TypeScript** | **6.0.3** |

Strict mode in full, native ESM, `module: nodenext` ([tsconfig.base.json](../../tsconfig.base.json)).

> ### Why not TypeScript 7?
>
> **TypeScript 7.0.2 is the current `latest` release. We are on 6.0.3 deliberately.**
>
> `typescript-eslint@8.63.0` — the newest stable release, and the only maintained way to lint TypeScript — declares `peerDependencies: { "typescript": ">=4.8.4 <6.1.0" }`. **TypeScript 7 is outside the supported range of the entire TypeScript-ESLint stack.**
>
> Adopting it would mean installing a combination its maintainers do not support, which is only possible by suppressing the peer check with `--force` or `--legacy-peer-deps`. That is prohibited. The alternative — TypeScript 7 with no type-aware linting — trades a maintained correctness gate for a version number, and the `no-unsafe-*` rules are exactly what stops `any` from silently disabling the type checker.
>
> TypeScript 6.0.3 is a **stable release**, and the newest version the whole toolchain supports at once.
>
> **Exit condition: upgrade to TypeScript 7 when typescript-eslint's peer range admits it.** Reviewed at every phase gate. [ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md) owns this.

## Database

| Environment    | Version                                   | Pinned where                                                                        |
| -------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| **Local + CI** | **17.10** (`-alpine`)                     | `compose.yml` **and** `.github/workflows/ci.yml` — the same exact image tag in both |
| **Deployed**   | PostgreSQL **17**, provider-managed patch | Not pinned here, and it must not be                                                 |

**Major version 17 is the contract. The patch level is not.**

Local and CI pin the exact image, and that buys **one specific thing**: a laptop and a CI runner agree with _each other_. `postgres:17` is a moving tag that resolves to whatever the latest 17.x happens to be on the day it is pulled, so without the pin the two could silently diverge.

**It must not be over-read as a claim about the deployed database.** The managed QF-Jarvis project runs a provider-chosen build — 17.6.x at the time of writing, against 17.10 locally — and **that divergence is expected and permitted**. Local/CI patch equality does not imply Supabase patch equality, and asserting otherwise would be asserting something this repository cannot enforce.

What _is_ required: **migrations and queries must remain compatible across supported PostgreSQL 17 minor releases**, and nothing here may depend on behaviour introduced in a specific 17.x patch. **A provider patch upgrade must not require a change to this repository** — and if one ever does, that is a finding worth an ADR rather than a quiet edit ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §7).

PostgreSQL is required from Stage 3.1 — the full quality gate does not pass without one, and the integration tests **fail rather than skip** when `DATABASE_URL` is absent ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §6, [development-setup.md](./development-setup.md)).

**Docker Compose runs the local database, and that is all it does.** `compose.yml` is **local-development infrastructure, not a deployment artifact**: no application container, no reverse proxy, no TLS, no backup, no resource limit, no secret management. Phase 0 excluded Docker as a deployment artifact and that exclusion stands; a local database for a developer is a different thing, and [ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §6 is where the distinction is recorded rather than assumed. Nothing in this repository deploys from it.

### The deployment provider — and why it changes nothing in this file

Deployed PostgreSQL is a **dedicated, Supabase-managed QF-Jarvis project** ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md)) — **not QuickFurno Core's Supabase project**, which remains forbidden.

**Supabase is a Postgres host and nothing else.** The driver is still `pg`, the configuration is still `DATABASE_URL`, and **the dependency list below does not change by a single line**. That is the test of whether this is a provider decision or an architecture decision, and it passes: nothing above the driver knows who the host is.

**`@supabase/supabase-js` must not be added.** It is a client for Auth, Storage, Realtime, and PostgREST — every one of which is a capability the architecture withholds from Jarvis, which authorizes nothing, executes nothing, and delivers nothing. The database is already reachable with a driver that is pinned, audited, and script-free; a second way to reach it would add a dependency in order to gain nothing.

**No Supabase project ref, hostname, connection URL, database password, service-role key, `anon` key, or API key appears in this repository**, and none may. The deployment target is identified **outside** the repository, through controlled deployment configuration ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §9). Any Supabase-shaped hostname in the tree is a **synthetic placeholder in a unit test** and is deliberately not a valid ref.

**The persistence package supports direct and session-mode connections only** — a Supavisor **transaction-mode** pooler is refused at config construction, because advisory locks and session-level settings do not survive it ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §6).

## Quality toolchain

Every version is exact. There is not a caret in the manifest.

| Package                  | Version    | Role                                                                                                                       |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `typescript`             | **6.0.3**  | Type checking and build                                                                                                    |
| `eslint`                 | **10.6.0** | Linting (flat config)                                                                                                      |
| `typescript-eslint`      | **8.63.0** | TypeScript-aware linting — supplies `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` at the same version |
| `@eslint/js`             | **10.0.1** | ESLint's own recommended JavaScript rules                                                                                  |
| `eslint-config-prettier` | **10.1.8** | Disables every ESLint rule that would fight Prettier                                                                       |
| `globals`                | **17.7.0** | Node global definitions for flat config                                                                                    |
| `prettier`               | **3.9.5**  | Formatting                                                                                                                 |
| `vitest`                 | **4.1.10** | Test framework — brings its own Vite                                                                                       |
| `@types/node`            | **24.9.2** | Node type definitions                                                                                                      |

**9 development dependencies at the root.** Every one is tooling. There is no framework, AI SDK, HTTP client, or utility library in this repository.

One further development dependency lives in the package that needs it rather than at the root:

| Package     | Version    | Belongs to                           | Role                      |
| ----------- | ---------- | ------------------------------------ | ------------------------- |
| `@types/pg` | **8.20.0** | `@qf-jarvis/event-backbone` **only** | Type definitions for `pg` |

## Runtime dependencies

| Package | Version    | Belongs to                           | Why                                                                                                               |
| ------- | ---------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `zod`   | **4.4.3**  | `@qf-jarvis/contracts` **only**      | Runtime validation at trust boundaries ([ADR-0012](../decisions/ADR-0012-runtime-contract-validation.md))         |
| `pg`    | **8.22.0** | `@qf-jarvis/event-backbone` **only** | The PostgreSQL driver. Raw SQL, no ORM ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md)) |

**The root package still has zero runtime dependencies**, and every application still has zero. A dependency belongs to the package that needs it, not to the workspace that happens to contain it.

Zod earns its place by turning an architecture boundary from prose into a parser: TypeScript types are erased at runtime, so at a boundary where the value is `unknown`, `as CanonicalEvent` checks nothing at all.

**`pg` is the second runtime dependency this repository has ever had, and the only one Phase 3 introduces.** There is no ORM, no query builder, and no migration framework. The queries that matter here — `ON CONFLICT DO NOTHING`, advisory locks, ordered scans by identity column, a transactional checkpoint write — are precisely the ones an ORM abstracts away, and precisely the ones that must stay readable in a diff ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §3).

> ### `pg`'s supply-chain profile
>
> | Check                   | Result                                                                                                                                                               |
> | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Implementation          | **Pure JavaScript.** No native addon, nothing to compile                                                                                                             |
> | Install / build scripts | **None.** `onlyBuiltDependencies` stays **empty** — no approval was granted, and none was needed                                                                     |
> | Peer dependencies       | One — `pg-native` — declared **optional** and deliberately not installed. Clean under `strictPeerDependencies: true`                                                 |
> | Transitive dependencies | Not zero. The lockfile records `pg-connection-string`, `pg-pool`, `pg-protocol`, `pg-types`, `pgpass` and their helpers. **None of them runs a build script either** |
> | Release age             | Satisfies `minimumReleaseAge: 1440`. **No exemption was written** — there are none in this repository                                                                |
> | Engines                 | `>= 16.0.0` — satisfied by Node 24.18.0                                                                                                                              |
>
> **The build-script answer chose the driver; preference did not.** `onlyBuiltDependencies: []` is an accepted supply-chain control, and it eliminates the alternatives before any comparison begins: `better-sqlite3` is a native module that requires a build script, and Prisma fetches engine binaries in a `postinstall`. Neither can be installed here without weakening the control — and a control weakened to admit a convenience is not a control.
>
> `pg` is not zero-dependency the way Zod is, and this document will not pretend otherwise. What it is: pure JavaScript, script-free, and the driver essentially every Node PostgreSQL deployment already runs on.

> ### Why Zod's supply-chain profile made this an easy call
>
> | Check                   | Result                                                                            |
> | ----------------------- | --------------------------------------------------------------------------------- |
> | Transitive dependencies | **Zero.** The install added exactly **+1 package**                                |
> | Install / build scripts | **None.** `onlyBuiltDependencies` stays empty                                     |
> | Peer dependencies       | None. Clean under `strictPeerDependencies: true`                                  |
> | Release age             | Published 2026-05-04 — far outside the 24-hour cooldown, **no exemption written** |
> | TypeScript 6.0.3        | Type-checks under full strict mode                                                |
> | Module system           | Native ESM, `sideEffects: false`                                                  |
>
> A zero-dependency, script-free, ESM-native package is close to the best profile a runtime dependency can have — and it remains the bar every later one is measured against.

> ### Why ESLint 10.6.0 and not 10.7.0?
>
> ESLint 10.7.0 was published **less than 24 hours** before this toolchain was assembled, which places it inside the repository's release-cooldown window (`minimumReleaseAge: 1440`, see below).
>
> pnpm's default behavior in that situation is to install it anyway and silently record an automatic exemption. We rejected that: **a control that grants itself exceptions is not a control.** `minimumReleaseAgeStrict` is enabled and ESLint is pinned to 10.6.0 — published two weeks earlier, comfortably outside the window — so no exemption is needed and the cooldown holds.
>
> We lose one patch release. We keep a supply-chain window closed. That is a good trade, and it costs nothing, because we pin exactly and upgrade deliberately rather than racing to releases.

> ### Why `@types/node` 24.x and not 26.x?
>
> `@types/node` must match the **runtime**, not the registry's `latest`. The `latest` tag is 26.x, which describes Node 26's API surface — including methods that **do not exist in Node 24**. Installing it would let TypeScript happily compile a call that crashes at runtime, which is precisely the class of bug the type checker is here to prevent. Types describe the runtime you actually run.

---

## Verified peer compatibility

Peer ranges were read from the registry **before** versions were selected — not discovered afterwards by an install warning that nobody read.

| Package                         | Declares peer                                       | Our version               | Satisfied |
| ------------------------------- | --------------------------------------------------- | ------------------------- | --------- |
| `typescript-eslint@8.63.0`      | `eslint: ^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0`          | eslint 10.6.0             | ✅        |
| `typescript-eslint@8.63.0`      | `typescript: >=4.8.4 <6.1.0`                        | typescript 6.0.3          | ✅        |
| `@eslint/js@10.0.1`             | `eslint: ^10.0.0`                                   | eslint 10.6.0             | ✅        |
| `eslint-config-prettier@10.1.8` | `eslint: >=7.0.0`                                   | eslint 10.6.0             | ✅        |
| `eslint@10.6.0`                 | `engines.node: ^20.19.0 \|\| ^22.13.0 \|\| >=24`    | node 24.18.0              | ✅        |
| `vitest@4.1.10`                 | `engines.node: ^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0`  | node 24.18.0              | ✅        |
| `vitest@4.1.10`                 | `vite` (required peer)                              | supplied by Vitest itself | ✅        |
| `typescript-eslint@8.63.0`      | `engines.node: ^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` | node 24.18.0              | ✅        |
| `pg@8.22.0`                     | `engines.node: >= 16.0.0`                           | node 24.18.0              | ✅        |
| `pg@8.22.0`                     | `pg-native: >=3.0.1` (**optional** peer)            | not installed, by choice  | ✅        |
| `pg-pool@3.14.0`                | `pg: >=8.0`                                         | pg 8.22.0                 | ✅        |

`pg-native` is `pg`'s optional native binding. It is **not installed**, and it must not be: it is a native addon, and installing it would require a lifecycle build script that `onlyBuiltDependencies: []` forbids. Being an _optional_ peer, its absence is clean under `strictPeerDependencies: true` — the policy and the dependency agree, rather than one of them being tolerated.

The install runs with **`strictPeerDependencies: true`** — verified active via `pnpm config get`, not merely written down — and produces **no peer warnings**. Vitest's optional peers (`jsdom`, `happy-dom`, `@vitest/ui`, coverage providers) are declared optional and are deliberately not installed.

**Two versions are held back on purpose** — TypeScript (6, not 7) and ESLint (10.6.0, not 10.7.0). Both are explained above, both are recorded in [ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md), and the TypeScript one has a named exit condition.

**Nothing was forced.** `--force`, `--legacy-peer-deps`, and any relaxation of peer validation are prohibited. An unsatisfiable peer combination is a signal that a version choice is wrong — not an obstacle to route around.

---

## Supply chain

**Where the policy lives, and why it matters.** pnpm 11 reads project policy from **`pnpm-workspace.yaml`**, using camelCase keys. It reads only **authentication and registry** settings from `.npmrc`.

This is not a stylistic detail. Project policy written to `.npmrc` is **silently ignored** — pnpm does not warn, and `pnpm config get` reports the key as `undefined`. A control configured in the wrong file is not a weaker control; it is an **absent** control that reads as present, which is worse than having none, because it is documented, believed, and relied upon.

Every setting below is therefore verified with `pnpm config get` — the effective value pnpm resolves, not the text of a file. The settings that shape resolution are additionally recorded in `pnpm-lock.yaml`.

| Control                        | Setting (`pnpm-workspace.yaml`)             | Effect                                                                                                                                                  |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exact versions**             | `savePrefix: ''`                            | `"6.0.3"`, never `"^6.0.3"`, when a version is not explicitly supplied. A caret range is a standing instruction to run code nobody reviewed             |
| **Committed lockfile**         | `pnpm-lock.yaml`                            | The single authoritative resolution — and it stays diffable, so a reviewer can see it change                                                            |
| **Frozen install in CI**       | `pnpm install --frozen-lockfile`            | If the manifest and lockfile disagree, CI **fails** rather than resolving something new                                                                 |
| **Strict peers**               | `strictPeerDependencies: true`              | An unmet or conflicting peer **fails the install**                                                                                                      |
| **No auto-installed peers**    | `autoInstallPeers: false`                   | Nothing enters the tree that we did not ask for. Recorded in the lockfile as `settings.autoInstallPeers: false`                                         |
| **Engine enforcement**         | `engineStrict: true`                        | The wrong Node version fails at install, with a clear message                                                                                           |
| **Target runtime**             | `nodeVersion: 24.18.0`                      | Dependency engine compatibility is evaluated against the **project's target runtime**, not against whichever Node 24 patch ran the command              |
| **No install scripts**         | `onlyBuiltDependencies: []`                 | **No package may run a lifecycle build script.** None currently needs to                                                                                |
| **Release cooldown**           | `minimumReleaseAge: 1440`                   | A version must be public for **24 hours** before we resolve it                                                                                          |
| **No self-granted exemption**  | `minimumReleaseAgeStrict: true`             | pnpm may **not** resolve a too-fresh version and record an automatic exemption. A control that grants itself exceptions is not a control                |
| **No missing-metadata bypass** | `minimumReleaseAgeIgnoreMissingTime: false` | A package with **missing publication-time metadata fails resolution** rather than bypassing the cooldown. Absent evidence of age is not evidence of age |

There are **no cooldown exemptions** in this repository. `minimumReleaseAgeExclude` does not appear in `pnpm-workspace.yaml`, and no version is permitted to bypass the window.

### Install-script findings

**Zero packages in this dependency tree require an install or build script.** `onlyBuiltDependencies` is empty and no approval has been granted to anything.

**Adding a database driver did not change that**, and that is not luck. `pg` was chosen _because_ it is pure JavaScript and declares no lifecycle script; the drivers that would have required one were ruled out by the policy before they were compared on merit ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §4). The control decided the dependency, rather than the dependency being an argument for relaxing the control.

If a future install reports an ignored build script, **do not run `pnpm approve-builds` to make the message disappear.** Approving a build script grants that package **arbitrary code execution at install time**, on every developer machine and in CI. It is a supply-chain decision:

1. Establish what the script does and why the package needs it.
2. If it is genuinely required, add **that package alone** to `onlyBuiltDependencies` — never a blanket approval, and never `dangerouslyAllowAllBuilds`.
3. Record it here, with the reason.

**This repository defines no lifecycle scripts of its own** — no `preinstall`, no `install`, no `postinstall`, no `prepare`. Cloning and installing this repository executes none of our code. There are no Git hooks in Phase 1 ([ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md)).

### Blast radius

Almost every dependency here is **development tooling**. The exceptions are the two runtime dependencies — `zod` and `pg` — and neither changes the containment, because QF Jarvis holds **no provider credential and no secret** ([system-boundary.md](../architecture/system-boundary.md)). CI runs with `permissions: contents: read`, and the only database credential in this repository is a CI-only, disposable one written in plain sight precisely because it guards nothing.

A compromised dependency would therefore reach a developer's machine, a CI runner, and — at worst — a local database of synthetic fixtures. It stops there. It cannot reach a client, a vendor, a message, a call, or money. That containment is not a property of this toolchain; it is a property of the boundary, and it is one of the reasons the boundary is not negotiable.

---

## Update policy

**A version is never bumped to make an error go away.** If an upgrade surfaces a type error or a lint failure, the tool is working, and the finding gets fixed.

| What                           | When                                                                                | How                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Node patch/minor** (24.x)    | Promptly for security releases                                                      | Update `.nvmrc`, `.node-version`, `engines.node`, **and CI together** — one decision in four files                         |
| **Node major**                 | When the next even-numbered release **enters LTS**, not when it is released         | Its own pull request, toolchain re-verified against it. Never bundled with a feature                                       |
| **TypeScript**                 | **To 7.x when typescript-eslint's peer range admits it** — the named exit condition | Its own pull request. A major typically surfaces new type errors; they are fixed, not suppressed                           |
| **pnpm**                       | Deliberately                                                                        | `packageManager` and CI updated together                                                                                   |
| **ESLint / typescript-eslint** | Deliberately, and **as a pair** — they are peer-coupled                             | Re-verify the peer matrix above. A green `pnpm check` is necessary, not sufficient                                         |
| **Prettier**                   | Deliberately. A major may reformat files — expect a diff and review it as a change  | Its own pull request                                                                                                       |
| **Vitest**                     | Deliberately                                                                        | Its own pull request                                                                                                       |
| **PostgreSQL** (17.x)          | Promptly for security releases                                                      | Update `compose.yml` **and** `.github/workflows/ci.yml` together — one decision in two files, or the laptop and CI diverge |
| **PostgreSQL major**           | Deliberately, never to chase a release                                              | Its own pull request. The migrations and the immutable-log guarantees are re-verified against it                           |
| **`pg`**                       | Deliberately, and **as a pair with `@types/pg`** — the types describe the driver    | Re-verify the supply-chain profile above: still pure JavaScript, still no build script                                     |

## Compatibility policy

1. **Read the peer ranges before choosing a version.** Not after the install warns.
2. **Never force.** No `--force`, no `--legacy-peer-deps`, no disabling peer validation. An unsatisfiable combination means a version choice is wrong.
3. **Never silently ignore a warning.** A peer warning, an engine warning, or an ignored-build-script message is investigated and resolved, or recorded here with a reason.
4. **When the newest versions are mutually incompatible, take the newest mutually compatible set** — and record the deviation, with an exit condition. That is exactly what happened with TypeScript 6 and ESLint 10.6.0.
5. **Upgrade the coupled tools together.** ESLint and typescript-eslint are one decision, not two.
6. **Every toolchain change updates this document.** A toolchain that is not written down is a toolchain nobody can verify.

---

## Verified

The matrix above was verified on **2026-07-11** against the pinned toolchain: `pnpm install --frozen-lockfile` with strict peers produced no warnings, and `pnpm check` (format → lint → typecheck → test → build) passed.

**Every supply-chain setting was confirmed with `pnpm config get`**, against the value pnpm actually resolves — not against the text of a configuration file. This matters because the original Phase 1 configuration placed five of these settings in `.npmrc`, where **pnpm 11 silently ignored all of them**: they resolved to `undefined`, and the lockfile recorded `settings.autoInstallPeers: true` — the opposite of the documented policy. The install happened to be clean anyway, because the chosen versions are genuinely compatible; **the controls were not what made it clean.** The lockfile now records `settings.autoInstallPeers: false`, and each key above resolves to its intended value.

The lesson is recorded here rather than quietly fixed: **a supply-chain control is only real if the tool confirms it is in force.** Documentation asserting an inactive control is worse than no documentation, because it is believed.
