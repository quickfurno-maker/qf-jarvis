# Continuous Integration

**Status:** Phase 1 — Engineering Foundation
**Date:** 2026-07-11

One workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). It runs the quality gate and does nothing else.

The decision behind it is [ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md). Phase 0 required it: _"CI arrives in Phase 1. From that point, it runs on every pull request and blocks merge on failure."_

---

## Triggers

| Event                             | Why                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pull request targeting `main`** | The gate. Nothing reaches `main` except through a reviewed pull request ([change-management.md](../governance/change-management.md) §2, §4) |
| **Push to `main`**                | Confirms `main` is green after a merge. A merge can be green on two branches and broken once combined                                       |

Nothing else triggers it. No schedule, no tag, no manual dispatch, no release event — because there is nothing for those to do.

## Least privilege

```yaml
permissions:
  contents: read
```

The job reads the code and runs checks. It publishes nothing, comments nowhere, opens nothing, and deploys nothing — so `contents: read` is the entire scope it needs, and it is the entire scope it gets.

**No secret is used, and none exists to be used.** There is no registry token, no deploy key, no provider credential. This is not merely a CI hygiene choice: **QF Jarvis holds no provider credentials at all** ([system-boundary.md](../architecture/system-boundary.md)), so there is nothing for a compromised workflow to steal.

Defaults are not relied on. The permission block is explicit, because a default that changes is a permission nobody granted.

## Concurrency

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

A superseded pull-request run is cancelled — it is wasted compute and a misleading status.

**Runs on `main` are deliberately not cancelled.** `main`'s history is the record of what actually passed. Cancelling a run there would leave a commit whose status is _unknown_ rather than _green_, and "unknown" is exactly the state this workflow exists to eliminate.

## The job

| #   | Step                  | Notes                                                                                                     |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | **Checkout**          | `actions/checkout`                                                                                        |
| 2   | **Set up pnpm**       | `pnpm/action-setup`. **Must precede setup-node** — `cache: pnpm` needs pnpm on the PATH to find the store |
| 3   | **Set up Node**       | `actions/setup-node` — Node **24.18.0**, pnpm store cached                                                |
| 4   | **Install**           | `pnpm install --frozen-lockfile`                                                                          |
| 5   | **Quality gate**      | `pnpm check`                                                                                              |
| 6   | **Verify clean tree** | Fails if the checks modified the repository                                                               |

A 15-minute timeout bounds a hung job.

### Versions cannot drift from local

- **Node** is `24.18.0` in the workflow, identical to `.nvmrc`, `.node-version`, and `engines.node`. `engine-strict=true` means a mismatch fails the install rather than warning.
- **pnpm** is **not** given a version input. `pnpm/action-setup` reads it from the `packageManager` field in `package.json` — the same field Corepack reads locally. There is one source of truth, so CI's pnpm and a developer's pnpm cannot diverge.

### Caching

`actions/setup-node` caches pnpm's content-addressed store, keyed on the lockfile. A change to the lockfile invalidates it; nothing else does.

The cache is an **optimization, never a source of truth**. `--frozen-lockfile` resolves from the committed lockfile regardless of what is cached, so a poisoned or stale cache cannot change _what_ gets installed.

### Frozen lockfile

```
pnpm install --frozen-lockfile
```

**The lockfile is authoritative.** If `package.json` and `pnpm-lock.yaml` disagree, the install **fails** rather than quietly resolving something new.

This is the difference between "CI installed the reviewed dependencies" and "CI installed whatever the registry offered this morning." A pull request that changes a dependency must commit the lockfile change with it — and a reviewer sees both.

### The quality sequence

`pnpm check` runs, in order, failing on the first failure:

```
format:check  →  lint  →  typecheck  →  test  →  build
```

**It is the same command a developer runs locally**, on the same pinned Node and pnpm. A green local run and a green CI run therefore mean the same thing — which is the property that makes people actually run the gate before pushing, rather than pushing and waiting.

See [quality-gates.md](./quality-gates.md) for what each step catches, and what it cannot.

### The clean-tree check

```bash
changes="$(git status --porcelain)"
if [ -n "$changes" ]; then
  echo "::error::The working tree is not clean after running the quality gate."
  exit 1
fi
```

**This is what makes the rest honest.** Without it, a formatter that rewrites a file, a build that emits into a tracked directory, or an install that rewrites the lockfile would all pass unnoticed. With it, any check that _modifies_ the repository fails the build.

It also proves that generated output — `dist/`, `*.tsbuildinfo`, `coverage/` — stays untracked, rather than trusting `.gitignore` to be right.

---

## Action pinning

Actions are pinned to **immutable commit SHAs**, with the release tag in a comment beside each:

```yaml
uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
```

**A tag is mutable.** `@v7` can be repointed at new code by whoever controls that repository — and an action runs _inside_ CI, with the checkout. A SHA cannot change under us without a reviewable diff. The tag comment keeps the upgrade human-readable.

**These SHAs were verified, not invented.** Each was resolved from the GitHub API on 2026-07-11 by taking the repository's latest release tag, dereferencing the annotated tag object, and reading the commit it points to. Only maintained official actions are used — `actions/*` and pnpm's own.

**Upgrading an action** means resolving the new tag to its SHA the same way, updating both the SHA and the comment, and reviewing it as a change. Never write a SHA you have not verified.

---

## What CI does not do

- **No deployment job.** Nothing is built for release, published, or deployed. Deployment is not in Phase 1's scope, and there is nothing to deploy — both applications are empty by design.
- **No secrets.** None used, none needed, none present.
- **No release, tagging, or publishing.**
- **No code that runs at install time.** No package in the dependency tree has an install or build script, and this repository defines none ([supported-toolchain.md](./supported-toolchain.md)).

---

## How failures block merge

The workflow **reports** on every pull request today. It **blocks** merge once branch protection is configured on `main` — and those are two different things, so it is worth stating plainly which one is currently true.

**Required repository setting** (a one-time administrative action, outside this repository's files):

> Settings → Branches → branch protection rule for `main`:
>
> - ✅ **Require status checks to pass before merging** → require **`Quality gate`**
> - ✅ **Require branches to be up to date before merging**
> - ✅ **Require a pull request before merging**
> - ✅ **Do not allow bypassing the above settings** — including for administrators

That last one matters. Phase 0 is explicit: _"Every change reaches `main` through a pull request. No exceptions, including for the business owner."_ A protection rule an administrator can click past is a suggestion, not a gate.

**Until branch protection is enabled, CI reports and review is the gate.** The workflow existing is not the same as the workflow being enforced, and pretending otherwise would be exactly the kind of quiet gap this project's governance exists to prevent.

**A red build is fixed, not merged.** It is not merged with a follow-up ticket ([change-management.md](../governance/change-management.md) §3).

---

## What CI can never do

CI runs a formatter, a linter, a type checker, a test suite, and a build. **None of them can see a boundary violation.**

CI will give a green tick to a pull request that hands Jarvis a WhatsApp credential, builds a path to n8n, or renders an action as approved before QuickFurno Core said so. Every one of those compiles, lints, formats, and passes an empty test suite.

> **Could this change let a recommendation cause an effect without an authorization decision recorded in QuickFurno Core?**

That question is a **human's**, on every pull request. The pull-request template asks it, and CI cannot.
