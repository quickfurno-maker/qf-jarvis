# ADR-0011 — Quality Toolchain and Continuous Integration

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

Phase 0 produced a boundary, a set of governance rules, and a list of things a pull request may not do ([change-management.md](../governance/change-management.md) §2). Every one of those rules is currently enforced by a human reading a diff.

Phase 1's job is to move as many of them as possible onto a machine, and to be honest about which ones cannot move. Phase 0 said this plainly: _"CI arrives in Phase 1. From that point, it runs on every pull request and blocks merge on failure. Before Phase 1, review is the only gate, which is one more reason Phase 1 comes early."_

The tools are chosen against one question: **what will this catch, in a system where the worst failure is a recommendation causing an effect without an authorization decision?**

Some answers are honest and modest:

- A **type checker** can eventually make "approved without a Core decision" _unrepresentable_ — a real boundary defense, once Phase 2's contracts exist.
- A **test suite** is the only thing that can prove idempotency, expiry, and replay protection. Phase 3's exit criteria require _deliberately redelivering events_; that is a test, and it is the deliverable.
- A **linter** catches an unused variable and an unsafe `any`. It will never catch a boundary violation.
- A **formatter** catches nothing at all. Its entire value is that it ends an argument that would otherwise consume review attention — attention that should be spent on the boundary.

That ordering matters, because it is tempting to over-invest in the cheap gates and under-invest in the one that actually protects the system.

## Decision

**TypeScript strict mode, ESLint flat config with type-aware rules, Prettier, Vitest, and a GitHub Actions quality gate that blocks merge — with a zero-warning policy and no placeholder tests.**

| Concern           | Tool                 | Version |
| ----------------- | -------------------- | ------- |
| Types             | TypeScript (strict)  | 6.0.3   |
| Lint              | ESLint (flat config) | 10.6.0  |
| Lint (TypeScript) | typescript-eslint    | 8.63.0  |
| Format            | Prettier             | 3.9.5   |
| Test              | Vitest               | 4.1.10  |
| CI                | GitHub Actions       | —       |

The exact matrix, including every supporting package, is recorded in [supported-toolchain.md](../engineering/supported-toolchain.md).

### 1. TypeScript strict mode — in full, from the first commit

Every strictness flag is on, including the ones that are genuinely inconvenient: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `verbatimModuleSyntax` ([tsconfig.base.json](../../tsconfig.base.json)).

**They are on now because now is when they are free.** Enabling `noUncheckedIndexedAccess` on an empty repository costs nothing. Enabling it in Phase 6, against four agents and an event backbone, produces several hundred errors, becomes a refactor, and is therefore never scheduled. Strictness is not a preference to be adopted when convenient; it is a decision with an expiry date, and the date is today.

This is the gate that will eventually do real architectural work. It is currently checking two empty files, which is not a reason to weaken it.

### 2. ESLint — flat config, type-aware, maintained presets only

Flat config (`eslint.config.mjs`). The deprecated `.eslintrc` format is not used.

The rule set is deliberately **small**: typescript-eslint's maintained `strictTypeChecked` and `stylisticTypeChecked` presets, plus two documented overrides. We do not hand-roll a large rule set — a bespoke list of 200 rules is a maintenance burden that nobody updates, that drifts out of agreement with the compiler, and whose individual entries no one can later justify.

Type-aware linting is enabled (`projectService: true`), which is what allows the rules that actually matter here — the `no-unsafe-*` family, which restricts `any` from silently spreading through the codebase and quietly disabling the type checker we just decided to rely on.

### 3. Prettier — and it does not touch the approved Phase 0 documents

Prettier owns formatting; ESLint does not (`eslint-config-prettier` turns off every rule that would fight it). One tool per job.

**A deliberate exception, recorded because it is a real deviation.** Prettier is configured for Markdown, but the 31 approved Phase 0 documents are in `.prettierignore`. Running Prettier over them rewrites **~500 lines** — every `*emphasis*` becomes `_emphasis_` and every Markdown table is re-padded. Neither behavior is configurable, and neither changes a single word of content.

Phase 1 does not spend the Phase 0 review on that. A pull request that adds a toolchain _and_ churns the entire approved architecture set is a pull request in which the boundary documents cannot be reviewed, because the real changes are buried in whitespace. **Formatting is not worth obscuring the one thing this repository exists to protect.**

The exit path is stated in `.prettierignore`: normalize those files in a dedicated, formatting-only pull request that changes nothing else, and delete the exemption in the same change. Everything written from Phase 1 onward — `README.md`, `docs/engineering/**`, ADR-0009 and later, and all code and configuration — is Prettier's.

### 4. Vitest — and **no placeholder tests**

Vitest is configured and `pnpm test` passes on an empty suite, by design.

**Phase 1 ships zero tests, and this is a decision, not an omission.** There is no business logic to test. The following are explicitly prohibited:

- `expect(true).toBe(true)`
- a test that asserts a constant the test itself created
- a test that asserts the name of an agent that does not exist
- any test whose purpose is to make a coverage number or a CI step look non-empty

**Why this is not pedantry.** A test suite is a _claim_: "the behavior below is verified." A suite full of tests that verify nothing makes that claim falsely, and a green build then means "the fake tests still pass" rather than "the system works." The damage is not the wasted lines — it is that the signal is now indistinguishable from noise, and the first person to see a green build on a broken system will be right to stop trusting the build. An empty suite tells the truth: _nothing is verified yet, because nothing is claimed yet._

**What is not optional.** From Phase 2 onward, the rules in [engineering-principles.md](../governance/engineering-principles.md) §2 are developed **test-first**, without exception:

> idempotency · expiry · authorization · bounds · signature and replay · money

Write the test that proves the rule holds, watch it fail, then make it pass. For these rules the test is not a check _on_ the implementation — it is the only evidence the rule exists at all. Phase 3's exit criteria require deliberately redelivering events to prove idempotency: **the test is the deliverable.**

### 5. GitHub Actions — a quality gate, and nothing else

One workflow, one job, on pull requests to `main` and pushes to `main` ([ci.yml](../../.github/workflows/ci.yml)):

1. Checkout
2. Set up pnpm (reads the exact version from `packageManager`)
3. Set up Node 24.18.0, with the pnpm store cached
4. `pnpm install --frozen-lockfile`
5. `pnpm check` — format:check → lint → typecheck → test → build
6. **Verify the working tree is still clean**

**`--frozen-lockfile`** makes the lockfile authoritative: if `package.json` and `pnpm-lock.yaml` disagree, CI fails rather than silently resolving something nobody reviewed. CI installs what was reviewed, or it installs nothing.

**The clean-tree check** is what makes the rest honest. Without it, a formatter that rewrites a file, a build that emits into a tracked directory, or an install that quietly rewrites the lockfile would all pass unnoticed. With it, any check that _modifies_ the repository fails the build.

**`pnpm check` is the same command a developer runs locally.** A green local run and a green CI run therefore mean the same thing — which is the property that makes developers actually run it, rather than pushing and waiting.

**Least privilege:** `permissions: contents: read`. The job reads code and runs checks. It publishes nothing, comments nowhere, deploys nothing, and **uses no secret**. There is no deployment job, and Phase 1 does not have deployment in scope.

**Concurrency:** a superseded pull-request run is cancelled. Runs on `main` are _not_ cancelled — `main`'s history is the record of what actually passed, and cancelling there would leave a commit whose status is unknown rather than green.

### 6. Zero warnings

CI runs `eslint . --max-warnings=0`. A warning fails the build exactly as an error does.

There is no "warning" severity in practice, and pretending otherwise is how a codebase acquires four hundred of them. A rule is either worth enforcing — in which case it is an error — or it is not enabled. A tolerated warning is a rule everyone has agreed to ignore, which is worse than no rule, because it teaches people to scroll past output.

### 7. Pinning: dependencies and actions

- **Dependencies** are pinned exactly, with a committed lockfile ([ADR-0009](./ADR-0009-runtime-language-and-package-manager.md)).
- **GitHub Actions are pinned to immutable commit SHAs**, with the release tag in a comment beside each.

A tag is mutable. `@v5` can be repointed at new code by whoever controls that repository — and a compromised action runs _inside_ CI, with the checkout and the token. Pinning the SHA means the action cannot change under us without a reviewable diff. The tag comment keeps the upgrade human-readable.

The three SHAs in use were resolved from the GitHub API at the time of writing and are recorded in [continuous-integration.md](../engineering/continuous-integration.md). **No SHA was invented.**

## Dependency compatibility — verified, not assumed

Peer ranges were read from the registry _before_ versions were selected, rather than discovered by an install that printed a warning nobody read. Two findings changed the outcome:

**1. TypeScript is held at 6.0.3, although 7.0.2 is `latest`.**

`typescript-eslint@8.63.0` — the newest stable release — declares:

```
peerDependencies: { "eslint": "^8.57.0 || ^9.0.0 || ^10.0.0",
                    "typescript": ">=4.8.4 <6.1.0" }
```

TypeScript 7 is **outside the supported range of the entire TypeScript-ESLint stack**. Taking it would mean installing an unsupported combination, possible only by suppressing the peer check with `--force` or `--legacy-peer-deps` — which is prohibited. The alternative, TypeScript 7 with no type-aware linting, trades a maintained correctness gate for a version number.

TypeScript 6.0.3 is stable and is the newest version the whole toolchain supports at once. **Exit condition: move to TypeScript 7 when typescript-eslint's peer range admits it.** This ADR owns that condition; it is reviewed at each phase gate.

Note that ESLint 10 needed no such compromise — typescript-eslint 8.63.0 supports it outright.

**2. ESLint is pinned at 10.6.0, not 10.7.0.**

ESLint 10.7.0 was published less than 24 hours before this work, which places it inside the repository's release-cooldown window (`minimumReleaseAge`, [ADR-0009](./ADR-0009-runtime-language-and-package-manager.md)). pnpm's default behavior is to resolve it anyway and silently record an automatic exemption — which we rejected: **a control that grants itself exceptions is not a control.** `minimumReleaseAgeStrict` is enabled, and ESLint is pinned to 10.6.0 (published two weeks earlier), so no exemption is needed and the cooldown holds. We lose one patch release and gain a supply-chain window that stays closed.

The full verified matrix is in [supported-toolchain.md](../engineering/supported-toolchain.md). The install runs with `strictPeerDependencies: true` and produces **no peer warnings**, and **no package in the dependency tree requires an install or build script** — so `onlyBuiltDependencies` is empty, and no package has been granted install-time code execution.

**3. The package-manager policy lives in `pnpm-workspace.yaml`, and is verified there.**

pnpm 11 reads project policy from `pnpm-workspace.yaml`, using camelCase keys, and reads only authentication and registry settings from `.npmrc`.

This is recorded as a decision because getting it wrong fails **silently**. Phase 1 initially declared `save-exact`, `strict-peer-dependencies`, `auto-install-peers`, `engine-strict`, and `prefer-frozen-lockfile` in `.npmrc`. pnpm ignored all five without a warning: `pnpm config get` reported each as `undefined`, and the generated lockfile recorded `settings.autoInstallPeers: true` — **the opposite of the documented policy**. The install was clean regardless, because the chosen versions are genuinely compatible; the controls were simply not what made it clean.

**A control configured where the tool does not read it is not a weak control — it is an absent one that reads as present**, and documentation asserting it is worse than no documentation, because it is believed and relied upon. The standing rule is therefore: **do not claim a control is active unless `pnpm config get` and the regenerated lockfile prove it.**

## Alternatives considered

**1. Jest instead of Vitest.**
Rejected. Jest is the incumbent and it works, but it needs additional configuration to run native ESM and TypeScript — and ESM is not negotiable here ([ADR-0009](./ADR-0009-runtime-language-and-package-manager.md)). Vitest runs both natively, is faster, and has a Jest-compatible API, so the knowledge is not wasted if we ever move.

**2. Node's built-in test runner.**
Rejected, though it was tempting — zero dependencies is a real supply-chain argument, and we take those seriously. It loses on the tooling around the test rather than the test itself: mocking, watch mode, and coverage are all noticeably weaker, and Phase 14's evaluation loop will need to run agent versions against recorded history, which is exactly the kind of harness where a mature runner earns its dependency. Worth revisiting if the runner matures.

**3. Biome, replacing both ESLint and Prettier.**
Rejected for now, and this was a close call. It is dramatically faster and would remove several dependencies. It loses on the one capability we are actually buying: **type-aware linting**. The `no-unsafe-*` rules require full type information, and they are the rules that stop `any` from silently disabling the type checker across the codebase. Speed is not a problem this repository has. Revisit if Biome gains type-aware rules.

**4. A large hand-rolled ESLint rule set.**
Rejected. A bespoke list of hundreds of rules is a maintenance burden nobody updates, and it drifts out of agreement with the compiler. Maintained presets plus a small, documented override set is a smaller thing that stays correct.

**5. Placeholder tests, so the suite is not empty.**
Rejected, emphatically — see §4. A suite that verifies nothing while claiming to verify something is worse than no suite.

**6. Warnings allowed in CI.**
Rejected — see §6.

**7. Actions pinned to major-version tags (`@v5`).**
Rejected. Tags are mutable, and a compromised action executes inside CI with the checkout. SHAs were verified against the GitHub API and used; none was invented.

**8. Git hooks (Husky, lint-staged) in Phase 1.**
Rejected, for now. A pre-commit hook is a `prepare` script, which is install-time code execution — and this phase's supply-chain posture is that _nothing_ runs at install. Hooks are also client-side and therefore bypassable, so they cannot be the gate; CI is the gate. A hook is a convenience to add later, deliberately, if the friction warrants it.

**9. Coverage thresholds.**
Rejected as premature and, right now, actively harmful. A coverage threshold on a repository with no business logic can only be satisfied by writing tests that exist to satisfy it — which is precisely the prohibited category. Coverage becomes meaningful when there is behavior to cover; the _quality_ of the critical-rule tests, not their percentage, is what Phase 3 and beyond are judged on.

## Consequences

**Positive.**

- **CI blocks merge on failure**, satisfying Phase 1's exit criteria and Phase 0's change-management rule.
- **Local and CI results are identical** — the same `pnpm check`, the same pinned Node and pnpm. "Works on my machine" is designed out rather than argued about.
- **The strict flags are free today** and will be enforcing real contract invariants from Phase 2, without a refactor.
- **A green build means something**, because there are no tests that pass regardless of whether the system works.
- **The supply chain is deliberate**: exact pins, committed lockfile, frozen installs, SHA-pinned actions, a release cooldown, zero install scripts, no secrets in CI.
- **The approved Phase 0 documents are unchanged**, so the Phase 1 pull request is reviewable as an engineering change.

**Negative — accepted.**

- **We are a major version behind on TypeScript**, and one patch behind on ESLint. Both are deliberate, both are recorded, and one has a named exit condition.
- **The `.prettierignore` exemption is a wart.** It is a documented one with a stated exit path, which is the best available outcome — the alternative was worse.
- **Zero-warning CI will occasionally block a merge on something trivial.** That is the policy working. The fix is to fix it, or to turn the rule off deliberately — not to tolerate it.
- **Strict TypeScript will be annoying**, particularly `noUncheckedIndexedAccess`. That annoyance is the feature.
- **CI adds latency to every pull request.** Mitigated by caching and by a repository that is currently small; revisited if it becomes a real cost.

## Risks

| Risk                                                                                                      | Mitigation                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Placeholder tests appear anyway**, to make a suite look non-empty                                       | Prohibited here, in `vitest.config.mjs`, and in [quality-gates.md](../engineering/quality-gates.md). It is a **review blocker**. A green build that means nothing is worse than a red one                                                                                                                               |
| **Test-first for critical rules quietly erodes** into "tests after"                                       | The phases enforce it structurally: Phase 3 cannot exit without deliberately redelivering events to prove idempotency. The test _is_ the exit criterion, not a byproduct of it                                                                                                                                          |
| **Strictness is weakened under delivery pressure** — a `// @ts-expect-error`, an `any`, a disabled rule   | Each requires a diff, and each is visible in review. A suppression with no comment explaining it is a review blocker. The flags are not turned off to make a deadline                                                                                                                                                   |
| **`skipLibCheck` hides a real type error**                                                                | It only skips `.d.ts` files inside `node_modules`, which are not ours to fix. All first-party source is checked in full                                                                                                                                                                                                 |
| **The toolchain rots**, because deliberate upgrades are easy to postpone                                  | Reviewed at each phase gate against [supported-toolchain.md](../engineering/supported-toolchain.md), including whether the TypeScript 7 exit condition has been met                                                                                                                                                     |
| **CI is treated as the only gate**, and review relaxes                                                    | CI cannot see a boundary violation. It cannot tell whether a recommendation could cause an effect without an authorization decision. **That question is a human's, on every pull request** ([change-management.md](../governance/change-management.md)), and the pull-request template asks it explicitly               |
| **A compromised action or dependency runs inside CI**                                                     | Actions pinned to verified SHAs; dependencies pinned exactly with a frozen lockfile; **no package may run an install script**; a 24-hour release cooldown; least-privilege `contents: read`; and **no secret exists in CI to steal**                                                                                    |
| **A supply-chain control is declared where pnpm does not read it**, and is believed active when it is not | This already happened once, in `.npmrc`. A control is no longer claimed active until `pnpm config get` returns its value **and** the regenerated lockfile reflects it. `settings.autoInstallPeers` in `pnpm-lock.yaml` is the visible tell, and the lockfile is deliberately left diffable so a reviewer sees it change |

## Follow-up

- **This ADR owns the TypeScript 6 → 7 exit condition.** When typescript-eslint's peer range admits TypeScript 7, upgrade in a dedicated pull request and amend the record here.
- **Normalize the Phase 0 documents** in a formatting-only pull request, and remove the `.prettierignore` exemption in the same change.
- **Phase 2** writes the first real tests: contract tests against fixtures, developed test-first.
- **Phase 3** proves idempotency by deliberately redelivering events. That test is the phase's deliverable.
- **Configure branch protection on `main`** so that this workflow is a required status check. Until that is done, CI reports but does not block — the workflow exists, the enforcement is a repository setting, and the two are not the same thing.
- **Each phase gate** reviews the toolchain, the zero-warning policy, and whether any placeholder test has crept in.
