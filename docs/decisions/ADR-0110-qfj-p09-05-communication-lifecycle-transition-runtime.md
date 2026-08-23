# ADR-0110 — QFJ-P09.05: communication lifecycle transition runtime

**Status:** Accepted — offline coordination policy only (no persistence, no transport, no new
migration, no managed-database access, no Core call, no n8n, no WhatsApp, no provider, no rollout).
QFJ-P09 remains **INCOMPLETE**.

**Date:** 2026-08-23

**Supersedes:** nothing.
[ADR-0083](./ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md) remains the owner
of communication authorization correlation, and its body is unchanged. The communication contracts
are **reused**, not extended: no schema in `@qf-jarvis/contracts` is modified by this slice.

---

## Context

`packages/contracts/src/communications/communication-state.ts` has carried the eighteen authoritative
communication states since Phase 2, and `communication-state-record.ts` has carried the record that
describes where a governed communication stands. Between them they already enforce the thing a
single record **can** enforce — reference integrity, so a state that exists only because Core
decided, dispatched or recorded something has to carry the artifact proving it.

And they say, in the record's own header, exactly what they do **not** enforce:

> The approved model includes a state diagram. This contract does not encode it as a matrix […] a
> single record is a point-in-time fact, and transition validity is a stateful question about
> history. `previousState` is carried as optional _evidence_, not as a validated edge. **Transition
> enforcement is the coordination layer's job in a later phase** — stated plainly so that nobody
> assumes this schema already did it.

That layer did not exist. Nothing in merged `main` could answer "did this lifecycle move legally?",
and the gap is not theoretical. A record with `state: 'delivered'`, a real `executionResultId`, and
`previousState: 'draft'` is a **completely valid** `CommunicationStateRecordV1` today. Every
validator in the repository accepts it. It asserts that a message reached a person without Core ever
having authorized it, and the only thing standing between that record and a founder-facing green tick
was that no consumer had been built yet.

Schema validation was never going to close this. The schema sees one record; the question is about
two.

## Decision

Add **QFJ-P09.05 — Communication Lifecycle Transition Runtime**: one new package,
`@qf-jarvis/communication-lifecycle-runtime`, holding one pure synchronous function and nothing else.

```
evaluateCommunicationLifecycleTransition({ current, next })
```

`current` is the canonical record the governed communication currently stands at, or `null` for
lifecycle start. `next` is the candidate. The function re-parses **both** with
`communicationStateRecordV1Schema`, then applies four coordination rules in a fixed order —
identity, history, ordering, edge — and returns a frozen verdict.

### The graph is reused, not reinvented

The eighteen-state graph comes verbatim from the `stateDiagram-v2` block in
[docs/architecture/communication-model.md](../architecture/communication-model.md): thirty-seven
edges, `draft` the only start, `completed` the only sink, and no self-transition anywhere.

It is represented as `Record<CommunicationState, readonly CommunicationState[]>` — **total** over the
canonical vocabulary. Adding a nineteenth state to `COMMUNICATION_STATES` fails to compile here until
somebody writes down what that state may become. There is no `transitions[state] ?? []` and no
`default:` branch, because both readings of a fallback are wrong and both are silent: an empty
fallback makes a legitimate new state a dead end, and a permissive one lets an undecided state reach
`delivered`.

A spec re-derives the expected edges **from the markdown document on every run** and compares them
against the constant. Editing the diagram without editing the table fails; editing the table without
editing the diagram fails too. Neither can drift quietly.

### `previousState` becomes required evidence at the boundary — and stays optional in the contract

For every non-initial transition, `next.previousState` must be present and must equal `current.state`.
That converts an optional point-in-time field into **required coordination evidence at the
transition-validation boundary**, without changing the record schema at all. A stored record with no
`previousState` remains perfectly valid on its own; a record offered as a _movement_ is not.

The runtime does not repair the candidate. It will not insert a missing `previousState`, because a
coordination layer that fills in the evidence it then checks is checking its own handwriting.

### Lifecycle start is context, not a nineteenth state

`current: null` **is** the start condition. There is no `START` member of `COMMUNICATION_STATES` and
this package does not add one — inventing one would fork the vocabulary and hand every consumer a
value the canonical contract has never heard of. A first record must be `draft` and must carry no
`previousState`; a first record in any other state fails closed.

### Identity continuity is five fields, and deliberately only five

`communicationId`, `channel`, `recipient` (both halves of the opaque `{ entityType, entityId }`
pair), `purposeCode` and `correlationId` must not move while a lifecycle runs.

`approvalDecisionId`, `executionIntentId` and `executionResultId` are **not** continuity fields, and
requiring them to stay identical would be a defect rather than extra rigour: a `draft` has none of
them, an `authorized` record has a decision id it could not have had before Core decided, and a
`delivered` record has an execution result id that did not exist at submission. They legitimately
appear as the lifecycle advances, and they are governed where they belong — by the canonical schema's
per-state evidence rules, which this package leaves entirely alone and does not restate.

### Timestamps: non-regression, not sequencing

`next.recordedAt` must not be strictly earlier than `current.recordedAt`, compared with the canonical
`isStrictlyBefore`. **Equal timestamps are accepted.** The canonical timestamp contract permits
second-granularity instants, so two records legitimately written inside the same second carry the
same value; refusing them would invent a sub-second sequencing precision this slice does not own and
the contract does not have. No clock is read, so a replayed transition answers identically tomorrow.

### The verdict is `LIFECYCLE_CONSISTENT`, and that is all it is

Success is `{ ok: true }` with no other field. Refusal is `{ ok: false, reason }` drawn from a closed
thirteen-member vocabulary, with **no generic bucket** — no `invalid`, `other`, `unknown` or `error`
a refusal could be laundered into. Zod's issues are discarded rather than summarised, because they
quote the values that failed and those values include a recipient reference, a purpose code and a
human-facing explanation. A refusal that travels into a log line, a screenshot or a support ticket
must not take a recipient with it.

`ok: true` does **not** mean `canSend`, `canExecute`, `isAuthorized`, `consentValid`, `eligible`,
`sent`, `delivered`, `providerSucceeded` or `permissionGranted`, and none of those fields exists.
Consider the case most worth getting wrong: a `delivered` record whose transition is perfectly
consistent. The verdict says the movement from `provider-accepted` to `delivered` is legal and the
record evidences it. It says nothing about whether a message reached a person — _"no provider state
becomes authoritative until Core records it"_, and this runtime never spoke to Core, to n8n or to a
provider. A consumer that renders a tick on `ok: true` has invented a fact.

Nor is consistency permission looking forward. A consistent move into `authorized` authorizes
nothing: **QuickFurno Core remains authoritative**, and eligibility is revalidated at execution time
by Core and the QF Communications Runtime regardless of anything decided here.

### It cannot create authority

There is no `setState`, `advanceTo`, `markDelivered`, `authorize`, `send` or `execute` — not as a
method and not as a capability the package could acquire, because it depends on `@qf-jarvis/contracts`
and nothing else. It builds no record, mutates no input, reads no clock, persists nothing, emits
nothing, owns no table and issues no DDL.

## Consequences

- A `draft -> delivered` record is now refusable, and is refused twice over: the edge is not in the
  graph, and `previousState` is checked against the record actually being left rather than trusted.
- The eighteen-state vocabulary and the state-record schema gain a consumer that makes them
  load-bearing in a way no single-record validator could.
- `docs/architecture/communication-model.md` becomes executable governance: its diagram is parsed and
  asserted, so it can no longer describe one lifecycle while the code implements another.
- Every future coordination layer that moves a communication has one place to ask whether the move is
  legal, instead of each rebuilding the matrix.

### What this slice deliberately does not do

- **No persistence.** No migration (`0001`–`0012`, no `0013`), no table, no DDL, no connection. The
  managed database is untouched.
- **No transport.** No URL, webhook, endpoint, n8n client, workflow id, credential, provider client,
  message or recipient resolution.
- **No producer.** Nothing in this repository yet creates `CommunicationStateRecordV1` records for it
  to validate, and no package or application imports it.
- **No consent, opt-out, suppression, STOP/START or eligibility state**, in keeping with
  communication-model.md and ADR-0083. Jarvis holds no consent database and never will.

**QFJ-P09 remains INCOMPLETE.** Still absent: a real adopted Core -> n8n transport and its
composition, execution-time communications eligibility integration, a producer of communication state
records, provider dispatch, provider results and reconciliation, and production rollout. **Live send
remains OFF.** WhatsApp is not activated, no provider is integrated, and the exit criteria of QFJ-P09
are not satisfied by this slice — validating that a lifecycle moved legally is not the same as
running one.
