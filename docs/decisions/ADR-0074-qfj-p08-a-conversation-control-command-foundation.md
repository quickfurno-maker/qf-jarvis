# ADR-0074 — QFJ-P08-A Conversation Control Command Foundation

**Status:** Accepted — QFJ-P08-A (contracts and a pure reducer; no port, no composition, no persistence)
**Deciders:** Owner
**Relates to:** [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0073](./ADR-0073-authoritative-prompt-binding.md)

## Context

This slice is owned by **QFJ-P08 — Consent, Approval and Human Control**. The post-S3-I reconciliation
audit classified the next governed phase as `NEXT_IS_QFJ_P08_MINIMUM_HUMAN_CONTROL`, and this ADR
records the first bounded piece of it.

The audit found a specific asymmetry on merged `main`. The runtime already **obeys** human control
perfectly: `ConversationControlState.humanTakeover` and `.aiPaused` are read through one authoritative
source and gate every path in M1, M2, M3, M4, M5, `riya-agent` and `anisha-agent`. But that port is:

```ts
read(conversationId: string): Promise<ConversationControlState>
```

Read-only. **No production code in this repository can set or clear either flag.** The runtime obeys a
takeover it has no way to declare.

That is not an abstract gap. Canonical QFJ-P09 declares `Dependencies: QFJ-P08`. The MVP capability
matrix lists the human control console as `FULLY_ACTIVE` — the only `FULLY_ACTIVE` capability with no
implementation at all. The launch gate reads "Human takeover stops AI — 100%", and the launch-readiness
runbook marks both the kill switches and human takeover `[UNIMPLEMENTED]`. Building a transport that
can reach a real recipient before the stop switch exists would invert the one dependency that matters.

## Decision

### 1. A new leaf package, and only a mechanism

`@qf-jarvis/conversation-control`, depending on `zod` and nothing else:

```
conversation-control  ->  zod
```

No workspace runtime dependency, no Node built-in, no network, no environment, no clock, no
randomness. It is a true leaf with no project references — which is what will let QFJ-P08-A PR 2
compose it from `jarvis-runtime` without inverting anything.

It answers exactly one question: _given this validated control fragment and this validated operator
command, what is the deterministic next fragment and what evidence describes the transition?_ It does
not store the answer, expose a port, or make anything authoritative.

### 2. A control FRAGMENT, not a second conversation state

The snapshot is four fields — `conversationId`, `revision`, `humanTakeover`, `aiPaused` — and
deliberately **not** a copy of `jarvis-runtime`'s `ConversationControlState`. `tenantId`, `partyType`,
`dataClass`, `cancelled`, `subjectStatus`, `subjectRef` and `observedAt` are read by the M1–M4 gates
and are owned there. A second package that also declared them would be a second definition of what a
conversation is, and the two would drift the first time either changed. A spec asserts their absence.

`humanTakeover === true` with `aiPaused === false` is **accepted as input**. It is not a state this
reducer can produce, but the authoritative source is owned elsewhere and may be mid-migration or
hand-corrected. Refusing to read it would fail closed in the direction of leaving AI running, which is
the wrong direction.

### 3. Four actions, and the return-to-AI asymmetry

| Action              | Effect                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `TAKE_OWNERSHIP`    | enters takeover **and forces the AI pause**                                                    |
| `RELEASE_OWNERSHIP` | exits takeover and **leaves AI paused**                                                        |
| `PAUSE_AI`          | pauses; ownership untouched                                                                    |
| `RESUME_AI`         | the **only** action that may clear the pause; **refused** while a human holds the conversation |

That asymmetry is ADR-0054 §E, not a preference: _"Return-to-AI requires an explicit authorized
runtime transition — there is no automatic release from human takeover."_ ADR-0054 additionally
rejects auto-release outright. So `RELEASE_OWNERSHIP → humanTakeover false + aiPaused false` is
**forbidden**: an operator finishing their work is not the same decision as declaring the conversation
safe for AI again, and collapsing the two would make every handoff silently re-arm automatic replies.
A dedicated regression drives `TAKE_OWNERSHIP → RELEASE_OWNERSHIP → RESUME_AI` and asserts the middle
state is `false / true`.

`TAKE_OWNERSHIP` forcing the pause is the mirror image: the launch gate is "human takeover stops AI =
100%", and leaving the pause to a second command that might not arrive would make that gate depend on
operator discipline.

### 4. Revision-bound, with three outcomes and five reasons

Every command carries an `expectedRevision`. Outcomes are `APPLIED` (revision + 1), `NO_CHANGE` (same
revision) and `REFUSED` (same revision). Reasons are `applied`, `already-satisfied`,
`revision-mismatch`, `human-takeover-active` and `revision-exhausted`.

Order matters, and each step is a different kind of wrongness:

1. a command for another conversation **throws** `invalid-application` — it is a wiring error, and
   refusing it would return a plausible decision for a conversation nobody asked about;
2. `expectedRevision` is checked **before** the action semantics, so a stale operator gets
   `revision-mismatch` rather than a confident answer computed from state they never saw. Staleness
   also takes precedence over exhaustion: their problem is that they are looking at an old
   conversation;
3. action safety — only `RESUME_AI` refuses here;
4. overflow, but **only when a change is required**. A `NO_CHANGE` at `MAX_SAFE_INTEGER` is a valid
   no-op; nothing needs counting.

`NO_CHANGE` is distinct from `APPLIED` because a re-issued command must be visibly a no-op rather than
silently advancing the revision — a bump that changed nothing would invalidate every other operator's
`expectedRevision` for no reason.

### 5. Opaque references, caller-supplied time, content-free evidence

`operatorRef` and `reasonRef` are **opaque identifiers**, not a name, email, phone number or free-text
justification. That is what makes a control command safe to write into audit evidence unredacted; free
text is the field through which message content and customer detail would arrive. There is no metadata
bag, because a metadata bag is how a content-free contract stops being content-free.

`issuedAt` is **caller-supplied** and validated to an exact canonical UTC millisecond form that
round-trips. This package reads no clock: a control record whose time it invented would be evidence
about this package rather than about the operator. The round-trip check is what rejects
`2026-02-30T00:00:00.000Z`, which parses and would otherwise be recorded as a date nobody wrote.

Every valid command against a valid snapshot produces **one immutable audit record** — for `REFUSED`
and `NO_CHANGE` too. "An operator tried to resume AI while a colleague held the conversation" is
exactly what an operations review needs, and a record that only existed on success would make refusals
invisible. Every field is an opaque reference, a closed token, a boolean or an integer.

### 6. No persistence, and no durable idempotency claim

There is no database, repository, SQL, file store, queue, event append, cache, scheduler or
module-level map. The reducer is pure and synchronous.

This PR therefore makes **no durable idempotency claim.** It does not and cannot assert that a
duplicated `commandId` executes once. What it does is carry `commandId` into the audit evidence, so
the identifier a future store would key on is already there rather than needing to be retrofitted.
What is proven here is weaker and true: the same canonical state and command yield a deep-equal
decision, `NO_CHANGE` is explicit, and a stale `expectedRevision` is refused.

### 7. What this is not

**This is not QFJ-P08.** Consent state, opt-out enforcement, the approval request/decision runtime,
broader human control and the operator interface all remain unimplemented. The Conversation Operations
Center remains, as ADR-0054 §L says, a contract with no producer.

No writable authoritative-state port, no `jarvis-runtime` composition, no HTTP, no API, no UI, no
transport, no provider, no Core call, no WhatsApp, no n8n. No existing production package is modified.
No assignment semantics change: M1's `assignAgent` remains the sole assignment authority, and nothing
here can name an actor.

## Rejected alternatives

- **`RELEASE_OWNERSHIP` also resuming AI.** Forbidden by ADR-0054 §E, and the failure it produces is
  silent: every handoff would re-arm automatic replies without anyone deciding to.
- **A timeout that auto-releases takeover.** Already rejected by ADR-0054 and not reintroduced here.
- **`TAKE_OWNERSHIP` leaving the pause to a separate command.** Makes the "takeover stops AI" gate
  depend on operator discipline rather than on the contract.
- **Duplicating the full `ConversationControlState`.** Two definitions of a conversation, guaranteed
  to drift.
- **A free-text `reason` field.** The one field through which message content and customer detail
  would enter content-free evidence.
- **Generating `commandId` or `issuedAt` here.** An id this package invented could not be correlated
  with the request that produced it, and an instant it invented would be its own clock.
- **An in-memory command store for idempotency.** Would let this PR claim a durability property it
  cannot honour across a process restart — worse than not claiming it.
- **Shipping the writable port in the same PR.** Composition changes `jarvis-runtime` behaviour and
  deserves its own reviewed slice; the semantics have to be settled first.

## Consequences

The deterministic semantics of the four control actions now exist, are exhaustively tested across
every flag combination, and are provably free of content, clock, randomness and stored state. The
`RELEASE_OWNERSHIP` / `RESUME_AI` asymmetry is enforced by a spec rather than by review discipline.

Every prior package-root runtime API count is unchanged: contracts 369, model-evaluation 33,
model-gateway 71, model-gateway-composition 2, groq-staging-smoke 24, event-backbone 39, agent-runtime
45, model-reply-adapter 8, core-decision-adapter 18, jarvis-runtime 6, riya-agent 16, anisha-agent 14,
prompt-registry 7, apps/api 0. The new package is locked at **9** root runtime symbols and 11 type
exports.

Nothing composes the reducer, so runtime behaviour on every existing path is byte-for-byte unchanged.

## Phase status

**QFJ-P08-A PR 1 of 2, and QFJ-P08 remains INCOMPLETE.** PR 2 will compose this reducer behind a
writable authoritative-state adapter in `jarvis-runtime` and produce the first real
`ConversationOperationsSnapshot`. Durable persistence and an operator API are a **later** slice that
requires its own schema audit and separate migration authorisation — the P08 persistence question is
currently classified `UNKNOWN_NEEDS_SCHEMA_AUDIT`.

**QFJ-P09 has not started.** No transport, no queue, no webhook, no outbound path.

**NO_MIGRATION_REQUIRED**: migrations remain exactly `0001`–`0007`, no `0008`. **Production rollout
remains OFF.**

## Non-goals

No writable authoritative-state port · no Jarvis composition · no operator HTTP/API · no operator UI ·
no persistence, database, Supabase or migration · no durable idempotency · no consent runtime · no
approval runtime · no opt-out enforcement · no P09 transport · no WhatsApp · no n8n · no live Core
call · no provider or live model call · no credential or environment read · no deployment or
activation · no CANARY/ACTIVE/FALLBACK · no RAG · no memory · no dataset or training · no send,
execute, authorize or persist.

## Change-control rule

The four actions are the vocabulary; adding one — especially an assignment, approval, resolution, send
or execute action — requires a superseding ADR. `RELEASE_OWNERSHIP` never resumes AI and `RESUME_AI`
stays the only action that may clear the pause; changing either requires superseding ADR-0054 §E.
Commands stay revision-bound, references stay opaque, `issuedAt` stays caller-supplied, and the audit
record stays content-free with no free-text or metadata field. This package never gains persistence, a
clock, randomness, a network call, or the ability to assign an actor — and conversation control never
becomes business, financial, approval or Core authority.
