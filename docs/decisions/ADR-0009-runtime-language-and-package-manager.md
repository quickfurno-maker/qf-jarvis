# ADR-0009 — Runtime, Language, and Package Manager

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

Phase 1 must choose a runtime, a language, and a package manager. These are the choices that are cheapest to make now and most expensive to revisit later: every subsequent phase is written in whatever is decided here, and by Phase 5 the decision is load-bearing under four agents, an event backbone, and a contract registry.

The system these choices must serve is known from Phase 0, and it is worth being precise about what it actually is. QF Jarvis is an **I/O-bound coordination and reasoning layer**. It consumes canonical events, maintains derived read models, runs specialist agents whose real cost is model inference latency, produces recommendations, and submits them into QuickFurno Core's authorization path ([system-boundary.md](../architecture/system-boundary.md)). It is not a compute-bound service. Its bottleneck is quality of reasoning and correctness of coordination — not throughput, not raw CPU.

Two properties therefore matter more than performance:

1. **Correctness that a compiler can enforce.** The contracts in Phase 2 — canonical events, recommendations, approval decisions, execution intents, execution results — are the spine of the system. A mistyped field on an execution intent is not a bug, it is a boundary incident. We want as many of those caught at compile time as a type system can be persuaded to catch.
2. **A boring, well-supported ecosystem.** The mitigation Phase 0 names for this phase's principal risk is explicit: choose _boringly_ and record the choice, rather than choosing perfectly ([phased-roadmap.md](../architecture/phased-roadmap.md)).

## Decision

**Node.js 24 LTS, TypeScript, pnpm, and native ECMAScript modules — every version pinned exactly.**

| Choice          | Version                             | Pinned in                                     |
| --------------- | ----------------------------------- | --------------------------------------------- |
| Runtime         | **Node.js 24.18.0** (LTS "Krypton") | `.nvmrc`, `.node-version`, `engines.node`, CI |
| Language        | **TypeScript 6.0.3**                | `package.json` (exact)                        |
| Package manager | **pnpm 11.11.0**                    | `packageManager`, CI                          |
| Module system   | **Native ESM**                      | `"type": "module"`, `module: nodenext`        |

### Node.js 24 LTS

Node is the boring choice, and here that is the argument for it, not against it. It has the deepest ecosystem for the things this system will actually need — HTTP, queues, database drivers, and the AI SDKs that arrive in Phase 5 — and an LTS line with a published, predictable support window.

**24, not 26.** Node 26 is current, but "current" is not "supported for two years." The LTS line is the one with a maintenance guarantee we can plan phases against. We take the boring line deliberately.

### TypeScript

The type system is doing real architectural work here, not decorating it. Phase 2's contracts are types; Phase 3's idempotency keys and expiry timestamps are types; Phase 9's approval states are types. A discriminated union that makes "approved without a Core decision" _unrepresentable_ is worth more than any amount of code review discipline, because it does not get tired.

Strict mode is enabled in full from the first commit, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` ([tsconfig.base.json](../../tsconfig.base.json)). Turning these on now costs nothing, on an empty repository. Turning them on in Phase 6, against a codebase that grew up without them, is a refactor nobody ever schedules.

#### TypeScript 6, deliberately — not TypeScript 7

TypeScript **7.0.2 is the current `latest`** release. We are pinning **6.0.3** anyway, and the reason is a hard compatibility ceiling rather than caution:

> `typescript-eslint@8.63.0` — the newest stable release, and the only maintained way to lint TypeScript — declares its peer dependency as `typescript: >=4.8.4 <6.1.0`.

TypeScript 7 is therefore **outside the supported range of the entire TypeScript-ESLint stack**. Adopting it would mean installing a combination its maintainers do not support, which we could only do by suppressing the peer-dependency check with `--force` or `--legacy-peer-deps`. We do not do that (see [security-principles.md](../governance/security-principles.md); the prohibition is absolute in Phase 1's scope).

The alternative — TypeScript 7 with no type-aware linting — trades a maintained correctness gate for a version number. That is a bad trade.

TypeScript 6.0.3 is a **stable release**, not a preview, and it is the newest version that the whole toolchain supports simultaneously. This is a deliberate, temporary ceiling and it has an exit condition, recorded in [ADR-0011](./ADR-0011-quality-toolchain-and-continuous-integration.md): **when typescript-eslint raises its peer range to admit TypeScript 7, we move.** Not before.

### pnpm

- **Correct by default.** pnpm's isolated `node_modules` means a package can import only what it actually declares. npm's flat, hoisted tree lets a module import a transitive dependency it never declared and get away with it — until the day that dependency moves. In a repository whose central discipline is _module boundaries are real_ ([ADR-0004](./ADR-0004-modular-monolith-first.md)), a package manager that quietly permits undeclared imports is working against the architecture.
- **Workspaces**, which the modular monolith needs ([ADR-0010](./ADR-0010-workspace-and-module-structure.md)).
- **Efficient**, via a content-addressed store — relevant once CI runs on every pull request.
- **Strict by configuration.** `strictPeerDependencies`, `autoInstallPeers: false`, `engineStrict`, `nodeVersion`, exact saves, and a release cooldown are all first-class — and all declared in [pnpm-workspace.yaml](../../pnpm-workspace.yaml), which is where pnpm 11 reads project policy from. `.npmrc` carries only authentication and registry settings, and this repository declares neither.

### Native ESM

ESM is the module system of the language, and CommonJS is a legacy we would be choosing on purpose. Node 24 supports ESM natively and without flags. `verbatimModuleSyntax` and `module: nodenext` make TypeScript resolve imports **exactly as Node will at runtime**, so a missing `.js` extension in a relative import is a compile error rather than a production `ERR_MODULE_NOT_FOUND`.

Starting here also avoids the dual-package hazard entirely, which is a problem best solved by never having it.

## Alternatives considered

**1. Bun, as runtime and package manager.**
Rejected. It is genuinely faster and the developer experience is good. But this system's bottleneck is model-inference latency and coordination correctness, not startup time or CPU — so Bun's advantage lands almost entirely where we do not need it, while its narrower ecosystem and shorter production track record land squarely where we do. We would be paying an ecosystem risk for a performance win we cannot use. Revisit with evidence.

**2. Deno.**
Rejected. Its permissions model is philosophically well-aligned with this project — a runtime that must be told explicitly that it may open a socket is a real defense for a system whose core promise is "Jarvis cannot reach a provider." That is a genuine argument and it is worth recording as one. But the boundary is already enforced structurally, by Jarvis holding no credential and having no integration ([security-principles.md](../governance/security-principles.md) §1), so Deno's permissions would be a second lock on a door that has no handle. It does not buy enough to offset the smaller ecosystem.

**3. Python.**
Rejected. The strongest AI/ML ecosystem, and for a research workload it would win. But QF Jarvis is not a research workload. It is a coordination and integration service that happens to call models — and the parts that must not break are event handling, idempotency, contracts, and approval state. Static typing across those is a first-class citizen in TypeScript and an ongoing negotiation in Python. Agent quality will be decided by evidence and evaluation ([phase 14](../architecture/phased-roadmap.md)), not by the host language's library count.

**4. Go.**
Rejected. Excellent for the concurrency and reliability this system needs, and a serious candidate. It loses on the two axes we weighted highest: the AI SDK ecosystem is thinner, and expressing the contract types — discriminated unions over versioned event and recommendation shapes — is significantly more awkward than in TypeScript. We are optimizing for making illegal states unrepresentable, and TypeScript's structural type system is simply better at that.

**5. npm.**
Rejected. It is the default and it works. But its hoisted `node_modules` permits undeclared transitive imports, and its workspace support is weaker. In a monorepo built specifically to keep module boundaries honest, that is the wrong default.

**6. Yarn.**
Rejected. Berry's Plug'n'Play is a real strictness improvement but still causes tooling friction, and Yarn offers nothing pnpm does not for our case.

**7. CommonJS.**
Rejected. Choosing a legacy module system for a repository whose first line of code is being written today would require an argument, and there is not one.

**8. Node.js 26 (current).**
Rejected for now. It is not LTS. We will move to 26 when it becomes LTS, per the upgrade policy below.

## Version pinning

**Every version is pinned exactly. Nothing floats.**

- **Dependencies:** exact versions in `package.json` — `"typescript": "6.0.3"`, never `"^6.0.3"`. Enforced by `savePrefix: ''`.
- **The lockfile is committed** and is authoritative. CI installs with `--frozen-lockfile`, so if `package.json` and `pnpm-lock.yaml` ever disagree, CI fails rather than silently resolving something new.
- **Node** is pinned in four places that must agree: `.nvmrc`, `.node-version`, `engines.node` (`>=24.18.0 <25.0.0`, enforced by `engineStrict: true`), and the CI workflow. `nodeVersion: 24.18.0` additionally makes pnpm evaluate dependency engine ranges against the **target** runtime rather than against whichever Node 24 patch happens to be running the command.
- **pnpm** is pinned by `packageManager: pnpm@11.11.0`, which Corepack enforces locally and which CI reads directly — so CI cannot drift from local.
- **GitHub Actions** are pinned to immutable commit SHAs ([ADR-0011](./ADR-0011-quality-toolchain-and-continuous-integration.md)).

A caret range is a standing instruction to run code nobody reviewed. The entire point of a lockfile is undermined by a manifest that invites drift the moment someone runs an install on a fresh machine.

**Release cooldown.** A package version must have been public for at least 24 hours before this repository will resolve it (`minimumReleaseAge: 1440`). The realistic npm supply-chain attack is a compromised maintainer account publishing a malicious patch, typically detected and unpublished within hours. Because we pin exactly and upgrade deliberately, we are never racing to a release, so this costs us nothing and removes an entire attack window.

Two settings are what make the cooldown a control rather than a preference. `minimumReleaseAgeStrict: true` stops pnpm from resolving a too-fresh version anyway and recording an automatic exemption for it — **a control that grants itself exceptions is not a control.** `minimumReleaseAgeIgnoreMissingTime: false` makes a package whose publication time is missing from the registry metadata **fail resolution** rather than bypass the window: absent evidence of age is not evidence of age, and "the metadata was missing" is exactly the shape a bypass would take.

**Where this policy lives.** All of it is declared in `pnpm-workspace.yaml`, because **pnpm 11 reads project policy from there** and reads only authentication and registry settings from `.npmrc`. This is worth stating in an ADR rather than a comment, because the failure mode is silent: policy written to `.npmrc` is ignored without a warning, and `pnpm config get` reports it as `undefined`. **A control configured in the wrong file is not a weaker control — it is an absent one that reads as present.** Every setting is therefore verified with `pnpm config get`, not by reading the file back.

## Upgrade policy

| What                        | When                                                                                                                                                | How                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node patch/minor** (24.x) | Promptly for security releases                                                                                                                      | Update `.nvmrc`, `.node-version`, `engines.node`, and CI **together**. They are one decision in four files, and CI verifies they agree.                    |
| **Node major**              | When the next even-numbered release **enters LTS** — not when it is released                                                                        | A pull request of its own, with the toolchain re-verified against it. Never bundled with a feature.                                                        |
| **TypeScript**              | **To 7.x when typescript-eslint's peer range admits it** — this is the named exit condition for the 6.x ceiling above                               | Its own pull request. A TypeScript major typically surfaces new type errors; those are findings, not obstacles, and they are fixed rather than suppressed. |
| **pnpm**                    | Deliberately, with the `packageManager` field and CI updated together                                                                               | Its own pull request.                                                                                                                                      |
| **Dev dependencies**        | Deliberately, in batches, with peer compatibility re-verified against the matrix in [supported-toolchain.md](../engineering/supported-toolchain.md) | A green `pnpm check` is necessary but not sufficient — the peer matrix is re-checked, not assumed.                                                         |

**A version is never bumped to make an error go away.** If an upgrade surfaces a type error or a lint failure, that is the tool doing its job, and the finding is fixed.

## Consequences

**Positive.**

- **One language across the whole system.** Contracts, agents, ingestion, and the eventual control plane share types rather than re-describing them in a second language and hoping the two descriptions stay in agreement.
- **The compiler enforces part of the boundary.** Once the Phase 2 contracts exist, "an execution intent without an approval decision" can be made _structurally unrepresentable_. That is a stronger guarantee than a code review comment, and it does not get tired at 6pm on a Friday.
- **Reproducible installs**, from a committed lockfile and exactly pinned versions, on a developer machine and in CI alike.
- **Undeclared imports are impossible**, so the module boundaries [ADR-0004](./ADR-0004-modular-monolith-first.md) depends on are enforced by the package manager rather than only by review.
- **A supply-chain posture that is deliberate**: exact versions, a committed lockfile, frozen installs, no build scripts, and a release cooldown.

**Negative — accepted.**

- **We are one major version behind on TypeScript**, and we will be until typescript-eslint catches up. This is the explicit price of keeping type-aware linting, and we judge the linting to be worth more than the version number. It is tracked, not forgotten.
- **Node is not the fastest runtime available.** Accepted: our bottleneck is inference latency, so runtime speed is not on the critical path.
- **TypeScript adds a build step**, and the strict flags will occasionally be genuinely annoying — `noUncheckedIndexedAccess` in particular. That annoyance is the feature working.
- **pnpm's strictness will surface real problems as install failures**, which is the correct behavior and will still feel like friction on the day it happens.
- **Corepack is required** for the pinned pnpm to be enforced locally. Documented in [development-setup.md](../engineering/development-setup.md).

## Risks

| Risk                                                                                         | Mitigation                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TypeScript 7 support in typescript-eslint takes a long time**, leaving us further behind   | The ceiling is recorded with a named exit condition and reviewed at each phase gate. TypeScript 6.0.3 is a stable, supported release — this is a deferral, not a dead end                                                                                                                                                                                                                              |
| **Node 24 reaches end of life** before the system matures                                    | LTS gives a predictable window, and the upgrade policy moves us on the _next LTS_, not on the next release. Reviewed at each phase gate                                                                                                                                                                                                                                                                |
| **The pinned toolchain rots** because upgrades are deliberate and therefore easy to postpone | Each phase gate reviews the toolchain against [supported-toolchain.md](../engineering/supported-toolchain.md). A deliberate upgrade is not an optional one                                                                                                                                                                                                                                             |
| **A dependency is compromised at the registry**                                              | Exact pins, a committed lockfile, `--frozen-lockfile` in CI, **zero packages permitted to run install scripts**, and a 24-hour release cooldown. Jarvis also holds no provider credential, so the blast radius of a compromised dev dependency stops at the developer's machine and CI — it cannot reach a client, a vendor, or money ([security-principles.md](../governance/security-principles.md)) |
| **`engineStrict` blocks a developer** on the wrong Node version                              | That is the intent: fail at install with a clear message rather than at runtime with a strange one. Corepack and `.nvmrc` make the fix a single command                                                                                                                                                                                                                                                |
| **The four Node pins drift apart** (`.nvmrc`, `.node-version`, `engines.node`, CI)           | CI runs the pinned version and `engineStrict` enforces the constraint, so a drift fails the build rather than passing quietly                                                                                                                                                                                                                                                                          |

## Follow-up

- [ADR-0010](./ADR-0010-workspace-and-module-structure.md) records the workspace and module structure built on these choices.
- [ADR-0011](./ADR-0011-quality-toolchain-and-continuous-integration.md) records the quality toolchain, and owns the TypeScript 6 → 7 exit condition.
- [supported-toolchain.md](../engineering/supported-toolchain.md) records the exact versions and the verified peer-compatibility matrix, and is updated on every toolchain change.
- Phase 2 introduces the first shared package. It is the first real test of whether the workspace and the type system carry the contracts as intended.
- Each phase gate reviews: is the toolchain still supported, and has the TypeScript 7 exit condition been met?
