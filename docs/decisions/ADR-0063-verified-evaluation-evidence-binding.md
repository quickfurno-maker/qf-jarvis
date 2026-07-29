# ADR-0063 — Verified Evaluation-Evidence Binding for Rollout Approval

**Status:** Accepted (2026-07-29, QFJ-S2-C-B)
**Supersedes:** nothing
**Depends on:** ADR-0049 (rollout governance), ADR-0050 (capability registry), ADR-0052 (evaluation and
red-team foundation), ADR-0062 (production composition)

---

## Context

The QFJ-S2-C-A audit found that evaluation evidence and rollout approval are two complete systems that
**never meet**.

`@qf-jarvis/model-evaluation` produces immutable `ApprovalEvidence` bound to an exact release, capability
profile, prompt identity, suite and evaluator, gated behind seven fail-closed checks. It ends at
`toRolloutApprovalReference`, which **nothing outside its own spec consumes**.

`@qf-jarvis/model-gateway` gates rollout on a `RolloutApprovalAttestation` whose `evaluationRef` is
validated only as `/^[A-Za-z0-9._:/-]+$/`. `model-gateway` contains **zero** references to
`model-evaluation` or `ApprovalEvidence`.

## Problem statement — the exact vulnerability

Two things are already correct and are **not** the gap: `approvalBindsRelease` is enforced at policy
construction (`rollout-policy.ts`), so an attestation cannot bind a release it does not name; and
revision monotonicity plus `emergencyDisable` already prevent stale re-enablement.

What is unproven is the **evidence → attestation** link:

1. `approvedModeCeiling` is caller-asserted. An operator writes `'ACTIVE'` next to any string.
2. `ApprovalEvidence.target` — the field that says _what this evidence is good for_ — is never consulted.
   Evidence saying `SHADOW_ELIGIBILITY` and an attestation claiming ceiling `ACTIVE` are two independent
   claims with nothing connecting them.
3. `evaluationRef` is deterministically derivable: `evref-${contentDigest({target, release,
suiteResultDigest})}`. Anyone who can call `contentDigest` produces a well-formed ref without running
   an evaluation.
4. The live proof: `docs/approvals/groq-staging-smoke-v1/release-approval.json` already carries
   `"evaluationRef": "eval.qfj.synthetic-connectivity-smoke.v1"` — a hand-written connectivity-smoke
   label sitting in the field, structurally indistinguishable from production evidence.

## Decision

### 1. The composition layer bridges the two packages

`model-gateway` **must not** depend on `model-evaluation`, and `model-evaluation` **must not** depend on
`model-gateway`. Both are containment-locked to `dependencies: ["zod"]`, and the QFJ-S1C-B precedent
already rejected the second direction.

`model-gateway` therefore declares a **type-only**, provider-neutral `EvaluationEvidenceVerifier`
interface, and `@qf-jarvis/model-gateway-composition` — which already exists to be where independent
leaves meet — depends on both and implements it. Dependency direction:

```
model-gateway-composition → model-gateway      (no path back)
model-gateway-composition → model-evaluation   (no path back)
```

**No new neutral package.** A third package to hold one interface and one lookup table is
overengineering; the composition layer exists for exactly this.

### 2. The target ladder lives in the composition, not in model-evaluation

The target → rollout-mode mapping needs both `EvaluationApprovalTarget` (model-evaluation) and
`GatewayMode` (model-gateway). Putting it in either leaf would either force a forbidden dependency or
duplicate the other's vocabulary. It is a total table in the composition:

| Target                                    | SHADOW | CANARY | ACTIVE |
| ----------------------------------------- | ------ | ------ | ------ |
| `ACTIVE_MODEL_RELEASE`                    | yes    | yes    | yes    |
| `CANARY_ELIGIBILITY`                      | yes    | yes    | no     |
| `SHADOW_ELIGIBILITY`                      | yes    | no     | no     |
| `CONNECTIVITY_SMOKE`                      | no     | no     | no     |
| `SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY` | no     | no     | no     |

`OFF` is never authorized _through_ evidence — OFF requires none. `FALLBACK` gets **no** new target: it
serves the stable release and stays governed by the existing stable-release approval.

**Evidence permission never replaces transition permission.** Both must hold; the existing transition
matrix is unchanged and is checked first.

### 3. `CONNECTIVITY_SMOKE` is structurally isolated

Added to the existing `EVALUATION_APPROVAL_TARGETS` array — a **membership** change, not a new export.
It authorizes no rollout mode, and must carry `synthetic: true` / `productionApproval: false`. A
connectivity smoke proves a socket opened; it says nothing about model quality, and the type system now
says so too.

### 4. `synthetic` and `productionApproval` widen to booleans

They were literal types (`true` / `false`), so no production-evidence path could exist at all. They
become validated booleans. `synthetic: true` with `productionApproval: true` is **invalid** — evidence
cannot be both synthetic and production-approved.

`CANARY` and `ACTIVE` require `synthetic: false` **and** `productionApproval: true`. `SHADOW` accepts
synthetic evidence, because shadow output is discarded.

**No production evidence artifact is manufactured in this slice.** `createApprovalEvidence` still emits
synthetic evidence from synthetic fixtures; only the legal type and the validation path exist.

### 5. The evidence digest is derived, never stored or trusted

No third digest field is added to `ApprovalEvidence`. The registry derives a digest over the **complete
canonical evidence object** with the existing `contentDigest`, recomputing it at registration and again
at verification. A caller-supplied `evidenceDigest` is only ever **compared**, never believed.

**This digest is not a security primitive.** `contentDigest` is four chained FNV-1a passes over
canonical JSON — deterministic, dependency-free, and forgeable by anyone who can run the function. It
detects drift and mismatch, not a motivated forger. The real control is that evidence must be
**registered by the operator at composition**, not merely _referenced_. Cryptographic signing and
evaluator-provenance verification are **deferred**.

### 6. The registry is frozen in memory

Built once from `readonly ApprovalEvidence[]` at composition, deeply frozen, with no `register` method
afterwards. Identical duplicate registration is **idempotent**; the same `evaluationRef` with a
different derived digest is **conflicting** and fails closed. Missing evidence fails closed. No
database, no filesystem, no network, no environment access.

### 7. The attestation extends additively

`evidenceDigest`, `approvalTarget` and `capabilityProfileRef` are added as **optional** schema fields and
are **mandatory** for any candidate transition above OFF. An old attestation carrying only
`evaluationRef` therefore cannot authorize SHADOW, CANARY or ACTIVE.

`capabilityProfileRef` is on the attestation because the check demanded by the audit
(`evidence-capability-mismatch`) needs an expected value, and `ModelCapabilityProfile` carries no
self-reference to compare against. This is a small, stated addition to the audit's field list.

`createRolloutApprovalAttestation` stays public and stays in the 71 — removing it would break the lock —
and the full `ApprovalEvidence` object is **not** embedded in the attestation.

### 8. No public runtime export is added anywhere

`model-evaluation` 33 · `model-gateway` 71 · `model-gateway-composition` 2 ·
`groq-staging-smoke` 24 · `event-backbone` 39. Every addition is array membership, a type-only export, an
optional parameter, or an internal module.

### 9. This slice activates nothing

The production composition remains OFF-only and structurally non-activatable. Registering valid,
passing, production-approved evidence still activates nothing, binds no provider, and calls nothing.
S2-C-B builds the gate and leaves it unreachable.

## Rejected alternatives

**A new neutral evidence-contract package.** Rejected: one interface and one table do not justify a
package; the composition already bridges.

**Making `createRolloutApprovalAttestation` internal.** Rejected: it is one of the 71 locked exports.

**Embedding `ApprovalEvidence` in the attestation.** Rejected: duplicates a frozen object and invites
drift between the copy and the registry.

**Storing an `evidenceDigest` field on the evidence.** Rejected: a digest stored beside the thing it
digests is a second source of truth. Derive it.

**Trusting the caller's `evidenceDigest`.** Rejected: that is the vulnerability, restated.

**Upgrading `contentDigest` to SHA-256 now.** Rejected for this slice: it would put `node:crypto` into a
package containment-tested to import no node module. Deferred, and the limitation is stated rather than
implied.

## Consequences

Rollout approval above OFF now fails closed unless backed by registered, passing, correctly bound
evidence whose target permits the requested mode. The S1 connectivity-smoke string is rejected as
`evidence-missing`, pinned by an executable regression test.

**No provider is production-active.** Secret-manager binding remains deferred to S2-D.

## Change-control rule

Raising the composition above `OFF` still requires a separate ADR and explicit owner authorization. This
ADR supplies the governance prerequisite; it grants no activation.
