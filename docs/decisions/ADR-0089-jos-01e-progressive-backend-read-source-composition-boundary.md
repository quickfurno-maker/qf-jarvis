# ADR-0089 — JOS-01E Progressive Backend Read-Source Composition Boundary

**Status:** Accepted — JOS-01E (the final slice of the bounded Jarvis OS foundation track)
**Deciders:** Owner
**Relates to:** [ADR-0086](./ADR-0086-jos-01b-read-only-control-plane-contract-and-snapshot-api.md) · [ADR-0087](./ADR-0087-jos-01c-owner-authentication-and-operator-session-boundary.md) · [ADR-0088](./ADR-0088-jos-01d-isolated-docker-vps-traefik-deployment-boundary.md)

## Context

JOS-01B made the control plane truthful by compiling every figure in from merged repository and
governance state. That was the right call and it is terminal: there was no way for a real
observation to reach the snapshot without rewriting the builder, and "rewrite the builder" is how a
single unreviewed adapter ends up able to change anything on the page.

JOS-01E adds the governed mechanism for consuming real observations **one approved source at a
time**. It is not "connect the backend".

## Decision

### 1. A source declares what it may speak for, in data

`ControlPlaneReadSource` carries an `id`, a `label`, an `owns` list of section names, and a `read()`.
Composition applies a source's contribution to the sections it owns and to nothing else.

Declaring ownership as data rather than inferring it from what `read()` happens to return means
"what can this adapter change?" is answerable by reading one line. Two sources claiming one section
is a hard error, so authority cannot be silently transferred by adding an adapter.

`coreSync` is closed to every adapter. It states which records QuickFurno Core owns; letting a
Jarvis adapter rewrite it would let Jarvis re-describe the authority boundary it is subject to —
the one claim this application must never be able to make about itself.

### 2. `read()` is synchronous, and the impure half stays at the boundary

An adapter fetching inside the builder would make snapshot construction impure, non-deterministic
and dependent on network timing — and the builder's whole value is that the page and the API
provably produce the same bytes from the same inputs.

So whoever serves the request performs any I/O, constructs the source around the result, and hands
it in, exactly as `generatedAt` is already injected. A future HTTP-backed adapter is constructed
after its `await`, not during composition. There is still no self-fetch from a server component.

### 3. Read-only, with no authority, by construction

The interface names nothing that could act: no `send`, `execute`, `approve`, `write`, `update`,
`delete` or `mutate`, and no `canExecute` / `canSend` / `isAuthorized`. `rollout.enabled` is a
`z.literal(false)` and the authority block is four literals, so a snapshot claiming rollout is on or
that Jarvis authorizes anything **cannot be parsed at all** — by any client, on any platform. That
is a property of the contract, not a rule composition has to police.

### 4. Unavailable is still not empty

A source that cannot be read degrades **only its own sections** to `NOT_CONNECTED` with no rows. It
never becomes an empty success, because "0 approvals waiting" and "nobody asked" must never render
the same way.

Two failure classes are treated differently on purpose. An operational failure degrades its own
sections and leaves the rest of the snapshot — still true, still worth showing. A structural failure
(duplicate ownership, a contribution for an unowned section, a closed section) throws and abandons
the whole snapshot: that is a governance defect, and the composition it would produce is not
trustworthy anywhere.

A source that throws is treated as unavailable, never as success, and its exception never reaches an
operator. The reason shown is fixed prose, because an adapter's error text is the most likely place
for a host, a path, a query or a token to appear.

### 5. Source freshness stays separate from `generatedAt`

The JOS-01B rule is unchanged and now load-bearing: `generatedAt` is when the JSON was produced,
`source.freshness` is when the underlying facts were observed, and a request may move the first but
never the second.

The `source` block is **derived** from what the sources actually did. Nothing observed →
`REPOSITORY_BASELINE` / `BUILD_DECLARATION` / `liveOperationalData: false`, which is every request in
this release. A source genuinely reads something → `LIVE_ADAPTER` / `REQUEST_TIME` / `true`, all
three together, because the contract rejects any other combination.

A repository baseline can never claim request-time freshness merely because it was assembled while
answering a request.

### 6. No source is adopted in this release, and that is the honest outcome

`ADOPTED_READ_SOURCES` is empty. Nothing in merged `main` can be read from inside Jarvis OS without
crossing a boundary this phase may not cross:

- **QuickFurno Core** has no adopted read protocol. Inventing an endpoint, token or Supabase query
  would fabricate connectivity, and Core owns business truth regardless. Core stays `NOT_CONNECTED`.
- **n8n** has no adopted read protocol, and the test-only execution bridge belongs to **QFJ-P09.02**.
  n8n stays `NOT_CONNECTED`.
- The **durable runtimes** (`postgres-conversation-state`, `postgres-approval-queue`) need
  managed-database credentials. Granting a read-only surface a connection string to make panels look
  populated would hand it exactly the reach it was designed not to have.
- The **processing runtimes** (`agent-runtime`, `jarvis-runtime`) transform envelopes and hold no
  observable state. `createConversationOperationsSnapshot` is a SHAPE over records supplied to it,
  not a source of them.

So the control plane says exactly what it said before. What JOS-01E delivers is the machinery: a
source becomes adoptable when its canonical QFJ owner exposes a **governed read protocol**, and
adoption is then a one-line registry change plus a review — not another builder rewrite.

Shipping the mechanism untested until the day something real depends on it would be worse, so
composition is proved end to end with injected deterministic sources.

### 7. No database, no migration, rollout OFF

No migration. The set remains `0001`–`0009`; there is no `0010`. Jarvis OS reaches no database, and
production business rollout remains **OFF**.

## Consequences

- The bounded Jarvis OS foundation track **closes** with this slice. The roadmap carries one
  `current` JOS marker and deliberately **no** JOS `next` — naming a successor would mean inventing
  one.
- Main Jarvis work resumes at **QFJ-P09.02** (test-only authorized dispatch envelope / n8n bridge
  validation), which is the only `next` marker in the roadmap.
- JOS-01D is recorded as **merged**. That describes the code. Whether a deployment is currently
  running stays an operational fact an operator verifies against the host — this build asserts no
  live service about itself.

## Non-goals

No Core connection. No n8n connection. No Meta or model-provider connection. No database access. No
migration. No write capability. No business authority in Jarvis OS. No new backend server. No
dashboard redesign. No Android files.

## Change-control rule

Adopting a read source requires: a governed read protocol published by that source's canonical QFJ
owner; an entry in `ADOPTED_READ_SOURCES` naming the sections it owns; and a review. Widening what
an adopted source may own, or opening `coreSync` to adapters, requires a superseding ADR.
