# ADR-0147 — JF-2B: evidence-gated Production V1 gateway activation and Groq-to-Nara failover

- **Status:** Accepted — makes `ACTIVE` reachable in CODE, under an evidence gate. **This is not a
  deployment, not a live certification, and not a running service.** No provider is contacted, no
  credential exists in the repository, no migration is added.
- **Date:** 2026-09-10
- **Baseline:** `origin/main` at `bf04837f9f106b1f17f880c3cbb57033f012fc25` (PR #197, JF-2A).
  Migrations `0001`–`0013`. **JF-2B adds none.**
- **Governed by:** ADR-0145 (JF-1 Production V1 scope freeze), ADR-0146 (JF-2A Nara provider and
  provider modes)
- **Depends on:** ADR-0045/0048 (selection, hybrid routing, bounded failover, circuit breaker),
  ADR-0049 (provider rollout controller — deliberately NOT used here), ADR-0050 (capability registry),
  ADR-0052 (evaluation and approval evidence), ADR-0062/0063 (production composition and the evidence
  registry this ADR finally connects)
- **Supersedes:** the S2-B `mode-not-off` refusal only. Everything else in ADR-0062/0063 stands.

## Context

ADR-0062 built a production composition that was structurally incapable of serving: `mode` had to be
`OFF`, fallback had to be `false`, the retry budget had to be `0`, and `activatable` was hard-coded
`false` with no method that could change it. ADR-0063 then built an evaluation-evidence registry and a
verifier, registered evidence into it, and deliberately left the verifier **unreachable** — so a later
authorized slice would inherit a closed gate rather than an open one.

This is that slice. It connects two things that already existed and were never joined.

### The failure this ADR is written against

The obvious way to "turn production on" is to hand the composition a `ProviderRolloutController`,
because the gateway already accepts one and its `SHADOW`/`CANARY`/`ACTIVE` ladder reads like a safe
rollout. That would have been a serious mistake, and repository inspection is what caught it:

**A rollout controller takes PRECEDENCE over `routingProfile`.** The controller governs a
stable/candidate **release** pair — which version of a model answers. `ProviderMode` governs which
**vendor** answers. Supplying a controller to obtain the rollout labels would silently disable provider
selection: the rollout would be choosing a release while the provider mode believed it was choosing
Groq or Nara, and the Groq→Nara failover this whole lane exists to build would never run.

They are two axes. This ADR keeps them apart.

## Decision

### 1. Two modes, and only two

The production hybrid composition admits **`OFF`** and **`ACTIVE`**.

`SHADOW`, `CANARY` and `FALLBACK` are refused with `mode-not-supported`. They remain entirely valid in
the existing release-rollout machinery and in the diagnostic and evaluation paths; this composition
simply never repurposes them, and **no rollout controller is ever constructed or passed**.

Real traffic rollout still happens safely — through JF-5 (real-provider certification), JF-6 (deployed
runtime), QH-2 (owner pilot) and QH-3 (controlled activation). Rollout is not a gateway enum.

### 2. Fail-closed by default

`OFF` is unchanged: it serves nothing, invokes no provider, needs no health call, reads no credential,
enables no fallback and pins the retry budget to zero.

`ACTIVE` serves only when all of the following hold, each decided at CONSTRUCTION from injected
declarations, before `createModelGateway` is called and without touching any provider:

1. a provider mode is **named** — there is no default, because defaulting an omission to `AUTO` would
   turn a missing line of configuration into "use both vendors";
2. the roster is **exactly** that mode's canonical providers — not a superset, no duplicate identity,
   no scoped diagnostic adapter, no unrelated local provider;
3. **every** provider that could return customer-facing output carries its own exact
   `ACTIVE_MODEL_RELEASE` production approval.

Nothing is silently downgraded to `OFF` or upgraded to `ACTIVE`.

### 3. Same-provider retry stays at zero

`retryBudget` remains `0` and `retry-budget-not-zero` is **not** lifted. The V1 reliability strategy is
one primary attempt, then at most one attempt against a **different** provider. Never
`Groq → Groq → Groq → Nara`.

Maximum provider invocations: **`AUTO` 2, `GROQ_ONLY` 1, `NARA_ONLY` 1.**

### 4. Fallback is derived from the provider mode, never asserted by a caller

`AUTO` enables the single bounded fallback; `GROQ_ONLY` and `NARA_ONLY` disable it. A legacy
caller-supplied `allowFallback` may **agree** with the derived value and may never contradict it —
`GROQ_ONLY` with `allowFallback: true` is an operator asking for one provider and two at once, and it
is refused. For `OFF` the only agreeable value remains `false`.

### 5. Cross-provider failover conditions

`AUTO` attempts Nara exactly once when Groq cannot serve for an approved transient condition:
`provider-unavailable` (retryable), `timeout`, an already-open Groq circuit, and — newly —
`rate-limited`.

**The rate-limit distinction, which is the one genuinely new piece of policy.** A quota refusal is:

- **non-retryable on the SAME provider** — the gateway has no backoff, so an immediate second attempt
  deepens the limit rather than clearing it. `runProvider` still stops at one Groq call and still
  reports `retryable: false`. That is unchanged;
- **eligible for exactly one CROSS-PROVIDER attempt** — it is the clearest possible signal that a
  different vendor should answer, because the request was well-formed, the credential was good and the
  model was entitled.

Those are two different questions about one code, and reading a single `retryable` flag for both is
what made a quota refusal look terminal to the whole gateway. `decideFallover` now admits
`rate-limited` **without** consulting that flag, and only that code is treated this way. A policy that
does not want the behaviour drops the code from `transientFailureCodes`.

No fallback for: cancellation, `HUMAN_ONLY`, `LOCAL_ONLY` to a hosted provider, malformed output,
structured-output-invalid, invalid request, auth/config failure, an unentitled or unknown model,
budget exhaustion, no eligible fallback, a disabled fallback, or a single-provider mode. No provider
error text is ever parsed — normalized codes only.

### 6. The circuit breaker is reused unchanged

No file in `reliability/` was modified. Healthy Groq answers alone. A transient Groq failure yields one
Groq call and one Nara call. While the circuit is open Groq is not invoked at all. After cooldown the
existing half-open trial restores Groq as primary on success, and reopens on failure with the bounded
Nara fallback still available. No background polling, daemon or timer loop was added.

**Provenance when the circuit is open, stated precisely because it differs from the JF-2B brief's
expectation.** The brief anticipated `usedFallback: true`. The gateway reports `usedFallback: false`
with `attempts: 1`, and that is the truthful reading: an open circuit excludes Groq during **planning**,
so Nara was that request's **primary**. There was no primary attempt to fall back from. Reporting
`true` would imply a Groq invocation that never happened — precisely what the brief also required must
not be invented. The measurement is pinned by spec; the existing gateway was not changed to make the
label prettier.

### 7. Production evidence, reusing the registry that already existed

No second evaluation framework was built. `ACTIVE` calls the EXISTING verifier from ADR-0063 with
`mode: 'ACTIVE'`, once per serving provider. Each approval is a **claim** carrying an `evaluationRef`,
a claimed `evidenceDigest`, the approval target, the exact release and the capability profile ref. The
digest is **recomputed** from registered evidence and never believed.

Required for every serving provider: target `ACTIVE_MODEL_RELEASE`, `synthetic: false`,
`productionApproval: true`, exact release identity (no wildcard, no `latest`, no router alias), and a
matching capability profile.

- `GROQ_ONLY` needs Groq's approval.
- `NARA_ONLY` needs Nara's approval.
- **`AUTO` needs BOTH.** Nara is the fallback, and a fallback answer is still an answer a customer
  reads — connectivity or shadow-eligibility evidence is insufficient for either provider.

**Until Nara has production evidence, `AUTO` cannot activate.** `GROQ_ONLY` can, if Groq alone
satisfies the gate. That is the intended migration path.

### 8. Who approves activation

Evaluation runners **produce** evidence. Jarvis, Mastra and the models **never** approve themselves —
there is no self-promotion path, and registering evidence activates nothing on its own.

A **human owner or explicitly authorized operator approves production activation**, and the trusted
deployment/composition boundary supplies the approved evidence and the approval claims.

**There is no cryptographic signer identity in this repository, and this ADR claims none.** No
signature is verified, because none exists to verify. What exists is a trusted composition boundary: a
process that can construct the composition is trusted to have been configured by someone authorized.
**JF-6 must wire authenticated operator controls and an audit trail before production operations are
complete.** Recording that honestly is the point; a fabricated attestation would be worse than an
acknowledged gap.

### 9. The provider-mode switch

`ProviderMode` is part of the production composition configuration, which gives V1 a manual switch
between `AUTO`, `GROQ_ONLY` and `NARA_ONLY`. Changing it means recomposing through trusted
configuration — a controlled restart, not a live toggle, and no mutable global state was added. It
requires no change to QuickFurno, Riya or Mastra. JF-6 wires the final operator controls and audit.

### 10. Nara strict-schema support stays `false`

Unchanged from ADR-0146, and not raised without authenticated certification. A request that genuinely
requires strict JSON Schema will not select Nara — capability matching excludes it. That is a real
consequence: under `AUTO`, a strict-schema request has **no** fallback, and it fails rather than
pretending one exists. JF-5 decides whether live evidence permits raising the capability.

## Consequences

Positive: the activation decision is now a decision with a name, an owner and a gate, rather than a
line of configuration; the Groq→Nara reliability story is real and measured end to end; a quota refusal
is finally absorbed by the second provider instead of failing the turn.

Negative, and accepted:

- **No cryptographic approval identity.** Activation authority rests on the trusted composition
  boundary until JF-6.
- **Nara cannot serve strict-schema requests**, so `AUTO` has no fallback for that request class.
- **`AUTO` is unreachable until Nara has production evidence**, which requires a live certification run
  that has not happened.
- The `mode-not-off` refusal code is gone. It stopped being true when `ACTIVE` became reachable, and a
  refusal code that lies is worse than a renamed one.

## What this ADR does not do

No deployment. No server binding. No live provider call and no credential in the repository. No RAG. No
Riya behaviour change. No Mastra on the customer path. No rollout-controller change and no shadow-runner
change. No migration. No QuickFurno, no OneDecore. No training.

## Next

**JF-3** — RAG production closeout.
