# ADR-0097 — Private Riya Web Ingress Adapter

> **RWC-P8 factual note (ADR-0104).** The `(caller, requestId)` replay guard described here is
> unchanged and remains defence in depth. It protects ONE signed transport request inside its
> freshness window and is process-local; a trusted caller may re-sign the same LOGICAL message
> under a fresh `requestId`. RWC-P8 adds a durable logical-turn layer beneath it. The ingress
> production code is untouched and remains **NOT DEPLOYED / NOT LIVE**.

**Status:** Accepted. Implemented on `rwc-private-riya-web-ingress-adapter`, **not merged**, and **not deployed** — nothing binds it to a port.
**Deciders:** Owner
**Relates to:** [ADR-0096](./ADR-0096-rwc-p2d-core-authorized-web-reply-materialization.md) · [ADR-0094](./ADR-0094-rwc-p2c-private-riya-web-conversation-service.md) · [ADR-0092](./ADR-0092-jrw-0b-governed-web-runtime-channel.md) · [ADR-0056](./ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) · [ADR-0025](./ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) · [ADR-0001](./ADR-0001-source-of-truth-boundary.md)

**Baseline.** RWC-P2D merged as PR #101 — reviewed head `792a60e4dc9dc341094f9749a628df4d6cf91c43`, merge commit `adf032522c4e25791bd5a2c1a9ea026908b73d3c`. Migrations `0001`–`0011`, `0011` SHA-256 `80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93`, no `0012`. Core decision protocol `qfj.core.decision` v2 / `c0de0002`.

**This slice is deliberately UNNUMBERED.** It is not RWC-P2E, and it renumbers nothing.

## Context

RWC-P2C built a private conversation service. RWC-P2D gave it a way to return the exact body
QuickFurno Core authorized. Neither can be reached: nothing in the repository accepts a request from
outside the process.

ADR-0094 also left a rule for whoever built that ingress, and it is the reason this is a separate
slice rather than a route bolted onto P2C: **`RuntimeDataClass` must be derived under governed
server-side policy, and a browser attempt to choose it must never be forwarded.**

## Decision

### 1. The topology, and the one rule inside it

Browser → QuickFurno **server** → this ingress → `RiyaWebConversationService` → `JarvisRuntime` → the
existing Core-decision boundary → authorized reply materialization → response to the QuickFurno
server.

**The browser never calls Jarvis directly.** This endpoint is private and server-to-server.

And: **authenticating the QuickFurno server is not business authorization.** A valid signature proves
only that a request came through the configured private trust boundary. It does not authorize a
reply, a lead, a consent state, a vendor action or a delivery. Whether client-facing text may exist
is still decided by the existing M2/M3 chain and reaches this layer only as `authorizedReply`.

### 2. It lives in `apps/api`, not a new package

`apps/api/src/private-riya-web-ingress/`. HTTP and `node:crypto` are process- and trust-boundary
concerns; the workspace packages stay environment-, filesystem- and network-neutral. One private
route does not justify another package, and QuickFurno is a separate repository so nothing here is
shared source.

Only two workspace dependencies were added: `@qf-jarvis/riya-web-conversation-service` (the one thing
it calls) and `@qf-jarvis/agent-runtime` (needed for the `RUNTIME_DATA_CLASSES` vocabulary the policy
output is validated against). No web framework.

### 3. It builds a listener. It never starts one.

`createPrivateRiyaWebIngressHandler(config): http.RequestListener`.

Production source calls no `listen`, creates no server, reads no `process.env`, and knows no port or
host. Importing the package root — or the ingress module — starts nothing and opens no socket.
**The ingress is not deployed and not live.** A later, separately reviewed deployment slice decides
whether it is ever bound and to which private interface. A module that activated itself on import
would make "is this reachable?" a question about the import graph rather than about a decision
somebody made.

`apps/api`'s root runtime exports remain **zero**.

### 4. One fixed route

`POST /internal/v1/riya/web-turn`. No wildcard, no dynamic segment, no `/api/chat`, no `/webhook`.
Wrong path → `404`. Wrong method → `405` with `Allow: POST`. **No `OPTIONS`** — there is no preflight
because there is no browser caller. A query string is refused: it is unsigned input, and the
signature binds the path exactly.

### 5. The wire request has no `dataClass`

The strict V1 request carries protocol/version/caller/audience, `requestId`, `issuedAt`, the tenant/
conversation/message identity, `receivedAt`, an opaque `webTurnRef`, and optionally `subjectRef` and
`normalizedText`.

There is **no `dataClass` field**, and no `channel`, `partyType`, `direction`, actor, `runtimeId`,
model, prompt, tools, consent, suppression, `canSubmit`, lead, vendor, city, package, price, approval
flag or delivery status. The schema is `.strict()`, so any of them is a **refusal**, not a silently
stripped field. An optional-but-ignored `dataClass` would be worse than none: somebody would send it,
nothing would complain, and the next reader would assume it mattered.

### 6. Classification is a required, synchronous, server-side policy

`RiyaWebIngressDataClassPolicy.classify(...)` is injected, **required, and has no default anywhere**.
A default would be a guess about someone's data made by whoever wired the ingress and forgot: a
permissive one routes material to a hosted model that should never have gone there; a restrictive one
looks like a bug whose first attempted fix is to loosen it.

It is **synchronous** on purpose. A `Promise`-returning classifier invites the one implementation this
boundary must not have — asking a model or a network service what class a person's words are, which
decides whether content may leave a boundary by first letting it leave.

It sees only signed fields, only after authentication, and its output is validated against
`RUNTIME_DATA_CLASSES`. An invalid answer or a throw is `policy-refused` **before** the service is
called. The derived class is the only `dataClass` that reaches the turn.

### 7. Ed25519, and Jarvis holds no signing material

QuickFurno Core holds the **private** key; Jarvis holds only **public** verification keys.

That asymmetry is the design. With a shared HMAC secret, anything able to verify a QuickFurno request
is also able to forge one — so a compromise of this repository, one deployment of it, a log line or a
backup would hand an attacker the ability to impersonate the business authority. Jarvis is
deliberately **incapable** of producing a signature it would accept. No browser bearer token, cookie,
session token, body API key, Basic Auth, or IP allowlist as sole proof. `node:crypto` only.

The key ring is 1–4 keys with bounded ids, validated at **construction**: empty, oversized,
duplicated, malformed or non-Ed25519 rings refuse to build. A PEM whose label says `PRIVATE KEY` is
rejected outright — `createPublicKey` will happily derive the public half from a private key and
report `type: 'public'`, so the label is the only place that distinction survives. No JWKS, no network
key fetch, no filesystem or environment read. An unknown key id is an authentication failure.

Headers: `x-qfj-key-id`, `x-qfj-signature` (base64url). Every failure — missing, duplicated,
malformed, unknown key, bad signature, stale or future `issuedAt` — returns the **same**
`authentication-failed`. Differentiating them helps only somebody who does not hold the key.

### 8. What the signature binds

Nine LF-delimited lines, no trailing newline, no trimming, no JSON re-serialization:

```
qfj.riya.web.ingress.sig.v1
POST
/internal/v1/riya/web-turn
quickfurno-core
qf-jarvis-private-riya-web
<requestId>
<issuedAt>
<keyId>
<base64url(sha256(raw body bytes))>
```

The body is bound as a digest of its **raw bytes**, so one byte changed after signing fails even
though the result is still valid JSON that still passes the schema. Method, path, caller and audience
are bound too: a signature captured for this route cannot be replayed against another, and one issued
for a different audience is not valid here at all.

### 9. Freshness: ±60 seconds

`issuedAt` is signed and checked against an injected clock, symmetrically — a clock skewed forward
extends a signature's usable life as surely as a stale one replays it. `receivedAt` is the signed
turn-received time and stays distinct: a gateway may batch, queue or re-sign, and collapsing the two
would let transport timing rewrite conversation timing.

### 10. A bounded, process-local, content-free replay guard that never fails open

`(caller, requestId)` is claimed once per window, **after** the signature verifies — claiming earlier
would let an unauthenticated caller burn identifiers a real gateway intends to use — and **before**
the policy or the service, so a refused claim costs neither a classification nor an agent turn.

Same id + same body → `replay-detected`. Same id + **different** body → `request-conflict`, named
separately because retrying will not fix it. Either way the service is not called again.

An entry holds a key token, a raw-body digest and an expiry instant. It never holds `normalizedText`,
a reply body, an `authorizedReply`, continuity, the request JSON or the response JSON. Expiry is
lazy — no timer, no polling.

Three rules make "never fails open" a property rather than an intention.

**Retention outlives signature validity: minimum 120,000 ms, and the boundary is INCLUSIVE.**
Authentication accepts `|now - issuedAt| <= 60_000`, so a request first received at `T` may legally
carry `issuedAt = T + 60_000` **exactly** — and those same bytes are still accepted at **exactly**
`T + 120_000`. A claim retained for less than that would expire while the very signature it guards
was still usable: a replay window wearing the costume of a cache setting. 120,000 ms is therefore
both the default and the **floor**, and a shorter configured value is **refused at construction,
never silently clamped**. A deployment that asked for 30 seconds has made an assumption about
signature lifetime that is wrong, and substituting a different number would leave that assumption in
place everywhere else somebody made it. The ±60s authentication window is unchanged.

Because freshness is inclusive, liveness must be too. **A claim is live while `expiresAtMs >= nowMs`,
and the lazy sweep deletes only `expiresAtMs < nowMs`** — so the claim stays protective _through_ its
expiry instant and becomes expired only after that instant has passed. A strict comparison left a
one-millisecond hole at precisely the endpoint the two windows share, which is the single instant an
attacker replaying a maximally future-skewed signature would aim at. The constant was **not** inflated
to hide the edge; the comparison was aligned to it.

**Capacity saturation fails closed, and a live claim is never evicted.** Expired entries are swept
lazily first. If the map is still full of _unexpired_ claims, the request is **refused** with
`replay-guard-unavailable` (503) — its own code, never reported as `replay-detected` or
`request-conflict`, because a full guard and a repeated request are different facts and an operator
needs to tell them apart. Evicting the oldest live claim would trade replay protection for
availability under exactly the load an attacker can manufacture, and the evicted identifier would
become claimable again inside its own valid window. **Availability pressure never weakens replay
protection.**

**One clock sample per request, canonical, and no substituted instant.** The handler reads the
injected clock **once** and uses that same instant for signature freshness and for the claim; two
reads could straddle the boundary of the window they jointly define.

That snapshot must satisfy the **same canonical UTC grammar** as every signed instant crossing this
boundary — `YYYY-MM-DDTHH:mm:ss(.SSS)?Z`, 1–3 fractional digits when present — and must round-trip to
a real calendar time. Parseability is a weaker property: `Date.parse` accepts `2026-08-07` and
`2026-08-07T09:00:00+00:00`, and it silently _rolls over_ `2026-02-31T09:00:00Z` to March 3, so a
misconfigured clock would not fail — it would quietly report a different instant, and every window
measured against it would be measured against a lie. A clock held to a looser standard than the
requests it judges is the one input nobody checked. It is **refused, never normalized**: converting an
offset to `Z` would decide what a misconfigured deployment meant.

An unusable clock fails closed with `internal-invariant` before the policy or the service runs, and
the guard itself throws on a non-finite instant rather than falling back to epoch zero — which would
expire every entry on the next claim and admit every replay.

**Deliberate limitation.** It is a `Map`, and it gives **no cross-replica guarantee**: two ingress
processes behind a load balancer each keep their own view, so one request could be served once by
each. That is acceptable while nothing is deployed. **Before any multi-replica or live deployment the
owner must choose either a shared durable claim store or a single-ingress routing guarantee.** This
slice adds no database and no migration, and inventing one would be a schema decision made by an
implementation detail.

### 11. Body safety

Bounded at **16 KiB** before parsing: a `Content-Length` over the limit is refused up front, and bytes
are counted as they arrive so a chunked request or a lying header is caught too. Then fatal UTF-8
decoding (the default decoder silently replaces invalid sequences, which would mean the bytes signed
and the text parsed are not the same thing), then JSON, then the strict schema. Only
`application/json`, optionally with `charset=utf-8`; any other type or a non-identity
`Content-Encoding` is `415`. **No decompression** — decompressing untrusted input before
authenticating it is its own hazard.

### 12. The response is minimal, and omits continuity

Protocol, version, `requestId`, the tenant/conversation/message identity, `disposition`, `reason`, and
`authorizedReply` **or `null`**. That is all.

No `continuity` — the working state of a conversation is Jarvis's, and putting it on a wire makes it
something a QuickFurno server can read, cache and come to depend on. No `discovery`,
`fieldProvenance`, `summaryConfirmed`, `completionEvidenceRef`, `runId`, `provenance`, `modelDrafted`,
`coreConsulted`, `proposalDigest`, `idempotencyKey`, model, provider, prompt, database detail or
stack.

**`authorizedReply !== undefined` is the ONLY gate on client-facing text.** `disposition ===
'PROCESSED'` is deliberately not it — a turn is processed whether or not Core authorized anything to
say. A result carrying a reply under a non-`PROCESSED` disposition, or naming a different
conversation, is self-contradicting evidence and fails closed with no body at all. The body is copied
byte for byte: no trim, rewrite, template, markdown or citation insertion.

### 13. Status mapping, and no retry

`200` served · `400` malformed/schema · `401` authentication · `404` path · `405` method · `409`
replay/conflict · `413` too large · `415` media/encoding · `500` policy or internal invariant · `503`
replay-guard saturation or service unavailable.

There is **no `Retry-After` and no automatic retry**. A transport that transparently retried this POST
after an ambiguous failure would risk a second agent turn for one thing a person said. A future
QuickFurno caller policy may issue a **new signed `requestId`** instead.

### 14. Headers and error privacy

Every response: `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`,
`Pragma: no-cache`, `X-Content-Type-Options: nosniff`. Never
`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials` or `Set-Cookie`. No session state.

Ten closed error codes with fixed messages. No request or response body is logged; nothing logs at
all. No `normalizedText`, reply body, `subjectRef`, signature, key bytes, raw JSON, continuity,
downstream stack, zod issue, crypto error, socket error or SQL ever leaves this boundary. `dataClass`
is deliberately not logged either in this first slice.

### 15. What it does not touch

No QuickFurno repository change, shared filesystem contract, sync file, client, route, migration,
secret or browser JavaScript. No QuickFurno service-role credential. No n8n, WhatsApp, Meta, SMS,
email, telephony, provider send or delivery lifecycle — **an HTTP response to a QuickFurno server is
not provider delivery.** No database change: migrations stay exactly `0001`–`0011`, `0011` is
byte-identical, there is no `0012`, and the managed database is not accessed. No continuity schema,
`NeedDiscovery`, phase, provenance, CAS, extraction or reducer change: **RWC-P4 remains NOT STARTED**,
and **RUI-3A remains NOT STARTED**.

## Consequences

- A QuickFurno server can, for the first time, reach Riya — once somebody deploys this, which nobody
  has.
- QuickFurno must implement the caller side of this wire contract in its own governed slice,
  including holding the Ed25519 private key and deriving `dataClass` server-side.
- The replay guard's process-local scope is a real constraint on how this may be deployed. It is
  recorded here rather than left for whoever writes the deployment manifest to discover.
- Adding a field to the request or response is a wire-contract change, not an implementation detail.

## Change-control rule

The absence of `dataClass` from the wire (§5), the required synchronous server-side policy with no
default (§6), Jarvis holding public keys only (§7), the signature binding raw body bytes and routing
identity (§8), the single `service.handleTurn` delegation, the omission of continuity from the wire
(§12) and `authorizedReply` as the sole text gate are owner-locked. Weakening any of them requires a
new ADR, not an edit to this one.

**Next.** RUI-3A — the QuickFurno-side web integration — under its own governance, only after this
ingress is owner-reviewed and merged.
