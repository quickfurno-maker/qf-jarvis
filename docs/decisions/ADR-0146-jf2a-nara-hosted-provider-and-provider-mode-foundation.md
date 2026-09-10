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
