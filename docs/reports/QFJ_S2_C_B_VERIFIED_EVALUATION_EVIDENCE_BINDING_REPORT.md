# QFJ-S2-C-B — Verified Evaluation-Evidence Binding

**Slice:** QFJ-S2-C-B
**Date:** 2026-07-29
**Base:** `main` at `d3d08a34890b97481d4af1dd8af428248d1d249a`
**ADR:** ADR-0063
**Outcome:** Rollout approval above OFF now fails closed without registered evidence.
**No provider is production-active.**

---

## 1. The former vulnerability

Two complete systems that never met. `model-evaluation` produced immutable `ApprovalEvidence` and ended
at `toRolloutApprovalReference`, which nothing outside its own spec consumed. `model-gateway` gated
rollout on a `RolloutApprovalAttestation` whose `evaluationRef` was validated only as a character class.
`model-gateway` contained **zero** references to `model-evaluation`.

Four concrete defects:

1. `approvedModeCeiling` was **caller-asserted** — an operator wrote `'ACTIVE'` beside any string.
2. `ApprovalEvidence.target` — the field saying what evidence is good for — was **never consulted**.
3. `evaluationRef` is deterministically derivable, so a well-formed ref needs no evaluation.
4. `docs/approvals/groq-staging-smoke-v1/release-approval.json` already carried
   `"evaluationRef": "eval.qfj.synthetic-connectivity-smoke.v1"` — a hand-written connectivity label in
   the field, indistinguishable from production evidence.

**Two things the audit listed were already closed and were not rebuilt:** `approvalBindsRelease` is
enforced at policy construction, and revision monotonicity plus `emergencyDisable` already blocked stale
re-enablement.

## 2. Existing contracts reused

`ApprovalEvidence`, `EvaluationBinding`, `createEvaluationBinding`, `contentDigest`, `evaluationRef`,
`suiteResultDigest`, `caseSetDigest`, `EVALUATION_APPROVAL_TARGETS`, `ProviderReleaseRef`,
`RolloutApprovalAttestation`, `approvalBindsRelease`, `validateTransition`, `ROLLOUT_REFUSAL_REASONS`,
`createProviderRolloutController`. Nothing was reimplemented.

## 3. Target ladder and `CONNECTIVITY_SMOKE` isolation

| Target                                    | SHADOW | CANARY | ACTIVE |
| ----------------------------------------- | ------ | ------ | ------ |
| `ACTIVE_MODEL_RELEASE`                    | yes    | yes    | yes    |
| `CANARY_ELIGIBILITY`                      | yes    | yes    | no     |
| `SHADOW_ELIGIBILITY`                      | yes    | no     | no     |
| `CONNECTIVITY_SMOKE`                      | no     | no     | no     |
| `SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY` | no     | no     | no     |

`OFF` is never authorized through evidence. `FALLBACK` receives no target — it serves the stable release.

The ladder is a **total `Record`** in the composition package, so adding a target without deciding its
ladder is a compile error. It lives there because it needs both `EvaluationApprovalTarget` and
`GatewayMode`, and neither leaf may import the other.

## 4. Boolean widening

`synthetic` and `productionApproval` widened from literal `true`/`false` to validated booleans, so a
non-synthetic production path can exist at all. `synthetic && productionApproval` is invalid.
`CONNECTIVITY_SMOKE` must be `synthetic: true` / `productionApproval: false`.

**No production evidence artifact was manufactured.** `createApprovalEvidence` still emits synthetic
evidence from synthetic fixtures, asserted across every target.

## 5. Derived digest

No third digest field was added. The registry derives a digest over the **complete canonical evidence
object** with the existing `contentDigest`, recomputing at registration and again at verification. A
caller's `evidenceDigest` is only ever compared.

**This digest is not a security primitive.** `contentDigest` is four chained FNV-1a passes over
canonical JSON — forgeable by anyone who can run it. The real control is that evidence must be
**registered by the operator at composition**, not merely referenced. Signing and evaluator provenance
are deferred.

## 6. Verifier boundary and registry

`model-gateway` declares a **type-only** `EvaluationEvidenceVerifier`, importing nothing from
`model-evaluation`. The composition implements it over a frozen registry. Dependency direction:

```
model-gateway-composition → model-gateway      (no path back — deps still ["zod"])
model-gateway-composition → model-evaluation   (no path back — deps still ["zod"])
```

The registry is built once, deeply frozen, and exposes no mutator. Identical duplicates are
**idempotent**; the same `evaluationRef` with a different derived digest is **conflicting** and refuses
the whole composition. No database, filesystem, network, or environment access.

## 7. Attestation and verification matrix

`evidenceDigest`, `approvalTarget` and `capabilityProfileRef` are **optional** at the schema boundary and
**mandatory** above OFF. `capabilityProfileRef` is on the attestation because
`evidence-capability-mismatch` needs an expected value and `ModelCapabilityProfile` carries no
self-reference — a small, stated addition beyond the audit's field list.

| Check                                              | Refusal                                            |
| -------------------------------------------------- | -------------------------------------------------- |
| verifier injected                                  | `evidence-verifier-unavailable`                    |
| attestation carries its evidence claim             | `evidence-missing` (throws at policy construction) |
| ref registered                                     | `evidence-missing`                                 |
| derived digest matches claim                       | `evidence-digest-mismatch`                         |
| release id/provider/model/version/digest/class     | `evidence-release-mismatch`                        |
| capability profile                                 | `evidence-capability-mismatch`                     |
| claimed target = evidence target, and permits mode | `evidence-target-insufficient`                     |
| synthetic policy                                   | `synthetic-evidence-forbidden`                     |
| production approval                                | `production-approval-required`                     |

The evidence gate runs **last**, after the transition matrix, so evidence can never rescue a transition
the matrix forbids — proved by an OFF→ACTIVE leap still refusing `invalid-transition`.

## 8. Connectivity-smoke regression

`eval.qfj.synthetic-connectivity-smoke.v1` is refused as `evidence-missing` for SHADOW, CANARY and
ACTIVE — **even with** an `ACTIVE` ceiling, an exactly matching `releaseId` and `configDigest`, and a
fresh revision. And registered connectivity evidence under its own real `evref-` identity still refuses
with `evidence-target-insufficient`. The guard is structural, not a blocklist: no source hard-codes the
string.

## 9. OFF-only proof

Registering valid, non-synthetic, production-approved `ACTIVE_MODEL_RELEASE` evidence **activates
nothing**: the composition stays `OFF`, `activatable: false`, invocation refuses `gateway-off`, and
provider invocations, health checks, credential-resolver calls and transport calls all remain **0**. No
verifier, registry, evidence set or rollout controller is reachable through the returned composition;
the status carries a **count only**.

## 10. Locks

model-evaluation **33** · model-gateway **71** · model-gateway-composition **2** ·
groq-staging-smoke **24** · event-backbone **39**. Every addition is array membership, a type-only
export, an optional parameter, or an internal module.

## 11. The initial-state bypass — found before merge, now CLOSED

The first revision of this slice gated only **transitions**, and shipped that gap as an accepted
residual. Owner review rejected that, correctly. The bypass was **reproduced** against the pre-fix code:
a fabricated attestation citing `eval.qfj.synthetic-connectivity-smoke.v1` with a fabricated digest,
seeded as the **initial `ACTIVE` policy** with **no verifier at all**, served a real response —
`textResult=served`, `providerInvocations=1`.

It is now closed by two gates sharing **one** implementation, `verifyCandidateEvidence`:

1. **`createProviderRolloutController` verifies its initial policy** and throws rather than returning an
   unverified controller. Combined with the existing transition gate and an `emergencyDisable` that can
   only reach OFF, every policy the factory can ever hold is inductively verified.
2. **The gateway serving boundary** verifies `snapshot()` **before any provider is consulted** — ahead of
   budget admission, the health map, capability filtering, selection and invocation. This is required
   because `rolloutController` is an _interface_: a foreign implementation never passes the factory.

**Evidence verification now applies to transitions, initial state, and restored or externally supplied
state alike. No candidate can reach provider execution without verified evidence** — proved with a
foreign controller, where provider invocation, health-check, credential-resolver and transport counts all
remain **0**, both with a verifier present (`evidence-missing`) and absent
(`evidence-verifier-unavailable`).

The production composition remains OFF-only and constructs no rollout controller; that is no longer the
thing holding the gate shut.

## 12. Boundaries

No credential read, requested, validated, hashed, stored or used. No resolver invocation. No smoke run.
No Groq, local-model or any network request. No `process.env`, no filesystem secret loading. No database,
Supabase, Docker or migration. No deployment, rollout activation, provider activation, SHADOW, CANARY,
ACTIVE or FALLBACK. No event-backbone integration. `gateway.ts`, `groq-staging-smoke`, `event-backbone`,
migrations and `apps/` untouched.

**Secret-manager binding remains deferred to S2-D. No provider is production-active.**
