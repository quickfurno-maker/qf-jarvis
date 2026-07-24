# Report 03 — Canary, Shadow, Fallback, and Attempt Proof

**Slice:** QFJ-P04.01E — Provider Operations and Rollout Governance. **ADR:** [ADR-0049](../../decisions/ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md).

## Deterministic canary — proven

`canaryBucket(rolloutId, runId)` is a 32-bit FNV-1a (non-cryptographic) hash of `${rolloutId} ${runId}` reduced to `[0, 10000)`. It reads **no** time, randomness, user/client/vendor/subject, or business value, and persists nothing. Proven: the same `rolloutId + runId` always yields the same bucket; every bucket is in `[0, 10000)`; at `0` basis points everyone routes to **stable** and at `10000` everyone routes to **candidate**. The candidate serves iff `bucket < canaryBasisPoints`.

## SHADOW — stable-only serving, one non-returning shadow

End-to-end (gateway integration):

- The **stable** response is the sole result (`textResult` is the stable output; provenance names the stable provider).
- After stable acceptance, the candidate is invoked **exactly once** as a shadow; its output (`candidate-shadow-only`) is asserted **absent** from the response.
- A **candidate shadow failure is non-fatal** — the stable response is still returned.
- A **stable failure prevents the shadow** — the candidate is invoked **0 times** and the run terminates on the stable failure.
- The shadow runs on a separate one-call budget; it is never marked accepted and is never used as a fallback. It is re-gated on `signal.aborted` and on the controller not having been disabled mid-run (a changed revision skips the shadow). No parallel shadow traffic.

## CANARY — one serving route, bounded candidate→stable fallback

- At `0` bp the request serves **stable** (candidate 0 invocations); at `10000` bp it serves **candidate** (stable 0 invocations) — exactly one serving route.
- When serving the candidate with `fallbackToStable` enabled, a **retryable** candidate failure (`provider-unavailable`) falls over to **stable once** (`usedFallback: true`; candidate 1 call, stable 1 call).
- A **non-retryable** candidate failure does **not** fall back (terminates `provider-failed`, stable 0 calls).

## ACTIVE / FALLBACK

- **ACTIVE** serves the candidate for all eligible traffic (stable 0 invocations); stable is a rollback reference with no automatic fallback.
- **FALLBACK** serves stable primary and falls over to the candidate on a **transient** stable failure (`usedFallback: true`); a **non-retryable** stable failure terminates without invoking the candidate.

## Attempt accounting

Serving reuses the QFJ-P04.01D `AttemptLedger` bounded by `policy.maxServingAttempts`: the serving release retries within `min(1 + retryBudget, maxServingAttempts)`, and a single bounded fallback runs within the **same** ledger (it does not reset the budget). There is **at most one accepted response** and **no invocation after acceptance** (the SHADOW candidate is the sole exception and is explicitly never marked accepted). The shadow uses a **separate** one-call budget. There are **no parallel or speculative provider calls and no voting**. Every serving refusal (OFF, unhealthy, privacy, approval-mismatch) is **pre-invocation** — no provider is called.

## Emergency disable during a run

The serving snapshot is taken once at the start of a run; before running the shadow or the fallback, the gateway re-checks `signal.aborted` and that the controller's revision is unchanged (`controller.snapshot().revision === policy.revision`). A synchronous `emergencyDisable` that lands a new OFF revision therefore suppresses the shadow/fallback and blocks the **next** call outright (`gateway-off`); a stale-revision caller cannot re-enable.
