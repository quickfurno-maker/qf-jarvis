# QFJ-S2-B — Production Model Gateway Composition and Live Invoker

**Slice:** QFJ-S2-B
**Date:** 2026-07-29
**Base:** `main` at `bfb6dd94f250d2cb9a5accff6c6ef4f529418726`
**ADR:** ADR-0062
**Outcome:** The gateway is wired. **It is born OFF and no provider is production-active.**

---

## 1. The S2-A finding this slice acts on

The gateway was never missing — it was **unwired**. `packages/model-gateway` already implemented the
whole request lifecycle: `createModelGateway`, the provider-neutral `ModelProvider` contract, the Groq
and local adapters, routing, rollout governance, the capability registry, strict JSON validation,
timeout and cancellation, budget policy, retry/fallback machinery, a circuit breaker, a closed error
vocabulary, and content-free observability.

The audit found exactly one reference to `createModelGateway` outside its own package: a containment
test asserting it is **never called**. The engine was built and never bolted in.

S2-B therefore **composes**. It copies no routing, retry, fallback, circuit, budget or validation logic,
and `gateway.ts` is not modified.

## 2. Composition architecture

`createProductionModelGateway(config)` returns a fail-closed result union — no throw, no partial
composition. Before `createModelGateway` is called it refuses, on injected declarations alone:

| Refusal                       | Condition                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| `mode-not-off`                | any mode other than `OFF`                                        |
| `retry-budget-not-zero`       | a default retry budget other than 0                              |
| `fallback-not-disabled`       | fallback requested                                               |
| `empty-composition`           | no approved release, or no provider                              |
| `wildcard-identity`           | `*` or `latest` in any release identity field                    |
| `unregistered-release`        | no registry profile for the release id                           |
| `capability-profile-mismatch` | the profile's release identity differs from the approved release |
| `unregistered-provider`       | no provider instance declares the release's provider id          |
| `provider-release-mismatch`   | a provider's declared identity contradicts the release           |

`capabilities()` is a pure local declaration getter and is the only provider method touched at
construction. **`health()` and `invoke()` are never called** — proved by a counting provider.

## 3. OFF-only, and structurally non-activatable

`mode` is fixed to `OFF`, so the gateway's own `invoke` refuses **before** provider selection, before
any health check, and before any credential could be touched.

**No rollout controller is constructed, passed to the gateway, or returned.** `transition()` and
`emergencyDisable()` are unreachable through this package — stronger than returning a controller and
documenting that it must not be used. No routing profile is supplied either, so the rollout and hybrid
paths are not merely unused but unreachable.

The returned composition has exactly two members, `gateway` and `status`; `gateway` has exactly one
method, `invoke`. There is no activate, promote, enable, or transition method to call.

## 4. Reliability posture

`allowFallback: false` is a real `ModelGatewayConfig` field. `retryBudget` is a **request** field, so it
cannot be locked by configuration; a bounded admission guard performs one scalar comparison and refuses
any request carrying `retryBudget !== 0` with the existing `request-invalid` code. A malformed candidate
passes straight through, so `validateModelRequest` remains the single authority on request validity.

## 5. The live invoker

`createLiveModelGatewayInvoker(gateway)` is the **first non-fake implementation** of the QFJ-M4
`ModelGatewayInvoker` seam. It performs exactly one `gateway.invoke` call and translates the outcome.
The request passes through unmodified — asserted by object identity, not deep equality.

Transient classification is a **total `Record` over the closed `ModelGatewayErrorCode` set**, so adding
a code to the vocabulary without classifying it is a compile error rather than a silent `false`. It is
never a message parse: an error whose text says "timeout rate-limited transient" but whose code is
`human-only` is classified non-transient, and a duck-typed impostor is not trusted as a gateway error.

A foreign thrown value becomes `{ ok: false, transient: false }` retaining no message, name, cause or
stack. The adapter contains exactly one `gateway.invoke(` call site and no loop of any kind.

## 6. The `rate-limited` taxonomy — added, and honestly bounded

`rate-limited` is now a member of `MODEL_GATEWAY_ERROR_CODES` with a fixed, low-cardinality message, and
the live invoker classifies it transient.

**It is deliberately not yet producible from a Groq 429, and that is recorded as an executable test
rather than a comment.** Surfacing 429 as `rate-limited` end to end requires a new
`ProviderInvocationResult` status, which provably breaks `gateway.ts`:

```
packages/model-gateway/src/gateway.ts(208,6): error TS2366:
  Function lacks ending return statement and return type does not include 'undefined'.
```

`gateway.ts` owns the sole `status → code` mapping and is out of scope for this slice. Rather than edit
a forbidden file or ship a second parallel mapping that nothing consumes, `normalizeGroqHttpStatus` is
left **byte-identical**: 429 still yields `{ status: 'unavailable', retryable: true }`. All non-429
mappings — 401/403/4xx `failed`, 5xx and 498 `unavailable`, 499 `cancelled` — are unchanged and pinned.
S2-C closes the gap with a one-line change.

Because `retryBudget` is 0 and fallback is disabled, `transient: true` changes no behaviour in this
slice. It informs the caller; QuickFurno Core remains the authority on what happens next.

## 7. Credential-resolver seam — interface only

The existing gateway `GroqCredentialResolver` is **reused**, not re-abstracted, as an optional opaque
config field. S2-B ships **no implementation**: no environment variable, no file, no OS keychain, no
cloud secret store, no masked TTY. Providers arrive already constructed, so the seam is never invoked —
asserted by a recording resolver whose call count stays 0. The status reports only _whether_ a seam was
supplied, never the resolver and never a credential.

## 8. API locks

| Package                                | Runtime exports                           |
| -------------------------------------- | ----------------------------------------- |
| `@qf-jarvis/model-gateway`             | **71** (new lock — this package had none) |
| `@qf-jarvis/model-gateway-composition` | **2**                                     |
| `@qf-jarvis/groq-staging-smoke`        | 24 (unchanged)                            |
| `@qf-jarvis/model-evaluation`          | 33 (unchanged)                            |
| `@qf-jarvis/event-backbone`            | 39 (unchanged)                            |

The composition root is `createProductionModelGateway` and `createLiveModelGatewayInvoker`; every
configuration, status, result and refusal type is type-only. Counting the imported barrel counts runtime
exports only, so adding a type costs nothing and adding a value is a reviewed change.

## 9. Boundaries

No credential was read, requested, validated, displayed, hashed, stored, or used. No resolver
invocation. No smoke harness run. No Groq, local-model, or any network request. No `process.env`, no
filesystem secret loading. No database, Supabase, Docker, or migration. No deployment, rollout
activation, provider activation, canary, or `ACTIVE` mode. No event-backbone integration, no
prompt registry. The S1 smoke package is untouched. The protected reconciliation directory was reported
from `git status` alone.

**Evaluation-evidence binding is deferred to S2-C and is a prerequisite for any `ACTIVE` or `CANARY`
authorization.** S2-B is structurally incapable of either, so deferring it creates no exposure.

**No provider is production-active after this PR.**
