# ADR-0094 — RWC-P2C Private Riya Web Conversation Service

**Status:** Accepted — RWC-P2C. Private application service only; no public endpoint, no database, no live extraction.
**Deciders:** Owner
**Relates to:** [ADR-0093](./ADR-0093-rwc-p2a-riya-conversational-continuity-contract.md) · [ADR-0092](./ADR-0092-jrw-0b-governed-web-runtime-channel.md) · [ADR-0068](./ADR-0068-riya-authoritative-runtime-composition.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0076](./ADR-0076-qfj-p08-b-tenant-scoped-authoritative-state.md)

## Context

JRW-0B made `WEB` a legal runtime channel. RWC-P2A defined the working state a conversation carries
between turns. Neither could be reached: nothing in the repository accepts a web turn.

**Baseline.** PR #98 (RWC-P2A) merged as `beed86c57a1d8bd2d56d0b826eb0bef5009373ed`, containing
corrected head `6a42d0b342a7b715a5f8fd5cc80b056b5e46587d`.

## Decision

### 1. A private, transport-neutral application service

`@qf-jarvis/riya-web-conversation-service` accepts one trusted WEB turn and returns one bounded
result. It is **not** the public QuickFurno web API, and it adds no HTTP server, route, URL, cookie,
CORS header or browser reachability.

The ingress is deliberately absent. Service and store semantics have to be owner-reviewed _before_ a
network can reach them, and an endpoint built in the same slice as the thing it exposes is an
endpoint reviewed at the same moment as the thing it exposes.

### 2. What a trusted private caller supplies, and what no caller supplies

A **trusted private caller** supplies the tenant, conversation and message identity, the current
message content, and a **server-derived** `RuntimeDataClass`.

No caller supplies what the turn IS. `channel: 'WEB'`, `partyType: 'CLIENT'` and
`direction: 'INBOUND'` are literals inside the service. So are the actor, model, prompt, tools and
`runtimeId`. Authority and business state — consent, `canSubmit`, a lead, a vendor, a city, a price —
have no field at all. None appears in the request shape, and the schema is `.strict()`, so supplying
one is a **refusal** rather than a silently dropped field.

That matters because the intended caller relays a browser. A browser that could name its own
`partyType` could have Riya answer it as a vendor, through prompt-selection rules that are
scope-bound by design.

`webTurnRef` maps to the runtime's existing `providerMessageRef`. The mature cross-runtime field is
**not renamed for the web** — ADR-0092 §3 already established it as opaque and provider-neutral, and
renaming it for one surface would be a breaking change made for tidiness.

### 2a. `dataClass` is accepted from a trusted caller, and is never browser input

RWC-P2C accepts `dataClass` from its trusted private caller because the authoritative runtime
requires classified data: routing a turn safely is not possible without knowing whether its content
may leave a hosted boundary. **This does not authorize a browser to choose classification.**

Any future ingress adapter must **derive or assign `RuntimeDataClass` under governed server-side
policy** and must **not forward a browser-supplied classification field**. A visitor who could label
their own content `HOSTED_ALLOWED` could route HUMAN_ONLY material to a hosted model, which is the
one failure the class exists to prevent. **Direct browser access to P2C remains forbidden.**

**P2C does not authenticate the provenance of `dataClass`, and cannot.** It has no ingress, no
authentication and no notion of a browser — it accepts the classification its caller asserts. That
proof belongs to the ingress adapter, and it is a substantial part of why the adapter remains a
**separate, later slice** rather than something bundled into this one: a boundary that both accepts
a classification and vouches for it would have no reviewable seam between the two.

`dataClass` is deliberately not renamed, not hard-coded to a single class, and not derived by a
classifier here. Hard-coding would make the runtime's own routing decision meaningless, and a
classifier inside this service would be P2C inventing an authority it has not been given.

### 3. Exactly one delegation to the existing authoritative runtime

The service holds an **already-composed** `JarvisRuntime` and calls its existing public
`processInbound` once per turn. No retry, no fallback, no second call.

**No jarvis-runtime API change was required**, and none was made — its public surface is unchanged
at six symbols. The service composes nothing, decides nothing about actors, prompts, models or Core,
and duplicates no gate: `humanTakeover`, `aiPaused`, `cancelled`, data class, party type, subject
status and the revision double-gate all remain the runtime's. It deep-imports no private module; a
containment spec proves `createOrchestrator`, `runAgentTurn`, `orchestrateInbound` and
`composeAndProcess` appear nowhere in it.

### 4. No fabricated `ClientSalesSignals`

`JarvisRuntimeConfig.behaviourInput` is **optional**, and its own documentation states that when
absent "the runtime takes the legacy `REPLY` path unchanged and Riya behaviour is never consulted".
P2C reuses exactly that supported mode.

Manufacturing all-false signals to force the behaviour kernel to run would be inventing an input
nobody supplied, in order to reach a code path this slice has no authority over — and the fabricated
value would look, to every later reader, like something a client actually indicated. RWC-P4 owns
that seam.

### 5. Continuity is loaded or initialized BEFORE the runtime, and returned unchanged

The service loads the P2A state; if none exists it builds the canonical initial state through the
**real** `createRiyaConversationContinuityState` — `INTRO`, revision `0`, all seven discovery fields
outstanding — and offers it to the store's atomic create-if-absent.

Continuity is established first because a turn that cannot account for its own conversation must not
reach a model: it would produce a proposal about a conversation nobody can identify.

**After the runtime returns, nothing is written.** Phase, discovery, provenance, `summaryConfirmed`,
`completionEvidenceRef` and `continuityRevision` are all returned exactly as loaded, and
`compareAndSet` is never called on a turn path. A spec sends a message naming a service, a location,
a budget and a timeline, and proves the state is byte-identical afterwards — because RWC-P4 owns
extraction, phase transitions and provenance merge.

### 6. The store is a PORT with three methods and no implementation

`load` · `createInitialIfAbsent` · `compareAndSet`.

A turn uses the first two. `compareAndSet` is declared and never called, and that is the point of
this slice: RWC-P2A created `continuityRevision` as its own counter, and a port that omitted the
operation that counter exists for would let P2B design a schema without knowing it needed optimistic
concurrency — discovering it after the table existed.

**There is no default implementation, and there must not be.** A deterministic in-memory fake lives
under `src/tests/` and is excluded from the emitting build. An in-memory default would pass every
test in this repository and lose every conversation on restart: a client would return to a concierge
that had forgotten the project they were mid-way through describing. The constructor **requires** an
injected store, and refuses a partial one.

The race rule is the store's, not the service's. Two simultaneous first turns may compute the same
candidate; only `createInitialIfAbsent` decides which won, and **both callers then use the state it
returns** — never their own candidate. There is no in-process mutex, global lock, advisory lock or
retry loop.

### 7. Non-streaming: one promise in, one final result out

No `AsyncIterable`, stream, SSE, `WebSocket`, `onToken`, chunk, delta or partial. ADR-0092 §8
already settled why: `validateReplyDraft` checks every claimed citation against the plan's permitted
set, and a partial token stream cannot be citation-validated.

### 8. There is no reply text, and the served disposition is not called `RESPONDED`

**`JarvisRuntimeResult` carries no client-facing text.** It reports an outcome, a run id, whether a
model drafted, whether Core was consulted, a closed refusal reason and a content-free provenance
record. The draft's `replyBody` is read once inside the composition — only to compute the boolean
`modelDrafted` — and never leaves.

That is the permanent boundary showing through: what a turn produces today is a proposal stamped
`PENDING_CORE_VALIDATION`, not a message anybody is cleared to send.

So this contract carries **no `replyText` field at all**. An optional field that could never be
populated would be worse than its absence: a consumer would write the branch that reads it, the
branch would never run, and nobody would notice until somebody made it run.

And the served disposition is **`PROCESSED`**, not `RESPONDED`, because nothing responded. This
repository has made the same call before — QFJ-P09.02's bridge counts `handoffs`, never `sent` or
`delivered`, and the eighteen-state model refuses to collapse `provider-accepted` into `delivered`.
A field name is the first thing someone reads when deciding what a system did.

The three dispositions are `PROCESSED` · `REFUSED` · `NOT_READY`, mapped exhaustively from the
runtime's own outcome union so a new outcome upstream fails to compile here rather than being
guessed into one of them.

### 9. Uncertainty fails closed

Four bounded codes — `invalid-input`, `continuity-unavailable`, `runtime-unavailable`,
`repository-invariant` — each with a fixed, content-free message. No SQL, host, provider name,
credential, stack, nested error or client text escapes.

An unavailable store never becomes a fresh conversation; a throwing runtime never becomes a served
turn. There is deliberately **no `continuity-conflict`**: the service never calls `compareAndSet`, so
it is unreachable, and a code for a path that cannot happen would imply a behaviour that does not
exist.

A store that answers about a **different** conversation is a `repository-invariant`: serving the turn
anyway would attach one client's continuity to another's message.

### 10. Boundaries unchanged

No transcript, history or rolling summary — the request carries at most one current
`normalizedText`, and the store holds only P2A state. No consent, `canSubmit`, lead, vendor, city or
pricing authority; QuickFurno Core remains final, and any action-like proposal stays
`PENDING_CORE_VALIDATION`. No provider, n8n or delivery. No migration and no managed-database access.
The QuickFurno repository is untouched and `lib/riya-ui/jarvisClient.ts` does not exist.

## Consequences

- Migrations remain `0001`–`0010`, byte-identical; there is no `0011`.
- `RUNTIME_CHANNELS`, `COMMUNICATION_CHANNELS`, the P2A public API and the `jarvis-runtime` public
  API are all unchanged.
- Nothing in the repository imports this service. It is a capability with its proof, and composing
  it behind an ingress is a later slice.
- **RWC-P2B has not started. RUI-3A has not started. RWC-P1D/P1E/P1F remain parked.** Live public
  Riya remains **OFF**.

> **Superseded in part by [ADR-0095](./ADR-0095-rwc-p2b-durable-postgres-riya-conversation-continuity.md).**
> The two bullets above were true when this decision was taken. RWC-P2B has since executed the
> `SCHEMA_REQUIRED` verdict: migration `0011_riya_conversation_continuity.sql` exists and the durable
> store is implemented, unmerged and composed into nothing. `0001`–`0010` remain byte-identical.
> RUI-3A has still not started, the parked phases are still parked, and live public Riya is still
> **OFF**.

## What this does NOT implement

A public endpoint or ingress adapter · a browser session token · a QuickFurno adapter · a durable
continuity store · a migration · streaming · live extraction · phase transitions · provenance merge ·
consent · lead creation · City Context · provider delivery.

## Change-control rule

Adding an HTTP route, a public endpoint, browser reachability, a default store implementation, a
transcript field, streaming, a phase or provenance reducer, or any write to continuity on a turn
path each require a superseding ADR. So does calling the authoritative runtime more than once per
turn, deep-importing another package's private module, or introducing a `replyText` field —
returning client-facing text is a decision about what Jarvis is cleared to say, not a convenience.

So does relaxing §2a: hard-coding `dataClass`, deriving it inside this service, or building an
ingress that forwards a browser-supplied classification instead of assigning one server-side.
