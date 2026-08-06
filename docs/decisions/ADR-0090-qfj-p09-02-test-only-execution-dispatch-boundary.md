# ADR-0090 — QFJ-P09.02 Test-Only Execution Dispatch Boundary (Core → n8n)

**Status:** Accepted — QFJ-P09.02. Test-only; no transport, no deployment, no live send.
**Deciders:** Owner
**Relates to:** [ADR-0020](./ADR-0020-signed-event-ingestion.md) · [ADR-0027](./ADR-0027-hardened-signature-verification.md) · [ADR-0083](./ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md) · [ADR-0084](./ADR-0084-qfj-p09-01-execution-intent-correlation-runtime.md)

## Context

The permanent boundary is: Jarvis recommends, **QuickFurno Core authorizes, n8n executes**, providers
deliver, results return to Core.

P09.01 answered a Jarvis-side question — _does this Core-issued intent faithfully name the approved
action?_ — with no clock and no state. The next question belongs to the other end of the wire:
_before n8n acts, did this exact intent really arrive from Core, intact, in time, and not already?_

Nothing in merged `main` answered it. There was no Core → n8n wire protocol, no execution-side
verifier, and no owner of replay state at the execution boundary.

## Decision

### 1. This is the B4 Core → n8n edge, and it is execution-side

`@qf-jarvis/execution-dispatch-runtime` models the validation an **n8n-side adapter** would run. It
is not a Jarvis outbound adapter, and the edge Jarvis → n8n still does not exist.

The package cannot create one: it has no transport, no endpoint, no URL, no webhook, no workflow id,
no HTTP client, no provider client and no credential. Containment tests assert each absence, and
nothing in the repository imports the package — it is a leaf with tests, deliberately.

### 2. The wire protocol is PROPOSED

Core does not sign dispatches this way yet, and the execution side does not verify them this way
yet. The boundary exists so it can be reviewed and attacked **before** either end is built. No
endpoint, header name or credential format is invented here, because inventing one would be
inventing an adoption that has not happened.

### 3. `ExecutionIntentV1` is the signed body, unchanged

The signed material is exactly one serialized `ExecutionIntentV1`. The contract is not modified and
there is no `ExecutionIntentV2`. In particular nothing was added to make dispatch convenient — no
phone number, email, provider credential, webhook URL, recipient contact, consent snapshot, retry
permission or local approval boolean. The governed-parameters schema already refuses all of them,
and a test proves a smuggled contact, credential or retry key fails contract validation.

There is exactly one schema. This package does not redefine, relax or "repair" an intent — a second
copy of a contract is how two systems come to disagree about what was authorised, and the
disagreement would surface as an effect nobody approved.

### 4. A distinct signature domain and a distinct key purpose

Ed25519, one algorithm, no negotiation.

The domain separator is `qf-execution-dispatch-v1` — **never** the event-ingestion
`qf-jarvis-event-v1`. Both boundaries use the same algorithm, so without separation a captured
Core → Jarvis event signature would verify as a Core → n8n execution dispatch: a system that merely
**observes** could be replayed into one that **acts**. A test signs under the event domain and
asserts the dispatch boundary refuses it.

Verification keys carry a purpose, `quickfurno-core-to-n8n-execution-dispatch`, and a registry record
declaring anything else is a CONSTRUCTION error — it throws when the registry is built, so an
operator wiring the wrong keys finds out immediately rather than at the first dispatch. There is
deliberately no lookup-time refusal reason for a wrong purpose, because such a key never enters the
registry and no dispatch can reach one. `@qf-jarvis/event-ingestion`'s `PublicKeyRegistry`
is **not** reused: importing it would have silently unified two trust purposes, and the fact that it
already works is exactly what makes that shortcut tempting.

The small hardened verifier is therefore **duplicated rather than extracted**. A shared crypto
framework would be the more elegant refactor and the worse risk: it would touch B1, and it would put
one edit between two domains that must never merge.

### 5. The signature commits to the exact bytes

```
"qf-execution-dispatch-v1" ‖ "\n" ‖ keyId ‖ "\n" ‖ signedAt ‖ "\n" ‖ hex(sha256(rawBody))
```

The digest is the **verifier's own**, enforced by a nominal type whose only constructor hashes real
bytes — the envelope's _claimed_ digest cannot be passed into the signing input at all, only
compared to it in constant time. There is no JSON canonicalisation and no reserialisation, so there
is no step where signer and verifier could disagree about whitespace or key order.

After the size check, the raw bytes are **detached** before hashing, parsing, body cryptography or
any `await` — step 1 reads `byteLength` only. The
boundary awaits an injected guard partway through, so without a detached snapshot a caller could
mutate a pooled buffer between the hash and the parse. A test mutates the caller's buffer from
inside the guard and proves the result is unchanged.

The envelope is treated as hostile: plain object only, exactly five keys, `Reflect.ownKeys` so symbol
and non-enumerable extras are caught, own **data** descriptors only so a getter is refused **without
being invoked**, and every reflective operation wrapped so a throwing `Proxy` normalises to a stable
refusal rather than escaping. No untrusted envelope can make the boundary throw, and no envelope
value is echoed in a reason.

### 6. Freshness and expiry are different questions

P09.01 had no clock. This is where execution-boundary "now" first matters, and `now` is **injected** —
the package never calls `Date.now`, and a test replaces `Date.now` with a thrower to prove it.

- **Signature freshness** asks whether the envelope was produced recently enough to be unlikely to
  be a captured replay. Default window ±2 minutes, bounded to [1 s, 15 min]. Tighter than event
  ingestion's five minutes on purpose: a stale _event_ is a late record, a stale _dispatch_ is an
  instruction that could still cause an effect.
- **Intent expiry** asks whether the authorization is still live. `now >= expiresAt` is expired, with
  **no grace period** — a grace period is an unreviewed extension of an authorization, and a
  mandatory expiry that is only approximately the last instant is not an expiry.

**Clock-skew tolerance applies to `signedAt` and to nothing else.** A test gives the signature a
generous 15-minute window and proves an expired intent is still refused: the boundary may not quietly
extend an authorization it does not own.

Two further orderings are enforced: `signedAt >= intent.issuedAt` (a dispatch signed before Core
issued the intent describes an impossible order of events) and `signedAt < intent.expiresAt` (a
signature must not outlive what it authorises). The schema already proved `issuedAt < expiresAt`.

### 7. Replay and idempotency: injected, atomic, and never optimistic

P09.01 could _observe_ an idempotency key without owning it. This is where ownership begins, and
ownership means atomicity: two concurrent dispatches of one intent must not both be told "first
seen". Only a store that can claim-or-report in a single step can promise that, and **this slice adds
no database and no migration**.

So the guard is an injected interface, **required**, with no default implementation. Neither
available default would be safe: an in-memory one would pass every test and lose its state on every
restart, and a permissive one would turn "unknown" into "first seen". A deterministic in-memory fake
lives under `src/tests/` and is excluded from the emitting build.

A claim binds all three of `executionIntentId`, `idempotencyKey` and the **verifier-computed** body
digest. Binding fewer leaves a way through: the same intent re-sent under a fresh key, one key reused
across intents, or the same id and key carrying different bytes.

The closed outcomes are `first-seen`, `exact-replay` and `conflict`. An exact replay is suppressed;
a conflict **fails closed**. A guard that throws yields `replay-guard-unavailable` — not "assume
first seen", because an unavailable replay store is exactly when a duplicate is most likely — and the
boundary does **not** retry, since a retry inside an already-authenticated boundary is how one
instruction becomes two effects.

**The guard is called only after signature, integrity, contract and temporal checks all pass.** A
forged or expired dispatch must never reserve an idempotency key, or an attacker could burn the key
of a legitimate dispatch that has not arrived yet. Two tests assert the guard was never called.

### 8. The result is an observation, not authority — and not a result

The return value is a deeply frozen `validated-dispatch-observation` carrying the parsed intent, the
verifying key id, `signedAt`, the computed digest, and a disposition of `first-seen` or
`exact-replay`.

**Exact-replay suppression is enforced by the TYPE.** The result is a discriminated union, and the
executable intent exists ONLY on the `first-seen` branch. The first draft carried `intent` on both
successful branches and relied on the caller reading `disposition` — which left one plausible line
able to undo the entire replay guard:

```ts
if (result.ok) {
  execute(result.intent); // an exact replay, executed a second time
}
```

That no longer compiles. A consumer must narrow on `disposition === 'first-seen'` before it can
reach an intent at all, and the exact-replay branch carries only `executionIntentId` for
correlation. It is deliberately not solved with an optional `intent?`, an `intent: undefined`, or a
helper that hands the intent back: each keeps the property reachable and moves the check to run
time, which is exactly what failed. An exact replay remains `ok: true` — it was authenticated,
intact and in time — because conflating it with a refusal would lose the difference between "we
already did this" and "something is wrong".

There is no `canExecute`, `canSend`, `isAuthorized`, `consentValid`, `communicationAllowed`,
`retryAllowed`, `sent`, `delivered`, `executed` or `success` — not because a rule forbids them, but
because **none of them would be true**. A `first-seen` observation does not mean a provider effect
happened, and it is **not** an `ExecutionResultV1`: execution truth is recorded by Core after a real
execution returns, and a validation boundary that minted results would be inventing outcomes it
never witnessed.

**Communication eligibility remains elsewhere.** A prior human approval is not execution-time
consent, and `CommunicationAuthorizationV1` is not a future permission slip. Opt-out, DNC, quiet
hours and attempt limits are revalidated at execution time by Core and the QF Communications
Runtime. This package does not implement, cache or infer any of that — which is why no consent-shaped
field exists here to be mistaken for one.

No approval evidence crosses this boundary at all. The package does not depend on
`approval-runtime`, `communication-authorization-runtime` or `execution-intent-runtime`: B4 trusts
Core's authenticated dispatch, not a Jarvis-supplied approval proof.

### 9. The bridge is a test fixture that counts

A deterministic, test-only bridge proves the property the verifier alone cannot express: a validated
dispatch is handed to execution **at most once**. First-seen hands off exactly once; an exact replay
hands off zero more times; every refusal hands off zero times.

It is called `handoffs`, never `sent`, `delivered` or `executed` — nothing here reaches a provider,
and a test name is the first thing someone reads when deciding what a system does. There is
deliberately **no production export** that takes an observation and calls a transport; that belongs
to a later, separately authorized slice.

## Consequences

- No database, no migration. The set remains `0001`–`0009`; there is no `0010`.
- No Core connection, no n8n connection, no Meta, WhatsApp or provider connection, no credential.
- `apps/api` PRODUCTION/runtime code is unchanged and still exports nothing. Three of its
  governance/containment specs were updated to record this package: the two package-API locks,
  and the roadmap-status check whose wording had P09.02 as the NEXT slice rather than the
  current one.
- Production rollout remains **OFF**, and live send remains **OFF**.

## What this does NOT implement

Real adopted Core → n8n transport and composition · a durable production replay/idempotency store ·
execution-time communications eligibility · the 18-state communication lifecycle runtime · provider
dispatch, results and reconciliation · production rollout.

## Change-control rule

Adopting this protocol requires Core and the execution side to agree the envelope, the domain
separator and the key purpose. Reusing the event-ingestion domain or key registry for execution
dispatch, exporting a transport, weakening the expiry rule, or shipping a default replay guard each
require a superseding ADR.
