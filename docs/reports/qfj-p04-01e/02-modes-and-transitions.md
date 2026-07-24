# Report 02 — Modes and Transitions

**Slice:** QFJ-P04.01E — Provider Operations and Rollout Governance. **ADR:** [ADR-0049](../../decisions/ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md).

## Immutable concepts

- **`ProviderReleaseRef`** — a frozen `{ releaseId, providerId, modelId, modelVersion, executionClass, configDigest }`. No secret, no provider object, no arbitrary metadata. Two releases match iff their `releaseId` **and** `configDigest` match.
- **`RolloutApprovalAttestation`** — a frozen `{ evaluationRef, releaseId, configDigest, privacyRefs, approvedModeCeiling, approvedCanaryBasisPoints, revision }`. Opaque; no legal claim; bound to an exact release id + digest.
- **`ProviderRolloutPolicy`** — a frozen `{ rolloutId, revision, mode, stable, candidate?, canaryBasisPoints, shadow, fallbackToStable, maxServingAttempts, maxShadowAttempts, operatorReason, approval? }`. **Default OFF** via `offRolloutPolicy`.

## Policy validation — proven

`createProviderRolloutPolicy` rejects (each covered by a test): a missing candidate in SHADOW/CANARY/ACTIVE/FALLBACK; non-zero canary basis points outside CANARY; the `shadow` flag outside SHADOW; a candidate identical to the stable release; a missing approval when a candidate is present; and an approval that does not bind the candidate (id + digest). The release and approval factories reject malformed ids, an unknown execution class, extra keys (strict schemas), a too-short digest, and an out-of-range canary ceiling. The frozen policy carries no secret/prompt/message field and no `kimi` reference.

## Mode semantics

| Mode       | Serving                                                                                                   | Shadow                                                                                                                  | Fallback                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `OFF`      | none — fail closed (`gateway-off`)                                                                        | —                                                                                                                       | —                                                                                     |
| `SHADOW`   | stable only; stable response is the sole result                                                           | one sequential candidate shadow after stable acceptance; **output discarded**; failure non-fatal; none if stable failed | —                                                                                     |
| `CANARY`   | deterministic `rolloutId`+`runId` cohort: candidate iff `bucket < bp`, else stable; **one serving route** | —                                                                                                                       | candidate→stable, only if `fallbackToStable`, transient, privacy-safe, budget remains |
| `ACTIVE`   | candidate serves all eligible traffic; stable is rollback reference                                       | —                                                                                                                       | none (stable is rollback only)                                                        |
| `FALLBACK` | stable serves primary                                                                                     | —                                                                                                                       | candidate as bounded transient fallback                                               |

The `decideServing` unit tests confirm each shape; the gateway-integration tests confirm the end-to-end behaviour (Report 03).

## Transition matrix — proven

`validateTransition` enforces the strict matrix (same-mode adjustments and ANY→OFF always permitted):

| From       | Allowed next modes                              |
| ---------- | ----------------------------------------------- |
| `OFF`      | `OFF`, `SHADOW`                                 |
| `SHADOW`   | `SHADOW`, `CANARY`, `OFF`                       |
| `CANARY`   | `CANARY`, `ACTIVE`, `SHADOW`, `OFF`             |
| `ACTIVE`   | `ACTIVE`, `CANARY`, `SHADOW`, `FALLBACK`, `OFF` |
| `FALLBACK` | `FALLBACK`, `OFF`                               |

Proven: the promotion path `OFF→SHADOW→CANARY→ACTIVE`; **`OFF→ACTIVE` and `SHADOW→ACTIVE` are rejected** (`invalid-transition`); the rollback/demotion paths are allowed; a stale `expectedRevision` and a non-monotonic revision are rejected (`stale-revision`); a **changed candidate requires a safe restart** to OFF/SHADOW (a `CANARY→CANARY` with a changed candidate is rejected, `CANARY→SHADOW` with a changed candidate is allowed); a **canary increase beyond the approval ceiling** is rejected (`approval-canary-ceiling`) while a decrease is allowed; and a candidate-bearing mode beyond the approval's mode ceiling is rejected (`approval-mode-ceiling`). There is **no automatic promotion and no self-approval**.

## Controller and emergency disable — proven

`createProviderRolloutController` holds the current policy in memory (non-global; no env/persistence/remote/CLI). `snapshot()` returns the current immutable policy; `transition()` applies a validated, monotonic, optimistic-concurrency change and emits `rollout-transitioned` (or `rollout-refused`); `emergencyDisable()` jumps to a **new OFF revision** and emits `emergency-disabled`. Proven: a valid transition applies and a stale one is rejected without changing state; an emergency disable from ACTIVE lands OFF at a strictly higher revision, and a **stale-revision caller can neither transition nor re-enable**; events are safe and content-free.
