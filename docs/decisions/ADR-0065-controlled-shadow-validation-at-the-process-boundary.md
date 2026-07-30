# ADR-0065 — Controlled SHADOW Validation at the Process Boundary

**Status:** Accepted (2026-07-30, QFJ-S2-E-B)
**Supersedes:** nothing
**Depends on:** ADR-0045 (gateway), ADR-0046 (Groq adapter), ADR-0049 (rollout governance),
ADR-0050 (capability registry), ADR-0052 (evaluation), ADR-0062 (production composition),
ADR-0063 (verified evidence binding), ADR-0064 (production credential binding)

---

## Context

The QFJ-S2-E-A audit traced the SHADOW path in code rather than from its name. What it found decides
this slice, so it is recorded here as fact rather than intent.

### The actual SHADOW semantics

`decideServing` returns, for `SHADOW`: `servingTarget: 'stable'`, `servingRelease: stable`, and
`shadowRelease: candidate` **only when** `policy.shadow && policy.maxShadowAttempts > 0`. Then in
`gateway.ts`:

1. the **stable** provider is invoked first, bounded to `1 + retryBudget` attempts;
2. only if stable is **accepted**, `runShadow` is `await`ed;
3. `runShadow` performs exactly one `tryOnce` against the candidate and reads only `outcome.kind` to
   pick an event type — the candidate response is **discarded inside the gateway**;
4. the **stable** response is returned to the caller.

Consequences that shape this design:

- **Two sequential provider calls**, never concurrent. If stable fails, the candidate is never called.
- **Candidate latency delays completion**, because `runShadow` is awaited before `return response`.
- **Candidate failure is non-fatal to the gateway** — the caller still receives a successful stable
  response.
- **The shadow call is invisible in provenance**: `runShadow` bypasses `runProviderLedger`, so neither
  the `AttemptLedger` nor `provenance.attempts` counts it.
- SHADOW has **no fallback release**, so `allowFallback` is not even consulted on that path.
- Groq `health()` is `Promise.resolve({ available: dataControlsAttested })` — **local, no network**.

## Decision

### 1. Candidate failure is a runner FAIL

Because the gateway returns stable success even when the shadow fails, a runner that trusted the
gateway's return value would report PASS for a run in which the candidate never worked. **A PASS
therefore requires both stable success and candidate shadow completion**, and a candidate failure
produces a fixed FAIL. It is never converted into a retry and never hidden behind stable success.

### 2. The runner owns its own hard counters

Since `provenance.attempts` excludes the shadow, the runner counts every credential read, provider
construction, health check, invocation and transport request itself, and **refuses before exceeding a
limit** rather than reporting an overrun afterwards.

### 3. Least authority: exactly `SHADOW_ELIGIBILITY`

The S2-C-B ladder would accept `CANARY_ELIGIBILITY` or `ACTIVE_MODEL_RELEASE` for SHADOW, because a
higher target is a superset. **This runner refuses both.** A first live SHADOW must not be authorised by
evidence minted for a broader purpose. `CONNECTIVITY_SMOKE` and
`SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY` remain incapable of authorising any mode.

### 4. Synthetic evidence is correct for SHADOW, and stays synthetic

`PRODUCTION_MODES` is `{CANARY, ACTIVE}`, so SHADOW never checks `synthetic` or `productionApproval`.
The first SHADOW evidence is `synthetic: true` / `productionApproval: false` — exactly what
`createApprovalEvidence` emits — because shadow output is discarded and reaches no user. **No production
evidence artifact is manufactured.**

### 5. Two Groq providers, one credential resolution

Two provider instances with **distinct** `providerId`, `releaseId` and `configDigest`, sharing one
`modelId`, one `modelVersion`, one `capabilityProfileRef`, one data-controls attestation, and **one**
credential resolution. Two instances are required because the capability registry cross-checks each
release against its provider's descriptor: a single instance would force both releases onto one
identity, making the shadow degenerate.

### 6. The model is configuration, never source

No `modelId` or `modelVersion` is hard-coded. Both arrive in the non-secret run config, and the exact
values remain an **S2-E-C owner decision**. A containment spec proves no live model id appears in
`apps/api` production source.

### 7. One internal evidence-registry subpath — no root API growth

`createEvaluationEvidenceRegistry` is internal to `@qf-jarvis/model-gateway-composition`, and
`apps/api` needs it to build the verifier. It is exposed through **exactly one** additional export
subpath, `./internal/evidence-registry`, following the `event-backbone` `./internal/*` CLI precedent.

The composition **root** runtime API stays at exactly **2**; the internal subpath is locked at exactly
**1**. No registry logic, target ladder, or verifier logic is duplicated. This is a
process-boundary-only seam, not a general extension surface.

### 8. A process-local composition — `createProductionModelGateway` is untouched

Making the production composition activatable would destroy the OFF-only guarantee three merged slices
established. The runner instead calls `createModelGateway` directly (a root export) with a
**process-local** rollout controller that is never returned, and passes the evidence verifier. An
external invariant spec asserts `createProductionModelGateway` remains OFF-only.

### 9. Fixed prompt and schema in source

`promptId` is the source constant `qfj.s2e.synthetic.shadow.v1`; the prompt literal and the strict
output schema live in source. **No prompt text is accepted from CLI or config** — a runtime-supplied
prompt is how a synthetic run becomes a real one by accident. Stable and candidate receive the **same
request object by identity**.

### 10. Both outputs are discarded; no digest, no length

The candidate response is already discarded by the gateway. The **stable** response reaches the runner
and its body is dropped immediately: only `usage` and `latencyMs` are retained. **No output digest and
no output length** — a digest of a two-field reply is a weak fingerprint of content, and nothing in the
result contract needs one.

### 11. Exact call budget for a PASS

1 credential file read · 1 resolve · 0 refreshes · 2 provider constructions · 2 health checks · 1
stable invocation · 1 candidate invocation · 2 transport requests · 0 retries · 0 fallbacks · 2 rollout
transitions · 1 timer armed · 1 cleared · 0 outputs retained.

### 12. OFF → SHADOW → OFF, with a `finally`

Start at `OFF` revision 0; exactly one transition to `SHADOW` revision 1 with `maxShadowAttempts: 1`;
one request; then in a `finally`, `emergencyDisable` and **assert** final mode `OFF` at revision 2.
Failing to prove final OFF is itself a fixed failure reason.

### 13. One hard deadline

One `AbortController` and one timer at `(2 × timeoutMs) + 10_000` ms, capped at `70_000`. The gateway
has no total-run budget and the shadow is awaited, so the runner supplies the only overall bound.
`timeoutMs` is owner-supplied and bounded to 1_000–30_000.

### 14. No refresh, no rebind, no dispose

No credential refresh, no provider hot-rebind, and no `dispose` API — the process exits immediately, so
a disposal protocol would be ceremony rather than a control.

## Rejected alternatives

**A candidate-only probe called "SHADOW".** Rejected: it bypasses the rollout controller, the evidence
gate and the serving path, and would misrepresent readiness.

**A fake stable provider.** Rejected: `FakeModelProvider` is `./testing`-only and must not enter a
production dependency graph.

**Making the production composition activatable.** Rejected — see §8.

**Reimplementing the target ladder in `apps/api`.** Rejected: exactly the duplicate rule ADR-0063 §2
exists to prevent.

**Reusing the smoke executable, release or `evaluationRef`.** Rejected: staging-only by its own header,
and `eval.qfj.synthetic-connectivity-smoke.v1` is the string S2-C-B specifically proves cannot
authorise SHADOW.

**Trusting the gateway's return value as the run verdict.** Rejected — see §1.

## Consequences

A production-shaped controlled SHADOW path exists, fully exercised offline against fakes and synthetic
credentials, and is incapable of running without an explicit config, explicit evidence, and an explicit
credential path. **No provider is production-active.**

## Change-control rule

Executing it against a real credential and a real provider is **S2-E-C** and requires a fresh,
single-use owner authorisation naming the exact commit, model, config digest, credential reference,
evidence reference, call budget and stop conditions. This ADR supplies a capability; it grants no run.
