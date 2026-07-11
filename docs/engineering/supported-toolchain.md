# Supported Toolchain

**Status:** Phase 1 — Engineering Foundation
**Date:** 2026-07-11

The exact versions this repository runs on, why each is pinned, and the rules for changing them.

The decisions behind them: [ADR-0009](../decisions/ADR-0009-runtime-language-and-package-manager.md) (runtime, language, package manager) and [ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md) (quality toolchain and CI).

---

## Runtime and package manager

|             | Version                       | Pinned in                                                                                   |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| **Node.js** | **24.18.0** — LTS ("Krypton") | `.nvmrc`, `.node-version`, `engines.node` (`>=24.18.0 <25.0.0`), `.github/workflows/ci.yml` |
| **pnpm**    | **11.11.0**                   | `packageManager: pnpm@11.11.0`                                                              |

**Node is pinned in four places, and they are one decision.** `engine-strict=true` means an install on any other major **fails**, rather than warning and continuing. CI runs the same pinned version, so a drift between the four cannot pass quietly.

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

**9 development dependencies. 0 runtime dependencies.** Every one is tooling. There is no framework, database driver, AI SDK, HTTP client, or utility library in this repository.

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

The install runs with **`strict-peer-dependencies=true`** and produces **no peer warnings**. Vitest's optional peers (`jsdom`, `happy-dom`, `@vitest/ui`, coverage providers) are declared optional and are deliberately not installed.

**Two versions are held back on purpose** — TypeScript (6, not 7) and ESLint (10.6.0, not 10.7.0). Both are explained above, both are recorded in [ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md), and the TypeScript one has a named exit condition.

**Nothing was forced.** `--force`, `--legacy-peer-deps`, and any relaxation of peer validation are prohibited. An unsatisfiable peer combination is a signal that a version choice is wrong — not an obstacle to route around.

---

## Supply chain

| Control                     | Setting                                                      | Effect                                                                                                      |
| --------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Exact versions**          | `save-exact=true`                                            | `"6.0.3"`, never `"^6.0.3"`. A caret range is a standing instruction to run code nobody reviewed            |
| **Committed lockfile**      | `pnpm-lock.yaml`                                             | The single authoritative resolution                                                                         |
| **Frozen install in CI**    | `pnpm install --frozen-lockfile`                             | If the manifest and lockfile disagree, CI **fails** rather than resolving something new                     |
| **Strict peers**            | `strict-peer-dependencies=true`                              | An unmet or conflicting peer fails the install                                                              |
| **No auto-installed peers** | `auto-install-peers=false`                                   | Nothing enters the tree that we did not ask for                                                             |
| **Engine enforcement**      | `engine-strict=true`                                         | The wrong Node version fails at install, with a clear message                                               |
| **No install scripts**      | `onlyBuiltDependencies: []`                                  | **No package may run a lifecycle build script.** None currently needs to                                    |
| **Release cooldown**        | `minimumReleaseAge: 1440`<br>`minimumReleaseAgeStrict: true` | A version must be public for **24 hours** before we resolve it — and pnpm may not grant itself an exemption |

### Install-script findings

**Zero packages in this dependency tree require an install or build script.** `onlyBuiltDependencies` is empty and no approval has been granted to anything.

If a future install reports an ignored build script, **do not run `pnpm approve-builds` to make the message disappear.** Approving a build script grants that package **arbitrary code execution at install time**, on every developer machine and in CI. It is a supply-chain decision:

1. Establish what the script does and why the package needs it.
2. If it is genuinely required, add **that package alone** to `onlyBuiltDependencies` — never a blanket approval, and never `dangerouslyAllowAllBuilds`.
3. Record it here, with the reason.

**This repository defines no lifecycle scripts of its own** — no `preinstall`, no `install`, no `postinstall`, no `prepare`. Cloning and installing this repository executes none of our code. There are no Git hooks in Phase 1 ([ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md)).

### Blast radius

Every dependency here is **development tooling**. None ships to production, and QF Jarvis holds **no provider credential and no secret** ([system-boundary.md](../architecture/system-boundary.md)). CI runs with `permissions: contents: read` and uses no secret.

A compromised development dependency would therefore reach a developer's machine and a CI runner — and stop there. It cannot reach a client, a vendor, a message, a call, or money. That containment is not a property of this toolchain; it is a property of the boundary, and it is one of the reasons the boundary is not negotiable.

---

## Update policy

**A version is never bumped to make an error go away.** If an upgrade surfaces a type error or a lint failure, the tool is working, and the finding gets fixed.

| What                           | When                                                                                | How                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Node patch/minor** (24.x)    | Promptly for security releases                                                      | Update `.nvmrc`, `.node-version`, `engines.node`, **and CI together** — one decision in four files |
| **Node major**                 | When the next even-numbered release **enters LTS**, not when it is released         | Its own pull request, toolchain re-verified against it. Never bundled with a feature               |
| **TypeScript**                 | **To 7.x when typescript-eslint's peer range admits it** — the named exit condition | Its own pull request. A major typically surfaces new type errors; they are fixed, not suppressed   |
| **pnpm**                       | Deliberately                                                                        | `packageManager` and CI updated together                                                           |
| **ESLint / typescript-eslint** | Deliberately, and **as a pair** — they are peer-coupled                             | Re-verify the peer matrix above. A green `pnpm check` is necessary, not sufficient                 |
| **Prettier**                   | Deliberately. A major may reformat files — expect a diff and review it as a change  | Its own pull request                                                                               |
| **Vitest**                     | Deliberately                                                                        | Its own pull request                                                                               |

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
