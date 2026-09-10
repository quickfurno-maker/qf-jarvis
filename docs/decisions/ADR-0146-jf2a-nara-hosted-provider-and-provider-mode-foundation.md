# ADR-0146 — JF-2A: NaraRouter hosted provider and the V1 provider-mode foundation

- **Status:** Accepted — adds a provider and a selection surface. **Activates nothing.** No provider is
  contacted, no composition becomes activatable, no fallback is enabled, no retry budget changes, no
  credential exists in the repository.
- **Date:** 2026-09-10
- **Baseline:** `origin/main` at `d31a1b111634415678227d7ed2b6f4f29f21ee7a` (PR #196, JF-1). Migrations
  `0001`–`0013`. **JF-2A adds none.**
- **Governed by:** ADR-0145 (JF-1 Production V1 scope freeze)
- **Depends on:** ADR-0045 (provider-neutral `ModelProvider` and deterministic selection), ADR-0046
  (the Groq hosted adapter this one mirrors), ADR-0047 (the local provider, deliberately NOT reused),
  ADR-0048 (hybrid routing, bounded failover, circuit breaker), ADR-0062/0063 (the OFF-only production
  composition)
- **Supersedes:** nothing.

## Context

ADR-0145 fixed Production V1 as Groq primary with a NaraRouter fallback under an
`AUTO` / `GROQ_ONLY` / `NARA_ONLY` provider mode, and recorded that none of it existed yet. Two things
were missing: a Nara provider, and a way to say which provider a request may use.

Almost nothing else was missing. The gateway already owns deterministic provider selection, a validated
hybrid routing policy, a bounded single fallback, an attempt ledger and a circuit breaker. JF-2A is
therefore deliberately boring: one adapter, one closed enum, one mapping, and tests. **No second router
was built, and no existing routing file was modified.**

### The failure this ADR is written against

The tempting shortcut was to reuse the existing local OpenAI-compatible adapter — Nara speaks the same
wire format, so it looks like a configuration change. It is not. That adapter is bound to `LOCAL`
execution-class semantics, and `LOCAL_ONLY` privacy is enforced against the execution class in three
separate places (`selectProviders`, `buildRoutingPlan`, `decideFallover`). Pointing it at a remote host
would make a hosted service satisfy a local-only data class, which is a privacy bypass wearing a
configuration field. So Nara is its own `HOSTED` adapter, and its config refuses any other execution
class at construction.

## Decision

### 1. NaraRouter is a HOSTED provider of its own

`packages/model-gateway/src/providers/nara/` implements the existing `ModelProvider` contract:
`providerId: 'nara'`, `executionClass: 'HOSTED'`, one bounded non-streaming Chat Completions call per
`invoke`, through an injected transport, honouring the `AbortSignal`, never retrying and never sleeping.
It holds no business, execution or tool authority, reaches no n8n and touches no database — the contract
has no method that could.

Everything is injected: model identity, capabilities, token bounds, key holder, transport, and a
data-controls attestation. There is no hard-coded model, no environment access, and `health()` fails
closed unless the attestation is positive.

### 2. The endpoint is a constant, not a setting

The transport names one URL — `https://router.bynara.id/v1/chat/completions` — and throws on anything
else. There is no `baseUrl` option anywhere in the module. A hosted provider whose destination is a
caller-supplied string is an SSRF primitive with a model-shaped interface, and the guarantee that this
adapter can only reach NaraRouter comes from the code naming one constant rather than from whoever
calls it. `redirect: 'error'`, a bounded read, no retry. The Groq transport makes the same trade for the
same reason, and this is now the third designated egress point in the package — an authorised addition
to that containment rule, not a relaxation of it.

### 3. No automatic Nara model router

NaraRouter offers `auto`, `bynara` and `auto/bynara`, which let the provider choose a model per request.
Production V1 refuses them at construction: a configuration naming one cannot be built. Evidence that
says "the router picked something" cannot answer which model produced a reply, so a regression cannot be
attributed and a rollback has nothing to return to. The named aliases are refused individually and a
structural rule catches alias SHAPES the list does not enumerate (`auto/*`, `*/latest`, `any`).

The exact production model is **not** chosen here. No authenticated Nara call has ever been made from
this repository, so entitlement is unknown; the specs use a deterministic fake model id, and a later
certification lane locks the real one.

### 4. Nara declares no strict JSON-Schema support

Deliberately, and it is not a caller's choice. Strict mode is not one behaviour: the Groq adapter needed
a 437-line projection table because a schema that looked strict-compatible collected nine identical
HTTP 400s on live traffic. Nara's strict behaviour has not been observed from here. Declaring the
capability would let capability matching route strict requests to a provider that may reject them —
turning an unverified assumption into production failures. Structured requests go out as `json_object`,
and the gateway keeps validating the returned value against the real schema, which it does regardless.
A certification lane with a live entitled model can raise this.

### 5. Provider mode is a SELECTION axis, separate from activation

`ProviderMode` is the closed union `AUTO | GROQ_ONLY | NARA_ONLY`, validated, with no default on
unknown input — a silent fall back to `AUTO` would read an operator's typo as "use both providers",
which is the one outcome someone asking for `GROQ_ONLY` was preventing.

It maps deterministically onto the EXISTING policy:

| Mode        | hosted order       | fallback permitted           |
| ----------- | ------------------ | ---------------------------- |
| `AUTO`      | `['groq', 'nara']` | yes — the single bounded one |
| `GROQ_ONLY` | `['groq']`         | no                           |
| `NARA_ONLY` | `['nara']`         | no                           |

`buildRoutingPlan` then does the work it already did: rank by execution class, then by configured order,
take `ranked[0]` as primary and `ranked[1]` as the one fallback. "Groq first, Nara second" needs nothing
beyond the order.

**This is not `GatewayMode`.** `OFF`/`SHADOW`/`CANARY`/`ACTIVE`/`FALLBACK` is the ACTIVATION axis:
whether the gateway serves at all. `ProviderMode` is which vendor answers, given that it does. Collapsing
them would make "run Nara only" and "turn production on" the same decision, and turning production on is
exactly what JF-2B exists to decide separately. A spec asserts no value of either axis is a value of the
other.

A mode can only NARROW. It cannot override a data class (`LOCAL_ONLY` still reaches only LOCAL
providers, enforced before policy membership is consulted), cannot serve `HUMAN_ONLY`, cannot conjure an
absent, unhealthy or circuit-open provider, and cannot enable fallback in a composition that refuses it.
Those hold because the module only ever produces an ordered list of provider ids.

`fallbackPermittedForProviderMode` returns `false` for the single-provider modes. Belt-and-braces — the
hosted order already holds one id — but it also stops a LOCAL provider in the roster from silently
becoming `ranked[1]`. An operator who asked for `GROQ_ONLY` asked for one provider, not for "Groq, or
whatever else is eligible".

### 5b. Provider-adapter identity is pinned — owner-review hardening

Owner review of the first JF-2A head found a spoofing surface this ADR had created and not closed.
`providerId` was an injected string that only had to satisfy an identifier grammar, and the adapter
published it into `descriptor.providerId` and into its capabilities. Once the modes above began
treating `groq` and `nara` as SEMANTIC identities, that became exploitable in both directions:

- a Nara adapter configured `providerId: 'groq'` would satisfy `GROQ_ONLY`, and would rank **first**
  under `AUTO`, while sending every request to NaraRouter;
- a Groq adapter configured `providerId: 'nara'` would satisfy `NARA_ONLY` while sending every request
  to Groq.

Provider mode, routing order, fallback evidence, provenance and an operator's expectations all rest on
the provider id being TRUE, so **both directions are closed** — at two different strengths, because
the two adapters are not in the same situation:

> **The Nara adapter refuses any provider identity other than `nara`.** An exact equality test, with
> no normalization and no near-match: `groq`, `Nara`, `nara-typo` and `nara ` are all refused.
>
> **The Groq adapter refuses any FOREIGN canonical identity.** It may never publish `nara`. It may
> still carry a scoped `groq.*` id.

#### Why Groq is not pinned exactly, measured rather than assumed

The exact pin was implemented first and it broke a merged feature. The controlled SHADOW runner
(`apps/api/src/shadow/create-controlled-shadow-runner.ts`) composes **two** Groq providers into **one**
gateway roster — `providers: [stableObserved.provider, candidateObserved.provider]` — passing
`release.providerId`, which is `groq.shadow.stable` for one leg and `groq.shadow.candidate` for the
other. The roster's health map, circuit breaker and routing plan are all keyed by `providerId`.
Collapsing both legs to `groq` makes them indistinguishable, and the run returns `internal-invariant`
instead of performing the comparison — observed, not predicted: 63 tests across 10 files failed, and
`shadow-json-validate-failed` reported `expected 'internal-invariant' to be 'provider-output-invalid'`.

That A/B path predates this hardening and is not what the hardening is about.

**The weaker rule still closes the spoof completely**, which is the property the modes depend on:

- a Groq adapter can never publish `nara`, so `NARA_ONLY` can never be satisfied by Groq;
- `GROQ_ONLY` and `NARA_ONLY` map to the hosted orders `['groq']` and `['nara']`, so a provider
  carrying `groq.shadow.candidate` is `not-in-policy` for **every** provider mode and can satisfy none
  of them — asserted directly.

What the rule permits is a scoped Groq id in a composition that does not use provider modes at all —
the shadow runner references `ProviderMode` zero times. What it forbids is the one thing that would
make a mode lie.

**Residual gap, stated rather than glossed:** a Groq-side typo such as `groq-typo` is still
constructible, though it can satisfy no provider mode. Closing that too requires giving the shadow
runner a leg discriminator other than `providerId` — a change to a merged A/B path, and an owner
decision rather than a JF-2A one.

The canonical ids live in `contracts/provider-identity.ts`, which imports nothing, and the routing
layer's `GROQ_PROVIDER_ID` / `NARA_PROVIDER_ID` re-export them. One constant, so the string the policy
reasons about and the string the adapter must publish cannot drift apart. A provider never imports
routing, so the dependency direction is unchanged.

**This is not a closed enum of every possible provider.** The gateway stays provider-neutral,
`ModelProvider`, `ProviderDescriptor` and the identifier grammar are untouched, and a future provider
brings its own adapter and its own constant. What is constrained is narrower: an adapter written
against one vendor's API may never publish a different vendor's canonical identity.

ADR-0046 is not rewritten; this is recorded here as a JF-2A hardening. No existing Groq fixture or
`./testing` helper changed — the exact-pin attempt required four such edits, and reverting to the
foreign-identity rule made all four unnecessary.

### 6. Observability needed no new contract

`ModelUsage` already carries input/output/total tokens, `ProviderInvocationResult` carries `latencyMs`,
and the observability event already carries provider id, latency, attempts, circuit state, profile, data
class and fallback reason. The adapter populates them; nothing was widened.

Absent token counts stay **absent**, never zero — a fabricated zero reads as a free request in later
accounting. `cost` is never populated: this repository has no versioned pricing registry, so the honest
output is the token facts, and money is computed later by something that owns a price.

### 7. Production stays OFF

`ProductionCompositionConfig` still refuses a non-`OFF` mode, still refuses `allowFallback: true`, still
refuses a non-zero retry budget, and still reports `activatable: false`. JF-2A did not touch that file,
knows nothing about Nara, and has no `ProviderMode` in it — asserted by spec. **JF-2B is the only lane
that lifts any of it.**

## Consequences

Positive: the V1 provider architecture now exists as code rather than a diagram; the mode surface is
expressible and tested against the real routing plan; the single-fallback, circuit-breaker and
data-class guarantees are unchanged and now proved to hold with two hosted providers.

Negative, and accepted: the exact Nara model and its strict-schema behaviour remain unknown until an
authenticated call is made, so a certification step stands between this and serving; and `ProviderMode`
has no runtime configuration surface yet — JF-2B/JF-6 wire it to whatever control plane they choose.

## What this ADR does not do

No provider contacted. No credential in the repository. No activation, no fallback enablement, no retry
budget change. No routing file modified. No RAG. No Riya behaviour change. No Mastra on the customer
path. No ingress change, no server binding, no deployment. No managed-database access and no migration.
No QuickFurno, no OneDecore. No training, and no dataset touched.

## Next

**JF-2B** — the owner-authorized production gateway activation and fallback-enablement slice.
