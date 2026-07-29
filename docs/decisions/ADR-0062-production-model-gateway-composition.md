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
routing, selection, retry, fallback, circuit, budget, or validation logic, and it changes nothing in
`gateway.ts`. Any behaviour the composition appears to add must be traceable to an existing gateway
contract field, or it does not belong here.

(`gateway.ts` does receive one change in this slice — a single `case` in its provider-status switch,
covered in §6. It belongs to the rate-limit taxonomy, not to the composition, which remains a pure
caller.)

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

### 6. `rate-limited` is reachable end to end

_(Amended 2026-07-29. The first revision of this ADR shipped `rate-limited` as a declared-but-unreachable
code, because closing it required editing `gateway.ts`, which S2-B's original scope forbade. The owner
subsequently authorized the minimum contract change, and it is now complete. The interim state is
recorded here rather than erased.)_

The path is:

```
Groq HTTP 429
  → ProviderInvocationResult { status: 'rate-limited' }        (groq-error-normalization.ts)
  → ModelGatewayError('rate-limited')                          (gateway.ts, one switch case)
  → ModelGatewayInvocation { ok: false, transient: true }      (live-model-gateway-invoker.ts)
```

Three deliberate properties:

**The new provider status carries no `retryable` flag.** A rate limit is transient in principle, but the
gateway has no backoff, so an immediate in-loop retry would deepen the limit rather than clear it. The
gateway therefore classifies the attempt non-retryable, which also means the surfaced code stays
`rate-limited` at any retry budget instead of degrading to `retry-budget-exhausted`.

**`transient: true` is metadata, not an instruction.** It tells QuickFurno Core the condition may clear;
it triggers nothing. `retryBudget` is 0, `allowFallback` is false, and `rate-limited` is not in
`isRolloutTransient`'s set, so no retry and no fallback follow from it — proved by tests at retry budgets
0, 1 and 3, and by a second eligible provider that is never called.

**Nothing from the response escapes.** The whole input to normalization is an HTTP status _number_, so a
body, header, `Retry-After` value or URL has no representable path out. The error message is fixed and
no `cause` is retained.

The `gateway.ts` change is one `case` in the existing `switch (result.status)`. **No `default` clause was
added** — exhaustiveness is what turned this contract change into a compile error rather than a silent
misclassification, and a test now pins the absence of a `default` and the case count at 7.

### 6a. One consequential edit outside the gateway

Widening `ProviderInvocationResult` also reaches `packages/groq-staging-smoke/src/run-once.ts`, whose
switch has a pre-existing `default:` clause. Without a case there, a 429 during any future authorized
smoke would be misreported as `smoke-invariant` — a harness bug — instead of
`smoke-provider-unavailable`.

A single case was therefore added mapping `rate-limited` to the S1A outcome the 429 already produced:
same sanitized reason, same `retryable` flag. **The S1A outcome vocabulary is unchanged and all three
affected smoke specs pass unmodified**, which is the proof that the harness's observable behaviour did
not move. Preserving behaviour was preferred to editing those specs to enshrine a regression.

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

**Add a second Groq-429 mapping function for the composition to consume.** Rejected: two mappings for
one condition is the bug this taxonomy exists to prevent.

**Leave `rate-limited` declared but unreachable.** Rejected on amendment: a code the gateway cannot
produce reads as working handling and is worse than no code at all.

**Give the new provider status `retryable: true`.** Rejected: the gateway has no backoff, so it would
retry straight into the limit, and `terminalCode` would surface `retry-budget-exhausted` instead of
`rate-limited` whenever a retry budget was set — defeating the mapping this change exists to create.

**Update the three smoke specs to expect `smoke-invariant`.** Rejected: that records a regression as if
it were intended. One case in the harness's switch preserves the behaviour those specs already assert.

## Consequences

No provider is production-active after this slice. The composition can be constructed, inspected, and
refused; it cannot serve. The next slice (S2-C) closes evaluation binding, then activation becomes an
owner decision with evidence behind it.

## Change-control rule

Raising the composition above `OFF` requires: closed evaluation-evidence binding (S2-C), a verified
approval attestation, an explicit owner authorization, and a separate ADR. No code change alone
suffices.
