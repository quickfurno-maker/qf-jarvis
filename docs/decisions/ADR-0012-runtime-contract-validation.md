# ADR-0012 — Runtime Contract Validation

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

Phase 2 defines the contracts every later phase depends on: canonical events, recommendations, approval decisions, execution intents, execution results, communication lifecycle records.

The tempting position is that TypeScript already solves this. We chose TypeScript precisely so that a mistyped field on an execution intent would be a compile error ([ADR-0009](./ADR-0009-runtime-language-and-package-manager.md)). Why validate at runtime what the compiler already checks?

**Because at a trust boundary, the compiler checks nothing.**

TypeScript types are erased. They exist during compilation and are gone at runtime. Every one of these contracts crosses a boundary between systems:

- A **canonical event** arrives from QuickFurno Core, over a wire, as bytes somebody else produced.
- An **execution intent** is read by n8n, in a different trust zone.
- An **execution result** originates at a provider, is relayed by n8n, and is recorded by Core.

At each of those, the value is `unknown`. Writing `const event = payload as CanonicalEvent` does not check anything — it _asserts_, and the assertion is a promise the compiler believes and the runtime never verifies. A malformed, stale, or hostile payload sails straight through, and the first thing that notices is a `TypeError` three modules later, or worse, nothing notices at all.

This is not theoretical for this system. [trust-boundaries.md](../architecture/trust-boundaries.md) is explicit that events crossing into Jarvis are untrusted, and [security-principles.md](../governance/security-principles.md) §2 requires **deny by default**: _"an unsigned, badly-signed, or unknown-version event is rejected, not processed 'just in case.'"_ A rejection needs something that can reject.

So the question is not _whether_ to validate at runtime. It is _what to validate with_.

## Decision

**Zod 4.4.3, as the single runtime dependency of `@qf-jarvis/contracts`. Strict schemas, with TypeScript types inferred from them.**

### 1. Schemas are the source of truth; types are inferred

```ts
export const executionIntentV1Schema = z.strictObject({ … });
export type ExecutionIntentV1 = z.infer<typeof executionIntentV1Schema>;
```

Written the other way around — a hand-written type plus a hand-written validator — the two drift. Someone adds a field to the type, forgets the validator, and the system now has a compile-time contract and a runtime contract that disagree. **Inference makes divergence impossible**: there is one definition, and the type is a projection of it.

### 2. Strict, everywhere

`z.strictObject`. An unrecognized key is an **error**, not a passthrough.

A permissive schema means a producer can add a field, believe it is consumed, and be wrong — silently, for months. It also means an attacker can attach `{ approved: true }` to a payload and discover whether anything downstream reads it. `.passthrough()` appears nowhere in this package.

### 3. Bounded JSON, hand-written

The one place a contract must carry caller-shaped data — action `parameters`, evidence `value`, result `metadata` — is validated by a deterministic inspector rather than by a recursive Zod union.

**A union cannot do this job**, and it is worth being specific about why, because "just use `z.lazy` with a union" is the obvious answer and it is wrong on four counts:

- It **cannot detect a cycle** — it recurses until the stack dies.
- It **cannot see a class instance** — a `Date` has no own enumerable keys, so it validates happily as `{}`, and the value silently becomes something else on serialization.
- It **cannot bound depth**.
- It **cannot bound total work** — a non-cyclic graph sharing one sub-object many times is small on paper and enormous when walked.

The inspector does all four, reports every issue with a path, and is pure and deterministic.

### 4. Errors name the field and never echo the value

A `ContractIssue` is `{ path, code, message }`. It does not carry the input, and neither does `ContractValidationError`.

**The most likely payload to fail validation in this system is one that should never have existed** — carrying a credential in `parameters`, or a phone number where an opaque reference belongs. An error that helpfully quotes the rejected value has just written that secret into an exception message, which becomes a log line, which becomes a breach. **The validator that refuses a secret must not then record it** ([security-principles.md](../governance/security-principles.md) §5).

No function in this package logs. Enforced by lint, asserted by test.

### 5. Failure is closed

Unknown event type, unknown version, malformed payload, unexpected field: **rejected**. Never coerced, never defaulted, never upgraded, never guessed at.

## Alternatives considered

**1. TypeScript types alone, with `as` at the boundary.**
Rejected, and it is the alternative worth rejecting loudly, because it is what a hurried developer will reach for. `as` is not a check — it is an assertion that the compiler _believes_. It converts "this data might be malformed" into "the compiler now thinks it isn't", which is strictly worse than no type at all: the type system's confidence is now unearned, and every downstream reader trusts it. At a trust boundary, `as` is a lie with a syntax.

**2. Hand-written validators plus hand-written types.**
Rejected. Two definitions of one contract, kept in agreement by discipline. They will diverge, and the divergence will be discovered in production, because the compile-time contract and the runtime contract disagree in exactly the case nobody tested.

**3. JSON Schema (Ajv).**
Rejected, though it was the closest call, and its advantages are real: it is language-agnostic and standardized, which genuinely matters for a contract QuickFurno Core and n8n must also honor — and Core may not be TypeScript.

It loses on developer ergonomics in the place that matters most: types must be _generated_ from schemas in a build step, and cross-field invariants (`emittedAt` may not precede `occurredAt`; an indeterminate result must be classified for reconciliation) become awkward `if/then` constructs that are hard to read and harder to review. Those invariants are where the architecture actually lives; they must be legible.

**Recorded as a follow-up rather than dismissed:** if Core or n8n need a language-neutral schema, JSON Schema can be **generated from** these Zod schemas. That keeps one source of truth and adds an export, which is the right shape for that problem when it arrives.

**4. Valibot, or another lighter validator.**
Rejected. Smaller bundle, similar model. Bundle size is not a problem this repository has — nothing here ships to a browser. Zod's ecosystem, stability, and documentation are worth more than kilobytes we are not paying for.

**5. `io-ts` / `effect/Schema`.**
Rejected. Powerful, principled, and a significant conceptual tax on every future contributor. This package must be readable by someone who has never met a functional-programming library, because the contracts are the part of the system people will read most.

**6. Zod 3.**
Rejected. Zod 4 is current and stable, is faster, and has the top-level format APIs (`z.uuid()`, `z.iso.datetime()`) used throughout. There is no reason to adopt a superseded major.

## Dependency and supply-chain impact

Verified against the registry **before** selection, per the standing rule from [ADR-0011](./ADR-0011-quality-toolchain-and-continuous-integration.md) — _do not claim a control is active unless the tooling proves it_:

| Check                       | Result                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Version**                 | `zod@4.4.3` — the current `latest`                                                                                                 |
| **Published**               | 2026-05-04 — over two months old, far outside the 24-hour release cooldown                                                         |
| **Transitive dependencies** | **Zero.** The install added exactly **+1 package**                                                                                 |
| **Install/build scripts**   | **None.** No `preinstall`, `install`, `postinstall`, or `prepare`. `onlyBuiltDependencies` stays empty                             |
| **Peer dependencies**       | None. Installs cleanly under `strictPeerDependencies: true`                                                                        |
| **Engines**                 | Unconstrained; runs on Node 24                                                                                                     |
| **TypeScript 6.0.3**        | Type-checks under full strict mode, including `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax` |
| **Module system**           | Native ESM, `sideEffects: false`                                                                                                   |
| **Cooldown exemption**      | **None written.** `minimumReleaseAgeExclude` does not appear                                                                       |
| **Lockfile**                | `settings.autoInstallPeers: false` unchanged                                                                                       |

**Zod is a runtime dependency of `@qf-jarvis/contracts` only.** It is not added to the root package, and the root still has **zero** runtime dependencies. A dependency belongs to the package that needs it.

A zero-dependency, script-free, ESM-native package is close to the best supply-chain profile a runtime dependency can have — which is a meaningful part of why it is the _only_ one.

## Consequences

**Positive.**

- **The boundary is checked where it is crossed.** A malformed, stale, or hostile payload is refused at the edge, with a structured reason — not three modules later, as a `TypeError`.
- **One definition per contract.** The type cannot drift from the validator, because it is derived from it.
- **Cross-field invariants are legible.** "An indeterminate result must be classified for reconciliation" reads like the rule it enforces, and a reviewer can check it against the approved document.
- **Illegal states are unrepresentable.** An approval decision attributed to an agent does not parse _and_ does not compile.
- **Errors are safe to log** — because they carry no input. That property is what lets a future ingestion layer log a rejection at all.
- **The supply-chain cost is one zero-dependency package.**

**Negative — accepted.**

- **A runtime dependency now exists** where Phase 1 had none. Justified, minimal, and confined to the one package that needs it.
- **Validation costs CPU.** Irrelevant: this system's bottleneck is model-inference latency, not parsing.
- **Zod's inferred types can be hard to read** in an editor tooltip when a schema is deeply composed. The exported named types mitigate it.
- **The schemas are TypeScript**, so a non-TypeScript consumer (possibly Core) cannot use them directly. See the JSON Schema follow-up.

## Risks

| Risk                                                    | Mitigation                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A developer reaches for `as` at a boundary anyway**   | This package contains **no type assertions at all**, and the strict lint rules make one visible in review. Review blocker                                                                                                                                                           |
| **A schema is relaxed to make a payload pass**          | That is a contract change, and it requires a version ([ADR-0013](./ADR-0013-canonical-event-envelope-and-versioning.md)). "Make the error go away" is not a reason to widen a contract                                                                                              |
| **Zod is abandoned, or a major breaks us**              | Schemas are the source of truth and are ordinary data structures; a port is mechanical, and the fixtures and tests are the real asset — they would validate a replacement on day one                                                                                                |
| **Zod's inferred types quietly widen a field to `any`** | The package lints under `strictTypeChecked` with the `no-unsafe-*` rules, so an `any` is an error. One such degradation was caught during Phase 2 — a `Record` alias that was circular through its own value type and silently resolved to `any` — and it was fixed, not suppressed |
| **A validation error leaks the value it refused**       | Tested explicitly: a payload carrying a fake credential produces an error that names the key and does not contain the value                                                                                                                                                         |

## Follow-up

- **If Core or n8n need a language-neutral contract**, generate JSON Schema _from_ these Zod schemas rather than maintaining a second definition. One source of truth, plus an export.
- **Phase 3** consumes `parseCanonicalEvent` at the ingestion boundary, where a rejected event becomes a visible, replayable dead letter.
- **Phase 11** adds Core's domain event contracts, after Core's real capabilities are verified — and adapters absorb any difference, per [phased-roadmap.md](../architecture/phased-roadmap.md).
- Re-verify Zod's supply-chain profile on every upgrade, against the table above.
