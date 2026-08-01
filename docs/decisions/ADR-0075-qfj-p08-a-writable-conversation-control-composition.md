# ADR-0075 — QFJ-P08-A Writable Conversation Control Composition

**Status:** Accepted — QFJ-P08-A PR 2 of 2 (composition, capability interfaces and the first snapshot producer; no persistence, no API, no UI)
**Deciders:** Owner
**Relates to:** [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0074](./ADR-0074-qfj-p08-a-conversation-control-command-foundation.md)

## Context

Baseline: `main` at `8981c49e46ebe43c7b3343d9671fb6a344fe7125` — the merge of PR #77, which landed
[ADR-0074](./ADR-0074-qfj-p08-a-conversation-control-command-foundation.md).

ADR-0074 supplied **pure command semantics only**: a strict, content-free, revision-bound operator
command contract and a deterministic reducer for `TAKE_OWNERSHIP`, `RELEASE_OWNERSHIP`, `PAUSE_AI` and
`RESUME_AI`. It stored nothing, exposed no port and composed into nothing. It said so.

So on the merged baseline the asymmetry it diagnosed is still live: the authoritative source is

```ts
AuthoritativeConversationStatePort { read(conversationId): Promise<ConversationControlState> }
```

read-only. Every M1–M4 gate obeys `humanTakeover` and `aiPaused`; nothing can set them. The missing
piece is the composition:

```
operator command → the SAME authoritative state object → atomic, revision-bound application
                 → the next inbound turn reads that object → M1–M4 gates observe it → AI stops
```

## Decision

### 1. One source. No split brain.

`JarvisRuntimeConfig` keeps **exactly one** `authoritativeState` field. This ADR adds no
`controlStateWriter`, no `controlStore`, no `operatorState`, no secondary cache and no second state
source — because the failure mode is specific and silent: an operator would set a takeover on one
object while the next inbound turn read another and kept replying, and every test that checked either
object in isolation would pass.

The writable and projecting capabilities are therefore **detected on the same object** the inbound
path already reads. Detection is a private structural check; no runtime helper is exported, because a
caller who could ask "is this writable?" would be building a service locator.

### 2. The base read contract is unchanged

`AuthoritativeConversationStatePort.read` is byte-for-byte the same, so every existing read-only
implementation stays valid and every existing inbound path is untouched. The new capabilities are
**type-only optional extensions**:

```ts
WritableAuthoritativeConversationStatePort            extends …Port { applyControlCommand(cmd) }
OperationsProjectingAuthoritativeConversationStatePort extends …Port { readOperationsProjection(id) }
OperatorAuthoritativeConversationStatePort            extends both
```

No runtime symbol is added for any of them.

### 3. `applyControlCommand` is an ATOMIC boundary

The interface's contract — stated in the type, not merely hoped for — requires an implementation to
apply exactly ADR-0074's semantics, compare `expectedRevision` against the authoritative current
revision, make an `APPLIED` state authoritative before resolving, leave state untouched on
`NO_CHANGE`/`REFUSED`, and combine **read + decide + write into one atomic/transactional/CAS
operation**.

A persistent implementation that read, decided, then wrote would let a second operator change the
revision in between; the later write would silently clobber a decision made against state that no
longer existed. That is why the composition does **not** do:

```ts
const state = await source.read(); //  NOT this
const decision = reducer(state, command); //  NOT this
await source.write(decision.nextState); //  NOT this
```

The composition validates the input, calls the adapter **exactly once**, and validates the answer.
Running the reducer here as well would create a second application path and, if the two disagreed, no
principled way to choose between them.

**No persistent implementation exists.** The only implementation is the deterministic in-process fake
under `@qf-jarvis/jarvis-runtime/testing`, which is test support and not durability.

### 4. The operations projection returns `{ state, … }`

`conversationId`, `revision`, `partyType`, `humanTakeover` and `aiPaused` all come from ONE
authoritative control record nested in the projection, not from a second cache that could disagree
with it. A persistent adapter can fetch that record and its six supplemental tokens atomically.

The projection contract has **no `assignedActor` field**. Letting an injected source name the actor
would make it an assignment authority, which ADR-0054 reserves for `assignAgent`.

### 5. The operations snapshot gains `revision` — agent-runtime 45 → 46

The query an operator SEES and the command an operator ISSUES must share one concurrency token. Every
control command carries `expectedRevision`; a snapshot that omitted the revision would force an
operator surface either to perform an invisible second read — racing the one it just did — or to
submit an unbound mutation. Both defeat the point of `expectedRevision`.

So `CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS` becomes exactly **12** fields, in order:

```
conversationId · revision · assignedActor · partyType · conversationState · lastActivityAt
aiPaused · humanTakeover · escalationStatus · followUpStatus · deliveryStatePlaceholder · auditRef
```

and M1 gains its first constructor, `createConversationOperationsSnapshot`. That is the **one**
intentional root runtime expansion in this phase: `agent-runtime` 45 → 46. No other agent-runtime
runtime symbol changes; `assignAgent`, the transition vocabulary, the proposal vocabulary, the runtime
reasons, `processInbound`, M2 orchestration and behaviour routing are all untouched.

The snapshot stays **content-free**: no tenant, data class, subject, message, prompt, reply, model,
provider, recipient, operator reference, approval or consent. `operatorRef` and `reasonRef` live in
the command's audit record, not in a general conversation projection. Status and audit fields are
TOKENS — a value containing a space is rejected, because free text is the one shape through which a
message body would enter.

### 6. Production fabricates nothing

The composition may derive exactly **one** value: `assignedActor`, through M1's existing `assignAgent`
— reuse of the same pure function the inbound path uses, not a second router. It copies
`conversationId`, `revision`, `partyType`, `humanTakeover` and `aiPaused` from the authoritative
record, and copies the six supplemental tokens verbatim from the injected source.

It must NOT infer `conversationState`, `lastActivityAt`, `escalationStatus`, `followUpStatus`,
`deliveryStatePlaceholder` or `auditRef`. Deriving `conversationState` from `aiPaused` would silently
define new conversation-state transitions inside `jarvis-runtime`; deriving `auditRef` from a revision
or command id would attest to a correlation nobody recorded. A missing or invalid projection is
**refused, not repaired**.

The deterministic test fake does use a synthetic mapping (`humanTakeover → HUMAN_TAKEOVER`, else
`aiPaused → WAITING_EXTERNAL`, else `ACTIVE_AI`) so specs read coherently. It is documented in place
as **synthetic test behaviour only, not a production business rule**, and is not exported as a mapper.

### 7. Three runtime methods; `processInbound` unchanged

```ts
JarvisRuntime {
  processInbound(envelope)
  applyConversationControlCommand(input)
  readConversationOperationsSnapshot(conversationId)
}
```

`processInbound` behaviour is unchanged, and `DEFAULT_RUNTIME_REF` stays `qfj.jarvis-runtime.s3ib`:
this phase adds an orthogonal operator surface, and bumping the inbound provenance reference would
churn every inbound turn to describe a change that did not affect it.

The control method takes **input**, not a pre-materialized command, so the composition boundary itself
invokes `createConversationControlCommand` and untrusted structural input cannot reach an
authoritative source having skipped validation. The runtime generates nothing — no `commandId`,
`operatorRef`, `reasonRef` or `issuedAt` — and does not consult `config.clock()`.

`jarvis-runtime`'s root runtime count stays **6**: the new surface is methods on the existing factory
result plus type-only exports.

### 8. Both injected boundaries fail closed

| Failure                        | Result                                                  |
| ------------------------------ | ------------------------------------------------------- |
| command input invalid          | `control-invalid-command` (source never called)         |
| no writable capability         | `control-unavailable`                                   |
| source throws or rejects       | `control-source-failure`                                |
| returned decision inconsistent | `control-invalid-result`                                |
| conversation id invalid        | `operations-invalid-conversation` (source never called) |
| no projection capability       | `operations-unavailable`                                |
| projection throws or rejects   | `operations-source-failure`                             |
| projection or snapshot invalid | `operations-invalid-result`                             |

Thrown values are **discarded** — never logged, copied into a reason, attached to observability, or
returned. No retry, no fallback, no second call.

A foreign decision is **canonicalized**, never passed through by identity: outcome/reason pairing,
every command correlation field, and the revision arithmetic each outcome implies are all
cross-checked, and a fresh deeply frozen record is rebuilt from the command and the validated next
state. A source could otherwise keep a reference to the object it returned and mutate it afterwards.

## Rejected alternatives

- **A second writable state config field.** The split brain in §1.
- **Read → reduce → write in the composition.** The lost-update race in §3.
- **Re-running the reducer after the adapter applied it.** Two application paths, two answers.
- **Letting the projection supply `assignedActor`.** Makes an injected object an assignment authority.
- **Inferring `conversationState` from the control flags in production.** Defines conversation-state
  transitions as a side effect of a boolean.
- **Returning the foreign decision object directly.** Unvalidated, and still mutable by its source.
- **Bumping `DEFAULT_RUNTIME_REF`.** Provenance churn on every inbound turn for an unrelated change.
- **Reusing the approval contracts for these four commands.** A conversation takeover is an operator
  control action, not approval of a proposed business action; `ApprovalDecisionV1` stays future work.
- **Shipping an HTTP route or a UI here.** Neither is testable as a boundary yet, and both need
  authentication this phase does not provide.

## Consequences

The Jarvis composition root can now apply an operator control command through the same authoritative
source the inbound path reads, and the next real turn observes it. The cross-runtime proof is
explicit: `TAKE_OWNERSHIP` → the next `processInbound` refuses with `orchestration-human-takeover` and
the model and Core transport counters do not move; `RELEASE_OWNERSHIP` → still refused, now
`orchestration-ai-paused`; `RESUME_AI` → the next turn runs with exactly one model call and one Core
decision.

**First-producer claim, precisely.** The composition root can produce a validated
`ConversationOperationsSnapshot` **from an injected authoritative operations projection on the same
state source**. It is not persisted, there is no dashboard, and QuickFurno Core is not emitting the
projection. The only concrete source in this phase is deterministic test support.

API locks: `agent-runtime` **46**, `jarvis-runtime` **6**, `conversation-control` **9**, and every
other package unchanged — contracts 369, model-evaluation 33, model-gateway 71,
model-gateway-composition 2, groq-staging-smoke 24, event-backbone 39, model-reply-adapter 8,
core-decision-adapter 18, riya-agent 16, anisha-agent 14, prompt-registry 7, governed-knowledge 26,
rag-provisioning 13, event-ingestion 14, apps/api 0.

Dependency graph: `jarvis-runtime → conversation-control` is added; `conversation-control` stays
`zod`-only with no reverse edge, so the graph remains acyclic. No new third-party dependency.

## What this is NOT

**No operator authentication.** `operatorRef` is an attribution reference, not proof of identity.
There is no HTTP route, session, RBAC, API key, OAuth, user lookup or permission store. A future
operator API **must** authenticate and authorize before calling these methods. This is not a console.

**No persistence and no durable idempotency.** The only mutable implementation is under `./testing`,
in process memory: no restart survival, no cross-process concurrency, no durable command-id dedup, no
transaction. `commandId` remains future durable-dedup material only.

**No business authority.** Control authority is take/release ownership and pause/resume AI. It does
not approve a business action, approve money, approve a refund, verify a vendor, activate a package,
change an entitlement, send a message, accept a model proposal, or override QuickFurno Core, which
remains the final business authority.

**QFJ-P08-A is complete after this PR; canonical QFJ-P08 is NOT.** Consent state, opt-out enforcement,
the approval request/decision runtime, broader human control and the operator interface all remain
unimplemented.

**QFJ-P09 has not started.** No transport, queue, webhook, outbound path, WhatsApp or n8n.

**NO_MIGRATION_REQUIRED**: migrations remain exactly `0001`–`0007`, no `0008`. **Production rollout
remains OFF.**

## Phase status and next step

Merging this completes QFJ-P08-A. The next step is **a fresh QFJ-P08 remaining-gap and schema audit**
— consent, opt-out, approval runtime, operator API authentication and control persistence — **not**
automatic QFJ-P09 activation. Persistence and an operator API each require their own schema audit and
separate migration authorisation.

## Non-goals

No second authoritative state source · no production database adapter · no persistence · no durable
idempotency · no operator HTTP/API · no authentication or RBAC · no operator UI · no approval runtime ·
no consent/opt-out runtime · no P09 transport · no WhatsApp · no n8n · no live Core call · no provider
or live model call · no credential or environment read · no migration · no deployment or activation ·
no CANARY/ACTIVE/FALLBACK · no RAG · no memory · no dataset or training · no send, deliver, execute,
authorize or persist.

## Change-control rule

There stays exactly ONE `authoritativeState` config field; adding a second writable state source
requires a superseding ADR. `applyControlCommand` stays the atomic application boundary — moving the
reducer into the composition, or adding a retry, a fallback or a second call, requires a superseding
ADR. `assignedActor` stays derived only through `assignAgent`, and the projection contract never gains
an actor field. Production never infers `conversationState`, `escalationStatus`, `followUpStatus`,
`deliveryStatePlaceholder` or `auditRef`. The snapshot stays content-free and token-only. Failures at
either injected boundary stay normalized with the thrown value discarded. And conversation control
never becomes business, financial, approval or Core authority.
