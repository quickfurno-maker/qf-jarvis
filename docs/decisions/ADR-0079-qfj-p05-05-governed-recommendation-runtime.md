# ADR-0079 — QFJ-P05.05 Governed Recommendation Runtime

**Status:** Accepted — QFJ-P05.05 (the recommendation producer; no approval request, no wiring, no deployment)
**Deciders:** Owner
**Relates to:** [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0014](./ADR-0014-governed-lifecycle-contracts.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0078](./ADR-0078-qfj-p08-b-durable-runtime-composition.md)

## Context

Baseline: `main` at `45808fafa9f41c12bbec49064d6dc3e5403a96ac`, the merge of PR #81 (QFJ-P08-B3). Collision
checks on that baseline: no `packages/recommendation-runtime`, no reference to
`@qf-jarvis/recommendation-runtime` anywhere in `packages` or `apps`, `ADR-0079` unclaimed, zero open
PRs; migrations `0001`–`0008` with no `0009`.

`RecommendationV1`, `ProposedAction`, `ApprovalRequestV1` and `ActionFingerprint` have existed in
`@qf-jarvis/contracts` since Phase 2. What has never existed is a **producer**. Nothing in the
repository built a validated recommendation, and nothing computed the SHA-256 `actionFingerprint`
that `ApprovalRequestV1` requires — the contracts package declares the fingerprint's shape and
deliberately does not compute it, because a contracts package that hashed things would be a
contracts package with behaviour.

That gap is what QFJ-P08-B3's closing audit identified as the approval runtime's blocking
prerequisite: an approval request cannot be constructed without a `recommendationId`, a
`proposedActionId` and an `actionFingerprint`, and no code produced any of the three. This ADR
records the runtime that does, and **only** that.

## Decision

### 1. A standalone leaf package

`@qf-jarvis/recommendation-runtime`. Production dependencies exactly `@qf-jarvis/contracts`, `zod`,
and the `node:crypto` built-in — `randomUUID` and `createHash`, nothing else. No dependency on the
agent runtime, the composition root, the event backbone, the Core adapter, conversation control, any
database, any model package or any application.

Importing it connects nowhere, reads no environment, opens no file, arms no timer, logs nothing, and
generates no identifier. A recommendation is inert; a package that produces one has no reason to be
anything else.

### 2. Four root runtime symbols

`RECOMMENDATION_RUNTIME_ERROR_CODES`, `RecommendationRuntimeError`, `createRecommendationRuntime`,
`fingerprintProposedAction`. Seven public types. No default export.

`fingerprintProposedAction` is exposed separately from the runtime on purpose: the next phase must be
able to **verify** a fingerprint — recompute it from an action and compare — without rebuilding a
recommendation to do it.

### 3. The caller states semantics; the runtime supplies identity and provenance

`recommendationId`, `contractVersion`, `producingSystem` and every `actionId` are the runtime's, and
the input schemas are `strictObject`, so offering one is `invalid-input` rather than a value quietly
dropped. `producingSystem` is the literal `qf-jarvis`: it is the structural boundary that says only
QF Jarvis produces recommendations, and a caller-supplied boundary is not one. An identifier a caller
chose is an identifier a caller can reuse, which would let two different recommendations share one
approval decision.

**There is no inference.** It would be easy to derive `risk` from `actionType`, or `requiredApproval`
from `risk`, and it would be wrong: risk determines the approval path (execution-governance.md §9),
so a runtime that guessed it would be setting how much human oversight an action receives, from a
heuristic, in a package with no authority to decide anything. The caller states both;
`recommendationV1Schema` enforces the governed relationship (informational ⇒ no actions and no
approval; non-informational ⇒ at least one action and a real approval level; money-related ⇒
`stronger-approval` or `founder`) and a wrong pairing is **refused, never repaired**. Confidence
remains wired to nothing.

### 4. No idempotency claim

Two `create()` calls with identical input produce two recommendations with two identities, because
they are two proposals. Deduplication requires knowing the business meaning of "the same
recommendation", which this package does not have and must not guess. The default identity port
calls `crypto.randomUUID()` at CALL time — never at import, never at construction, because a module
that generated an identifier while loading would hand every importing process the same one for its
lifetime.

An injected identity port is still untrusted input: whatever it returns is validated against
`recommendationIdSchema` / `actionIdSchema`, and a port that throws is normalized to
`identity-failure` with its own error discarded.

**Locked choice:** duplicate generated action ids surface as `recommendation-invalid`, not
`identity-failure`. Each identifier was individually a well-formed UUID, so nothing failed to
_generate_; what failed is the assembled artifact's uniqueness invariant, which
`recommendationV1Schema` owns. Reporting it as an identity failure would point a reader at the
generator instead of at the rule that broke.

### 5. The result, and the bridge to approvals

```
{ recommendation: RecommendationV1, actionBindings: readonly RecommendationActionBinding[] }
```

One binding per proposed action, in the same order, each carrying exactly the triple
`ApprovalRequestV1` needs: `recommendationId`, `proposedActionId`, `actionFingerprint`. An
informational recommendation has zero actions and therefore zero bindings.

The fingerprint lives beside the artifact rather than inside it. A digest stored within the object it
digests is a value that can disagree with its own subject.

The whole result is **deeply cloned and frozen**. The clone is not decoration:
`actionParametersSchema` is built on `z.custom`, which passes the caller's own object through by
reference — so without a copy, mutating that object after `create()` returned would retroactively
change what was recommended, and would change it out from under a fingerprint computed before the
edit.

### 6. The fingerprint

Covered content, and nothing else:

```
{ actionType, actionContractVersion, summary, parameters }
```

**`actionId` is excluded.** This is the load-bearing decision. `ApprovalRequestV1` already carries
`proposedActionId` as a separate field, so identity is bound there; including it in the digest too
would make the fingerprint useless for the one question it exists to answer — "is the thing being
approved still the thing that was proposed?" — because every regenerated recommendation would produce
a different digest for an identical action. The two consequences are exact and both tested: same
content with a different `actionId` gives the SAME fingerprint; the same `actionId` with changed
content gives a DIFFERENT one. The second is what a human approving an action actually relies on.

Nothing contextual is included — no `recommendationId`, subject, timestamp, correlation id or
approval state. Those describe the situation, not the action.

**Canonicalization.** Object keys sorted lexicographically by UTF-16 code unit; arrays preserve order;
strings emitted exactly; standard JSON for booleans, `null` and finite numbers. `undefined`,
non-finite numbers, functions, symbols, bigints, prototype-bearing objects and cycles are **refused,
not coerced** — every one of them is something `JSON.stringify` would silently turn into a different
value on the way into a digest.

**Domain separator:** `qf-jarvis.proposed-action-content.v1\n`, prefixed to the canonical JSON.
**Preimage:** UTF-8 of separator + canonical JSON. **Digest:** SHA-256, lowercase hex, validated
against `actionFingerprintSchema`.

### 7. The golden vector

Locked in `src/tests/fingerprint.test.ts`, computed rather than authored:

```
canonical JSON:
{"actionContractVersion":1,"actionType":"schedule.follow-up","parameters":{"alpha":{"count":3,
"nested":["b","a",{"x":1,"y":2}]},"beta":null,"channel":"whatsapp","delayHours":48,
"unicode":"café — naïve","zeta":true},"summary":"Schedule a follow-up with the vendor about the delayed sample."}

digest: 0d07abff3f73037b3e4424574e93ae3db0c47c5aeea0140f93a5f408c37950e5
```

(The canonical JSON is one line; it is wrapped here for reading.) The fixture deliberately carries
mixed key insertion order, a nested object inside a nested array, and non-ASCII text.

Changing the canonicalization, the covered field set or the domain separator produces different
digests for unchanged actions, which would silently invalidate every fingerprint already stored in an
approval record. That is a **governed contract change** requiring a new `.v` suffix, not an edit.

### 8. The fingerprint is not authority

A SHA-256 over public content is a content binding. It is unkeyed, so anyone can compute it, and it
proves neither origin nor authorization. Authority comes from QuickFurno Core, recorded in an
approval decision (ADR-0002). Treating this value as a signature, a MAC or a proof of origin would be
a category error.

### 9. What this phase does not build

No `ApprovalRequestV1`, no approval runtime, queue, state or decision handling — that is the next P08
phase, and `actionBindings` is the exact hand-off. No execution intent. No persistence, cache or
store, and no migration: the set stays `0001`–`0008` with no `0009`. No model, prompt, RAG or
gateway. No transport, n8n or WhatsApp.

**No event is emitted.** Jarvis does not emit `qf.recommendation.created`; Core owns canonical event
emission after it records the submission, so there is no `event-backbone` dependency here.

**No Jarvis-runtime or application wiring.** `JarvisRuntime` remains exactly three methods and
`apps/api` takes no dependency on this package. An `OrchestrationProposal → RecommendationV1` mapping
is deliberately not invented: risk, approval level, subject, evidence, expiry and priority cannot be
safely inferred from a reply proposal, and inventing them is precisely what §3 refuses.

## Rejected alternatives

- **Computing the fingerprint in `@qf-jarvis/contracts`.** A contracts package with behaviour, and a
  hashing dependency in the one package everything imports.
- **Including `actionId` in the digest.** Makes identical actions incomparable, which removes the
  only property the fingerprint has.
- **Inferring `risk` or `requiredApproval`.** Sets human-oversight levels from a heuristic.
- **Storing the fingerprint on `RecommendationV1`.** A digest inside its own subject can disagree
  with it, and the contract has no field for it precisely for that reason.
- **Returning the caller's `parameters` object by reference.** Cheaper, and it lets a later mutation
  rewrite an artifact a fingerprint already attests to.
- **An idempotency key or a dedup cache.** Requires business meaning this package does not have.
- **Emitting `qf.recommendation.created`.** Core is the event authority; Jarvis emitting it would
  make a proposal look recorded before Core recorded anything.
- **Wiring it into `createJarvisRuntime`.** Would put proposal creation on the inbound path, which
  QFJ-P05.05 does not authorise, and would require the inference §3 refuses.

## Consequences

The approval runtime's blocking prerequisite is gone: a caller can now obtain a validated
`RecommendationV1` and, for each proposed action, the exact triple an `ApprovalRequestV1` needs.

The new package root is locked at **4** runtime symbols and 7 types. `@qf-jarvis/contracts` is
untouched and remains **369**. Every other package-root runtime API count is unchanged, `apps/api`
stays **0**, and `JarvisRuntime` is still exactly three methods. The only dependency-graph change is
one new leaf importing `contracts`; no new third-party resolution, and no cycle.

Migrations remain `0001`–`0008` with no `0009`. **Managed PostgreSQL was not accessed and still
carries `0001` only.** Production rollout remains OFF.

**NEXT is the QFJ-P08 approval runtime foundation** — `ApprovalRequestV1` construction over these
bindings, and then the approval decision path. Canonical QFJ-P08 remains incomplete: consent and
opt-out state, the approval request/decision runtime and the operator interface are still
unimplemented.

## Non-goals

No approval request, approval decision or execution runtime. No persistence, migration or `0009`. No
event emission by Jarvis. No model, provider, prompt, RAG or gateway call. No Core call, n8n,
WhatsApp or P09 transport. No `JarvisRuntime` or application wiring. No send, deliver, execute or
authorize path. No managed database access or deployment.

## Change-control rule

The canonicalization, the covered field set and the domain separator are a versioned contract. A
change to any of them changes the digest of unchanged actions and invalidates stored fingerprints, so
it requires a new domain-separator version and a governed migration of existing approval records —
never an in-place edit of `v1`.
