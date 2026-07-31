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

## Amendment — QFJ-S2-E-C-R1: the closed candidate failure class

**Status:** accepted. Amends §10 (the result contract) only. Every other decision above stands
unchanged.

### Why

The first correctly formed live SHADOW run completed safely — one credential read, two provider
constructions, two health checks, one stable invocation that succeeded, one candidate invocation,
`OFF → SHADOW → OFF` at revision 2, both outputs discarded, no retry, no fallback, no refresh — and
returned `outcome: FAIL`, `reason: provider-unavailable`.

The offline audit that followed established that the stable and candidate legs send **byte-identical**
HTTP requests: the per-leg `providerId`, `releaseId` and `configDigest` are governance identities and
never reach the wire. So the candidate failed on the same bytes that had succeeded moments earlier, and
no composition defect could explain it.

The result could not be acted on. `provider-unavailable` folds four operationally opposite situations
into one string: an HTTP 4xx rejection means _stop and check the account_, an HTTP 5xx or a network
failure means _the attempt may simply be retried_. Choosing between them would have been a guess, and a
rerun under the old contract would have consumed a single-use authorisation to produce an equally
unreadable line.

### Decision

The result carries **one** additional field, `candidateFailureClass`, from a frozen closed vocabulary of
exactly six literals. It is diagnostic context; **`reason` remains authoritative** for the run outcome
and is unchanged by this amendment.

| Class                | Meaning                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `none`               | The candidate completed and the gateway accepted its output.                                  |
| `not-invoked`        | The candidate was never delegated to — the run stopped before, or refused at, the boundary.   |
| `client-rejected`    | A response was obtained and it **rejected the request** (the 4xx family).                     |
| `server-unavailable` | A response was obtained and it **declined to serve** (the 5xx family), or it served too late. |
| `transport-error`    | **No usable response was obtained**: the transport failed, was cut off, or the call threw.    |
| `output-invalid`     | A response was obtained and served, but its payload failed the strict output contract.        |

The partition is a single question — _did we obtain a provider response, and what did it say?_

### How `server-unavailable` and `transport-error` became separable

They are **not** separable from the provider result alone, and this is the point at which fabricating a
distinction was the real risk. The Groq adapter maps an HTTP 5xx and a network-level rejection to the
identical `{ status: 'unavailable', retryable: true }`.

The distinction is instead **derived from a fact `apps/api` already owns**: the counting transport
wrapper sits between the provider and the real transport, so it can record whether `send` resolved or
rejected. It records that one bit and nothing else — the request, the response and the rejection value
are never read, and the rejection is re-thrown untouched.

A budget refusal is deliberately _not_ recorded as a transport rejection: it is the runner's own refusal,
and conflating the two would mislabel a self-imposed stop as a provider failure.

### Two mappings that required a judgement, recorded explicitly

1. **`rate-limited` classes as `client-rejected`.** HTTP 429 is a 4xx rejection — a response was obtained
   and it rejected the request. The top-level `reason` still reports `rate-limited`, so no specificity is
   lost, and no seventh enum value was invented to hold it.
2. **`timeout` and `cancelled` class as `transport-error`** when no response was delivered. Both mean no
   usable provider response was obtained, which is exactly what that class denotes. Their `reason` values
   are likewise unchanged.

### What the class must never carry

No HTTP status, no provider or error message, no cause, no stack, no header, no URL or endpoint, no
response body, no retryable flag, no free-form string. A coarse class answers the operational question;
an exact status would begin to describe the account rather than the run.

### Contract effect

The one-line result grows from **37 to 38 keys**. The new key sits immediately after `reason`, is always
present, is never null or undefined, and is included in the CLI's explicit safe-key projection. Output
disposal, the call budget, the `OFF → SHADOW → OFF` lifecycle and the final emergency disable are all
unchanged.

### Scope

`apps/api` only. No change to `model-gateway`, `model-evaluation`, the credential boundary, the provider
request, or any package API lock. No new dependency. No retry was added, and this amendment grants no
run: a live execution still requires a fresh single-use owner authorisation.

## Amendment — QFJ-S2-E-C-R3: `json_validate_failed` is an output failure

**Status:** accepted. Corrects the R1 amendment's characterisation of `client-rejected` and repairs one
Groq error mapping. Every other decision stands unchanged.

### The evidence

Two independent, correctly formed live SHADOW runs produced the same shape, confirmed from the Groq
dashboard:

| Run | Stable                    | Candidate                      | Groq error class       |
| --- | ------------------------- | ------------------------------ | ---------------------- |
| V2  | HTTP 200, 247 in / 48 out | HTTP 400, 247 in / **256 out** | `json_validate_failed` |
| V3  | HTTP 200, 247 in / 69 out | HTTP 400, 247 in / **256 out** | `json_validate_failed` |

The key, project, model permission and network path all work — the stable leg proves it. This was not a
401/403, not a 429, not a 5xx and not a transport failure. Both failed candidates stopped at exactly
`max_completion_tokens` (256).

### What the wire payload actually contains

Captured from the real adapter through a synthetic no-I/O transport:

```
response_format.type          json_schema
json_schema.name              qf_structured_output
json_schema.strict            true          <- already correct
json_schema.schema            { type: object, properties: { status: { type: string, const: ok } },
                                required: ["status"], additionalProperties: false }
max_completion_tokens         256
reasoning_effort              absent (provider default)
temperature / reasoning_format / include_reasoning   absent
stream false · n 1 · messages [system, user]
```

**Strict mode was never the defect.** `strict: true` is already on the wire, the schema is an object with
`additionalProperties: false`, and every property is required. There was nothing to enable.

### The blocker, stated rather than papered over

With `strict: true` and a valid schema, the remaining explanation for a `json_validate_failed` after
exactly `max_completion_tokens` output tokens is that generation was **truncated before the constrained
document closed**: `openai/gpt-oss-20b` is a reasoning model, its reasoning tokens count against
`max_completion_tokens`, and `reasoning_effort` is absent so the provider default applies. A truncated
prefix is not a valid document, and Groq rejects it with HTTP 400.

That the stable leg finished in 48 and 69 output tokens while the candidate hit the 256 ceiling twice on
**byte-identical** requests is exactly the variance a reasoning model produces. The budget is marginal,
not wrong.

**This amendment deliberately changes NO generation parameter.** `max_completion_tokens` stays 256 and
`reasoning_effort` stays absent. Raising a token limit or pinning reasoning effort is a separate decision
that needs its own evidence and its own authorisation; doing it here would be guessing with the owner's
tokens.

### The decision

One mapping repair, in the Groq adapter only.

A non-2xx response is now classified by `normalizeGroqHttpFailure(status, bodyText, latencyMs)`, which
consults the body for **exactly one closed literal** — `json_validate_failed` — and, on HTTP 400 with
that code, returns the existing provider-neutral `{ status: 'malformed', latencyMs }`. Everything else
delegates to `normalizeGroqHttpStatus` unchanged.

`malformed` already means "a response was served but its payload does not satisfy the contract", and it
already flows to `provider-output-invalid` / `output-invalid`. So the repair needs **no new status, no new
type, no new public field and no API change**.

| Candidate response                           | reason                    | candidateFailureClass |
| -------------------------------------------- | ------------------------- | --------------------- |
| HTTP 400 + `json_validate_failed`            | `provider-output-invalid` | `output-invalid`      |
| HTTP 400, any other or no code               | `provider-unavailable`    | `client-rejected`     |
| HTTP 401 / 403 / 404 / 408 / 409 / 413 / 422 | `provider-unavailable`    | `client-rejected`     |
| HTTP 429                                     | `rate-limited`            | `client-rejected`     |
| HTTP 498 / 5xx                               | `provider-unavailable`    | `server-unavailable`  |
| HTTP 499                                     | `cancelled`               | `transport-error`     |
| transport rejection                          | `provider-unavailable`    | `transport-error`     |
| HTTP 200, payload fails the schema           | `provider-output-invalid` | `output-invalid`      |

### Privacy

The body is read for one comparison against one literal. The message, `failed_generation`, `type`,
request id and every other field are never read, stored, logged or returned. The exact HTTP status, the
provider code string, the URL, the headers and the response body remain absent from the result line —
asserted with sentinels in both new suites.

### Correction to the R1 amendment

The R1 amendment described `client-rejected` as "a response was obtained and it **rejected the request**
(the 4xx family)", and the V3 runbook told the operator to stop and inspect the Groq project, key and
model permissions. **That guidance was over-confident**, and this evidence shows why: a `json_validate_failed`
400 is a rejection of the model's own _output_, not of the caller's credentials, and it was reaching that
class. It is now `output-invalid`.

Two residual conflations remain in `client-rejected`, and are recorded here rather than left implicit:
a genuine HTTP 4xx and an HTTP 200 whose `finish_reason` falls outside
`{ stop, length, complete, eos }` still produce the same class, because the adapter maps both to
`{ status: 'failed' }`. Separating those is a future slice.

### Scope

`packages/model-gateway` Groq adapter and tests, plus `apps/api` tests and this document. No change to
`model-evaluation`, `model-gateway-composition`, `event-backbone`, the credential boundary, the request
payload, the call budget, the `OFF → SHADOW → OFF` lifecycle or any package API lock. No retry, fallback
or refresh was added. This amendment grants no run.
