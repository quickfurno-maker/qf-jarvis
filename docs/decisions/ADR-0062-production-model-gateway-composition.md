# ADR-0062 — Production Model Gateway Composition and Live Invoker

**Status:** Accepted (2026-07-29, QFJ-S2-B)
**Supersedes:** nothing
**Depends on:** ADR-0045 (gateway foundation), ADR-0046 (Groq adapter), ADR-0047 (local adapter),
ADR-0048 (hybrid routing), ADR-0049 (rollout governance), ADR-0050 (capability registry),
ADR-0052 (evaluation), ADR-0057 (model reply adapter), ADR-0058 (async boundaries)

---

## Context

The QFJ-S2-A audit established that the Model Gateway is not missing — it is **unwired**. The package
already implements the request lifecycle end to end: `createModelGateway`, the provider-neutral
`ModelProvider` contract, the Groq and local OpenAI-compatible adapters, routing, rollout governance,
the capability registry, strict JSON validation, timeout and cancellation, budget policy, retry and
fallback machinery, a circuit breaker, a closed error vocabulary, and content-free observability.

The audit found exactly one reference to `createModelGateway` outside its own package, and it is a
containment test asserting the symbol is **never called**. The engine was built and never bolted in.

## Problem statement

Four gaps block a production model call, none of which is a gateway capability gap:

1. `createModelGateway` is never instantiated outside `@qf-jarvis/model-gateway`.
2. `ModelGatewayInvoker` — the QFJ-M4 seam the reply adapter consumes — has no live implementation;
   the only implementations are five deterministic fakes under `./testing`.
3. There is no production credential-resolver seam. The only concrete `GroqCredentialResolver` is the
   masked-TTY resolver, whose own header declares it must never become the production integration.
4. The gateway root API has no numeric count lock, unlike its sibling packages.

## Decision

### 1. Compose; do not reimplement

A new package `@qf-jarvis/model-gateway-composition` **calls** `createModelGateway`. It copies no
routing, selection, retry, fallback, circuit, budget, or validation logic. `gateway.ts` is not
modified. Any behaviour the composition appears to add must be traceable to an existing gateway
contract field, or it does not belong here.

### 2. The composition is born OFF and cannot be activated in this slice

`ModelGatewayConfig.mode` is fixed to `OFF`. The gateway's own `invoke` refuses every request that is
not in `ACTIVE` mode, so refusal happens **before** provider selection, before any `health()` call, and
before any credential is touched. A configuration requesting `ACTIVE` or `CANARY` — or `SHADOW` or
`FALLBACK` — is refused at construction, not at invocation.

No rollout controller is constructed, passed to the gateway, or returned. The composition therefore has
no rollout mutation surface at all: `transition()` and `emergencyDisable()` are unreachable through it.
This is stronger than returning a controller and documenting that it must not be used.

### 3. `retryBudget` is 0 and fallback is disabled

`allowFallback: false` is passed to the real gateway config. `retryBudget` is a **request** field, not a
gateway config field, so the composition enforces it with a bounded admission guard that refuses any
request carrying `retryBudget !== 0`. The guard performs one scalar comparison; it is not a router.

### 4. No real credential resolver

The composition accepts an **optional, opaque** `GroqCredentialResolver` — the interface that already
exists in the gateway. No new abstraction is introduced, because the existing one is suitable. S2-B
ships no implementation of it: no environment variable, no file, no OS keychain, no cloud secret store,
no masked TTY. The composition never calls it; providers arrive already constructed.

### 5. The live invoker is an adapter, not a router

`createLiveModelGatewayInvoker` implements the existing `ModelGatewayInvoker` interface over a real
`ModelGateway`. It performs exactly one `gateway.invoke` call and translates the outcome. It selects no
provider, retries nothing, falls back to nothing, mutates no rollout, resolves no prompt, and inspects
no credential. Transient classification is a total map over the closed `ModelGatewayErrorCode` set —
never a message parse.

### 6. `rate-limited` joins the closed error vocabulary, but is not yet reachable

`rate-limited` is added to `MODEL_GATEWAY_ERROR_CODES` so the taxonomy can express "over quota"
distinctly from "provider is down", and so the live invoker's total transient map has a home for it.

**It is deliberately not yet producible, and this is recorded rather than hidden.** Making Groq's HTTP
429 surface as `rate-limited` end to end requires a new `ProviderInvocationResult` status, and that
provably breaks `gateway.ts`:

```
packages/model-gateway/src/gateway.ts(208,6): error TS2366:
  Function lacks ending return statement and return type does not include 'undefined'.
```

`gateway.ts` owns the sole `status → code` mapping and is explicitly out of scope for S2-B. Rather than
edit a forbidden file or ship a second parallel mapping that nothing consumes,
`normalizeGroqHttpStatus` is left **byte-identical**: 429 still yields
`{ status: 'unavailable', retryable: true }`, exactly as before. A test pins that current behaviour and
names the one-line `gateway.ts` change S2-C requires. The gap is executable knowledge, not a comment.

### 7. API locks

`@qf-jarvis/model-gateway` root **runtime** exports are frozen at **71**. The new composition package is
frozen at **2** runtime exports (`createProductionModelGateway`, `createLiveModelGatewayInvoker`);
everything else is type-only. Existing locks are unchanged: groq-staging-smoke 24, model-evaluation 33,
event-backbone 39.

### 8. Evaluation-evidence binding is deferred to S2-C and gates activation

`RolloutApprovalAttestation.evaluationRef` is presently validated only as a string pattern; nothing
verifies that the referenced evidence exists, passed, or binds the release. Closing that is S2-C.

**No `ACTIVE` or `CANARY` authorization may be granted until it is closed.** S2-B is structurally
incapable of either, so this ADR does not create the exposure it defers.

## Rejected alternatives

**Build a production orchestrator.** Rejected: it would duplicate 973 tested lines of `gateway.ts` and
create two routers with divergent failure semantics.

**Return the rollout controller and document that it must not be used.** Rejected: a documented
prohibition is weaker than an absent method.

**Edit `gateway.ts` for the 429 mapping.** Rejected: explicitly out of scope; deferred with proof.

**Add a second Groq-429 mapping function for the composition to consume.** Rejected: two mappings for
one condition is the bug this taxonomy exists to prevent.

## Consequences

No provider is production-active after this slice. The composition can be constructed, inspected, and
refused; it cannot serve. The next slice (S2-C) closes evaluation binding, then activation becomes an
owner decision with evidence behind it.

## Change-control rule

Raising the composition above `OFF` requires: closed evaluation-evidence binding (S2-C), a verified
approval attestation, an explicit owner authorization, and a separate ADR. No code change alone
suffices.
