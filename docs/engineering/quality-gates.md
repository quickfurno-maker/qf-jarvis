# Quality Gates

**Status:** Phase 1 — Engineering Foundation
**Date:** 2026-07-11

What must pass before a change merges — and, just as importantly, what these gates **cannot** catch.

The decision behind them is [ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md).

---

## The gate

One command, locally and in CI:

```
pnpm check
```

It runs five checks in order and **fails on the first one that fails**:

| #   | Check      | Command             | Fails when                          |
| --- | ---------- | ------------------- | ----------------------------------- |
| 1   | **Format** | `pnpm format:check` | Any file is not Prettier-formatted  |
| 2   | **Lint**   | `pnpm lint`         | Any ESLint error **or warning**     |
| 3   | **Types**  | `pnpm typecheck`    | Any type error, in any project      |
| 4   | **Tests**  | `pnpm test`         | Any test fails                      |
| 5   | **Build**  | `pnpm build`        | Either application fails to compile |

CI adds a sixth, which is what makes the other five honest:

| 6 | **Clean tree** | `git status --porcelain` | The checks **modified or generated a tracked file** |

The order is deliberate: cheapest and most mechanical first. A formatting failure should not cost you a full type-check and build to discover.

**Failures are never hidden.** No `|| true`, no `continue-on-error`, no swallowed exit code. A step that cannot fail is not a gate.

---

## What each gate is actually for

It is worth being honest about how much each of these protects, because it is tempting to over-invest in the cheap ones.

### 1. Format — catches nothing, and is still worth running

Prettier catches **no bugs whatsoever**. Its entire value is that it ends an argument that would otherwise consume review attention — attention that belongs on the boundary. Formatting is not a matter of taste here; it is a matter of not discussing it.

> **The approved Phase 0 documents are exempt**, and listed in `.prettierignore`. Prettier would rewrite ~500 lines of them purely to turn `*emphasis*` into `_emphasis_` and re-pad every table — changing not one word of content. A pull request that adds a toolchain _and_ churns the entire approved architecture set is one in which the boundary documents cannot be reviewed. Formatting is not worth obscuring the thing this repository exists to protect. The exit path is in `.prettierignore`.

### 2. Lint — catches small things, reliably

ESLint catches an unused variable, an unsafe `any`, a floating promise. It will **never** catch a boundary violation, and it must not be mistaken for something that does.

The rule set is small and maintained (typescript-eslint's `strictTypeChecked` and `stylisticTypeChecked`, plus two documented overrides). Type-aware rules are enabled, which is what makes the `no-unsafe-*` family work — and those are the rules that stop `any` from silently spreading and disabling the type checker we depend on.

**Zero warnings.** CI runs `eslint . --max-warnings=0`. A warning fails the build exactly as an error does.

There is no "warning" severity in practice, and pretending otherwise is how a codebase acquires four hundred of them. A rule is either worth enforcing — an error — or it is not enabled. **A tolerated warning is a rule everyone has agreed to ignore, which is worse than no rule, because it trains people to scroll past output.**

### 3. Types — the gate that will do real architectural work

Today it checks two empty files. That is not a reason to weaken it, because from Phase 2 it starts holding the contracts.

Every strict flag is on, including the inconvenient ones — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`. **They are on now because now is when they are free.** Enabling them in Phase 6, against four agents and an event backbone, produces hundreds of errors, becomes a refactor, and is therefore never scheduled.

Once the Phase 2 contracts exist, the type system can make _"approved without a Core decision"_ **structurally unrepresentable**. That is a stronger guarantee than any review checklist, because a compiler does not get tired at 6pm on a Friday.

Each application type-checks **independently** (TypeScript project references), so a break is attributable to one project — while the root checks all of them in one command.

### 4. Tests — currently empty, and telling the truth about it

**Phase 1 ships zero tests. That is a decision, not an omission.** There is no business logic to test.

**Prohibited — a review blocker, not a style comment:**

- `expect(true).toBe(true)`
- a test that asserts a constant the test itself created
- a test that asserts the name of an agent that does not exist
- any test written to make a suite, a step, or a coverage number look non-empty

**Why this matters more than it sounds.** A test suite is a _claim_: "the behavior below is verified." A suite full of tests that verify nothing makes that claim **falsely** — and a green build then means "the fake tests still pass," not "the system works." The damage is not the wasted lines. It is that the signal becomes indistinguishable from noise, and the first person who sees a green build on a broken system will be right, from then on, to stop trusting the build.

An empty suite tells the truth: _nothing is verified yet, because nothing is claimed yet._

#### What is not optional, from Phase 2 onward

These rules are developed **test-first**, without exception ([engineering-principles.md](../governance/engineering-principles.md) §2):

| Rule                     | Why the test _is_ the rule                                                      |
| ------------------------ | ------------------------------------------------------------------------------- |
| **Idempotency**          | The same event, intent, or submission processed twice has the effect of once    |
| **Expiry**               | An expired recommendation cannot become an intent. An expired intent is refused |
| **Authorization**        | An unapproved recommendation cannot execute. **There is no timeout-to-approve** |
| **Bounds**               | n8n executes exactly what an intent describes, and nothing beyond it            |
| **Signature and replay** | A forged or replayed message is rejected                                        |
| **Money**                | Anything touching a wallet, package, payment, or ad spend                       |

Write the test that proves the rule holds, **watch it fail**, then make it pass. For these rules the test is not a check _on_ the implementation — it is the only evidence the rule exists at all.

Phase 3 cannot exit without _deliberately redelivering events_ to prove idempotency. **The test is the deliverable**, not a side effect of it.

### 5. Build — compiles, and starts nothing

`pnpm build` compiles both applications. It starts no server and runs no loop, because there is nothing to start ([ADR-0010](../decisions/ADR-0010-workspace-and-module-structure.md)).

Output goes only to git-ignored `dist/` directories. Source directories stay clean, and generated files are never tracked — which gate 6 enforces rather than trusts.

### 6. Clean tree — what makes the rest honest

CI fails if the checks **modified the repository**.

Without this, a formatter that rewrites a file, a build that emits into a tracked directory, or an install that quietly rewrites the lockfile would all pass unnoticed. With it, any check that changes the working tree fails the build. It is a cheap step that closes an entire category of "it passed, but only because nobody looked."

---

## Local versus CI

**They are the same.** `pnpm check` locally and `pnpm check` in CI run the identical sequence, on the identical pinned Node (24.18.0) and pnpm (11.11.0).

|                  | Local          | CI                                        |
| ---------------- | -------------- | ----------------------------------------- |
| Install          | `pnpm install` | `pnpm install --frozen-lockfile`          |
| Gate             | `pnpm check`   | `pnpm check`                              |
| Clean-tree check | —              | ✅                                        |
| Blocks merge     | —              | ✅ (once branch protection is configured) |

CI is stricter in exactly two ways, and both are deliberate: the lockfile is **frozen**, and the tree must end **clean**.

**A green local run and a green CI run mean the same thing.** That is what makes developers run the gate before pushing instead of pushing and hoping — and "works on my machine" is designed out rather than argued about.

Run it before you push:

```
pnpm check
```

---

## Review blockers

**These gates do not decide whether a change is acceptable. A human does.**

CI cannot see a boundary violation. It cannot tell whether a recommendation could cause an effect without an authorization decision. It will happily give a green tick to a pull request that hands Jarvis a WhatsApp credential.

The question every pull request is judged against ([engineering-principles.md](../governance/engineering-principles.md)):

> **Could this change let a recommendation cause an effect without an authorization decision recorded in QuickFurno Core?**
>
> If yes, it does not merge, regardless of what it fixes.

Blocking, beyond correctness ([change-management.md](../governance/change-management.md)):

- A path from QF Jarvis to n8n, to a provider, or to business state.
- A recommendation that can execute without an approval decision.
- A **timeout-to-approve**, in any form, under any name.
- An approval path shortened by model confidence.
- **Optimistic or local approval state** — rendering or recording an action as approved before Core's authoritative response arrives.
- **Any WhatsApp, telephony, or provider credential inside QF Jarvis**, or any direct call to a provider from Jarvis.
- **Claiming delivery, call completion, or success before authoritative execution results return** — including a UI that collapses `execution submitted`, `provider accepted`, and `delivered` into one "sent."
- **A retry that dials again.** One intent produces at most one call initiation; a later attempt is a **new intent**.
- A consent, opt-out, or do-not-contact check treated as **authoritative** inside Jarvis. It is a courtesy check; Core enforces.
- A composite recommendation with no attributable contributing agents.
- A hard-coded retention period.
- Chain-of-thought written to a log or a store.
- Personal data in a log line.
- A cross-module import that bypasses an interface ([ADR-0004](../decisions/ADR-0004-modular-monolith-first.md)).

Added by Phase 1:

- **A placeholder test**, or any test that verifies nothing.
- **A critical deterministic rule implemented without a failing test written first.**
- **A suppression with no justification** — `// @ts-expect-error`, `// eslint-disable`, or `any` — with no comment explaining why it is correct.
- **A strictness flag turned off**, or a lint rule disabled, to make a deadline.
- **A dependency added for convenience**, a build script approved to silence a message, or a peer conflict forced through.
- **A secret, credential, or `.env` file.**

---

## A red build is fixed, not merged

A red build is not merged with a follow-up ticket. It is fixed ([change-management.md](../governance/change-management.md) §3).

The moment a red build becomes something to merge around, the gate stops being a gate — and everything above becomes decoration.
