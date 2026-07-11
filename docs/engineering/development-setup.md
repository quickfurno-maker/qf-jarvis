# Development Setup

**Status:** Phase 1 — Engineering Foundation
**Date:** 2026-07-11

How to get from a clone to a green `pnpm check`.

Commands are given for **Windows PowerShell** and **POSIX** (Linux, macOS, Git Bash). Where a command is identical on both — which is nearly all of them, because the toolchain is deliberately cross-platform — it is given once.

---

## Prerequisites

| Requirement | Version     | Why exactly this                                                                                                                                                                                                                                       |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node.js** | **24.18.0** | Pinned in `.nvmrc`, `.node-version`, `engines.node`, and CI. `engineStrict: true` in `pnpm-workspace.yaml` means an install on any other major **fails** rather than warns ([ADR-0009](../decisions/ADR-0009-runtime-language-and-package-manager.md)) |
| **pnpm**    | **11.11.0** | Pinned in `packageManager`. Install it via Corepack, below — do not install it globally                                                                                                                                                                |
| **Git**     | any recent  | —                                                                                                                                                                                                                                                      |

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

## Everyday commands

All are run from the repository root and behave identically on Windows and POSIX.

| Command             | What it does                                                                    |
| ------------------- | ------------------------------------------------------------------------------- |
| `pnpm format`       | Rewrite files to Prettier's formatting                                          |
| `pnpm format:check` | Fail if anything is unformatted — no writes                                     |
| `pnpm lint`         | ESLint, **zero warnings tolerated**                                             |
| `pnpm typecheck`    | Type-check every project                                                        |
| `pnpm test`         | Run the test suite (passes on an empty suite — Phase 1 has no tests, by design) |
| `pnpm test:watch`   | Vitest in watch mode                                                            |
| `pnpm build`        | Compile both applications. Starts nothing                                       |
| `pnpm clean`        | Remove generated build and test artifacts                                       |
| **`pnpm check`**    | **The full gate: format:check → lint → typecheck → test → build**               |

### Before you push

```
pnpm check
```

This is the exact command CI runs. If it is green locally and red in CI, that is a bug in the setup, not in your patch — please report it.

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

Removes `apps/*/dist`, `apps/*/tsconfig.tsbuildinfo`, `coverage/`, and `.eslintcache`. It is a small Node script (`scripts/clean.mjs`) rather than `rm -rf`, because `rm -rf` does not exist on Windows PowerShell and `rimraf` would be a dependency added purely for convenience. Every target is checked to be inside the repository before it is deleted.

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

**There is nothing to start.** There is no `pnpm dev`, no `pnpm start`, and no server.

This is not an omission. Phase 1 establishes a _compileable boundary_ — `apps/api` and `apps/worker` each contain a documentation comment and `export {};`. They start no server, run no loop, and print nothing ([ADR-0010](../decisions/ADR-0010-workspace-and-module-structure.md)).

Phase 1's exit criteria are: _a developer can clone, install, run checks, and run an empty test suite._ A running process is not among them, and adding a placeholder one to make the repository feel more alive is explicitly out of scope — including "just a small placeholder" ([phased-roadmap.md](../architecture/phased-roadmap.md)).

---

## No environment configuration

There is **no `.env` file, no `.env.example`, and no configuration loader**, because there is nothing to configure. No database, no provider, no API key, no model endpoint.

When configuration eventually arrives, it arrives under [security-principles.md](../governance/security-principles.md): secrets live in a secret store, never in source, never in committed configuration, never in a log line — and **a developer never needs a production secret to do their job**.

**QF Jarvis holds no provider credential, and never will.** Not for WhatsApp, not for telephony, not for any advertising or communication provider. That is not a configuration gap; it is [the boundary](../architecture/system-boundary.md), and it is the reason a compromised Jarvis cannot call anyone.

---

## Troubleshooting

**`pnpm install` fails with an engine error.**
You are on the wrong Node version. This is `engineStrict` working. Run `node --version`; if it is not `v24.18.0`, fix that first.

**`pnpm` is not the pinned version.**
You likely have a global pnpm shadowing Corepack. Run `corepack prepare pnpm@11.11.0 --activate`, and consider removing the global install.

**`pnpm install` reports an ignored build script.**
Do not approve it to move on. See "What a healthy install looks like" above.

**`pnpm format:check` fails on a file you did not touch.**
The approved Phase 0 documents are exempt from Prettier and listed in `.prettierignore` ([ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md)). If a _different_ file is failing, run `pnpm format`.

**Line-ending noise in `git diff` on Windows.**
`.gitattributes` normalizes everything to LF. If you cloned before it existed, refresh the working tree:

```
git add --renormalize .
```
