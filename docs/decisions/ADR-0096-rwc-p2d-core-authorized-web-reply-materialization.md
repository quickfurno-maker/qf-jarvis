# ADR-0096 — RWC-P2D Core-Authorized Web Reply Materialization

**Status:** Accepted — RWC-P2D. Implemented on `rwc-p2d-core-authorized-web-reply-materialization`, **not merged**, and composed into nothing.
**Deciders:** Owner
**Relates to:** [ADR-0094](./ADR-0094-rwc-p2c-private-riya-web-conversation-service.md) · [ADR-0095](./ADR-0095-rwc-p2b-durable-postgres-riya-conversation-continuity.md) · [ADR-0093](./ADR-0093-rwc-p2a-riya-conversational-continuity-contract.md) · [ADR-0092](./ADR-0092-jrw-0b-governed-web-runtime-channel.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition.md) · [ADR-0056](./ADR-0056-qfj-m3-core-decision-adapter.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md)

**Baseline.** RWC-P2B merged as PR #100 — reviewed head `fb2f09da9df2dfcd0c6035b15e2939ae4867353e`, merge commit `596a768fa9de53cddb3831ebfe5094bba4bbada9`. Migration `0011` SHA-256 `80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93`; migrations `0001`–`0011` are the approved exact set and there is no `0012`.

## Context

A validated model reply body already survives inside the M2 orchestration result until the final
QuickFurno Core decision is known. M5's composition reads it exactly once — to compute the boolean
`modelDrafted` — and then deliberately throws it away, returning a content-free
`JarvisRuntimeResult`.

RWC-P2C (ADR-0094) recorded that as a finding rather than an omission, and it was right about the
case it considered: what a turn produces is a proposal stamped `PENDING_CORE_VALIDATION`, and a
DRAFT is not a message anybody is cleared to send. Its result therefore has no `replyText` field at
all, because an optional one that could never be populated is worse than its absence.

But that reasoning covers only the unauthorized case. It says nothing about a proposal QuickFurno
Core has **already authorized** under the existing M2/M3 contract — and there is currently no way to
obtain that body either. RWC-P2C calls the runtime once and cannot return reply text; a future
private ingress would have nothing to hand a browser even after Core said yes.

## Decision

### 1. The ordinary result stays content-free. A separate capability carries text.

`JarvisRuntimeResult` gains **no** `replyText`, `replyBody`, `draft`, `prompt` or `authorizedReply`
field, and `processInbound`'s observable shape is unchanged.

This is the load-bearing choice. Callers are entitled to treat that object as safe operational
output — the kind of thing a logger, a metric or a trace span may be handed whole. Adding
client-facing text to it would silently convert every existing whole-result log into a retainer of
model output, at no call site anybody edited. Nothing would break; things would merely start
recording what they never recorded before.

So the runtime gains a fourth method instead:

```ts
processInboundForCoreAuthorizedReply(
  envelope: InboundEnvelope,
): Promise<JarvisCoreAuthorizedReplyResult>;
```

returning `{ runtimeResult, authorizedReply }`, where `authorizedReply` is
`JarvisCoreAuthorizedReplyV1 | undefined`:

```ts
interface JarvisCoreAuthorizedReplyV1 {
  readonly version: 1;
  readonly proposalId: string;
  readonly boundRevision: number;
  readonly proposalKind: 'REPLY' | 'FOLLOW_UP';
  readonly replyBody: string;
}
```

A caller that wants content has to name a method that says so. `createJarvisRuntime` returns
`CoreAuthorizedReplyJarvisRuntime`, which **extends** `JarvisRuntime`, so every consumer typed
against the three-method contract keeps working and there is no second factory. The added barrel
exports are **types only** — the exported VALUE surface is still exactly six symbols.

### 2. One inbound call performs exactly one agent turn

Both public paths share ONE internal primitive, `composeAndProcessDetailed`, which runs the existing
M1–M4 pipeline once and reports it twice. `processInbound` calls it and drops the materialization;
`processInboundForCoreAuthorizedReply` calls it and returns everything. Neither is implemented in
terms of the other, and the content-bearing method is **not** "`processInbound` plus extra work".

There is no second model call, no second Core call, no replayed `runAgentTurn`, no second
orchestrator and no retry. One inbound call to either method is at most one agent turn.

### 3. The exact materialization condition

`authorizedReply` exists **if and only if**, in the SAME completed run:

1. the orchestration result is `ok: true`;
2. the final Core decision outcome is exactly `ACCEPTED`;
3. the runtime outcome therefore resolves to `CORE_ACCEPTED`;
4. `proposal.replyBody` is present and non-empty;
5. the proposal kind is `REPLY` or `FOLLOW_UP`.

Otherwise it is `undefined`.

The body is the validated proposal body **byte for byte**. No rewriting, trimming, second model
call, safety paraphrase, template substitution, markdown conversion, URL expansion, citation
insertion or business-data enrichment. P2D is authorization-preserving materialization, not another
generation stage.

### 4. The `REPLY`/`FOLLOW_UP` kind gate is mandatory

M3's `buildCoreCommand` forwards `proposedReplyBody` **only** for `REPLY` and `FOLLOW_UP`; for every
other kind the body is dropped and Core never sees it. Meanwhile M2 retains `replyBody` on the
proposal object regardless of kind.

So a body travelling with, say, an `ESCALATE_TO_HUMAN` proposal was never part of what Core
approved — Core decided about a command that had no body in it. Materializing it would present
unreviewed text as Core-authorized.

Today this is defence in depth: Riya's escalation decisions carry `modelReplyEligible: false`, so no
draft is requested and no body exists to leak. That is a property of one behaviour adapter, not of
this contract, and a future adapter that escalated _and_ drafted would breach it. The gate is
therefore enforced and tested directly, including the combination the current pipeline cannot
produce.

### 5. The M3 post-response state gate wins

Materialization reads the **final** M3 outcome, never the raw Core transport response.

M3 returns `ACCEPTED` only after its own post-response authoritative-state re-read passes. If Core
answers `ACCEPTED` but the conversation was cancelled, taken over, paused or drifted while that
answer was in flight, M3 downgrades the decision and `CORE_ACCEPTED` is never produced — so no body
is materialized.

Nothing captures the body inside `CoreDecisionTransport`, before `validateResponse`, before the
post-response gate, or from the raw serialized response. Reading the final decision is what makes
that gate impossible to bypass rather than merely conventional.

### 6. Core acceptance is NOT delivery

`CORE_ACCEPTED` means QuickFurno Core authorized the exact proposal under the existing M2/M3
contract. It does **not** mean the browser received it, an HTTP response was written, WhatsApp or
any provider accepted it, or that anything was sent, delivered, read, executed or persisted.

No name in this slice is `RESPONDED`, `SENT`, `DELIVERED`, `PUBLISHED` or `DISPATCHED`, and
production source contains none of those tokens. `authorizedReply` is approved content available to
a trusted private caller. Actual ingress and delivery remain later work.

### 7. The web service returns a versioned V2 result

`RiyaWebConversationResultV1` is kept **frozen and historical**. Its own documentation promises there
is no reply text in it, and a consumer already reading `version: 1` is entitled to that promise
holding. Adding a content field to it would falsify a published contract silently.

`RiyaWebConversationResultV2` adds exactly one key, `authorizedReply`. The dispositions are
unchanged — `PROCESSED`, `REFUSED`, `NOT_READY` — and `PROCESSED` still does not mean replied:

| situation                                                     | `authorizedReply` |
| ------------------------------------------------------------- | ----------------- |
| Core accepted a `REPLY`/`FOLLOW_UP` with a body               | present           |
| `MODEL_DRAFTED`, no Core transport wired                      | absent            |
| Core accepted a proposal carrying no client text              | absent            |
| Core rejected / deferred / was unavailable / revision drifted | absent            |

A future ingress adapter must require `authorizedReply !== undefined` before returning AI text.
`disposition === 'PROCESSED'` is **not** that check.

Changing `handleTurn`'s return type is safe because containment proves it: no application composes
this service, and the single package importing it (`postgres-riya-conversation-continuity-store`)
takes **port types only** and never calls `handleTurn`.

### 8. The service requires the capability, and cross-checks what it gets

`RiyaWebConversationServiceConfig.runtime` is now `CoreAuthorizedReplyJarvisRuntime`. Construction
fails closed unless the supplied object exposes the whole mature runtime surface **and** the new
capability — a bare `{ processInboundForCoreAuthorizedReply }` object is a content provider somebody
assembled, and duck-typing one as the authoritative runtime is how a gate stops being reached.

`handleTurn` calls `processInboundForCoreAuthorizedReply` **exactly once** and never calls ordinary
`processInbound` in addition. Before returning a body it requires the materialization to agree with
its own run: `CORE_ACCEPTED`, `modelDrafted`, matching `proposalId` and `boundRevision`, a
text-carrying kind, and a body within the existing M2 bound. A contradiction fails closed through
the **existing** `repository-invariant` code, whose fixed message carries no body, no identifier and
no outcome.

### 9. Nothing is persisted, and nothing is logged

Reply content is transient. It is not written to the continuity state, the event backbone, an event
payload, an error message, an exception cause, a metric label, provenance or a console. No
transcript or history storage is added. The content-free observability contracts stay content-free,
and sentinel-leakage tests assert it rather than asserting the absence of a field.

### 10. Continuity, persistence and boundaries are untouched

Continuity semantics remain exactly RWC-P2C/P2B: load before the runtime, initialize atomically if
absent, use the store's winner, return it **unchanged**, never `compareAndSet`, no phase transition,
no extraction, no provenance merge. RWC-P4 still owns evolution.

**No migration.** The set stays exactly `0001`–`0011`, `0011`'s bytes are unchanged, there is no
`0012`, and the managed database is not accessed. If a future requirement appears to need durable
reply storage, that is an owner review, not a migration somebody adds here.

## Consequences

- A private caller can, for the first time, obtain the exact text QuickFurno Core authorized.
- Ordinary operational output is unchanged, so existing logging and telemetry retain nothing new.
- The runtime's concrete method set grows from three to four. That is deliberate and recorded here;
  the containment locks that pinned "exactly three" are restated at four rather than dropped.
- `RiyaWebConversationResultV1` becomes historical. Consumers move by reading a version number.
- The kind gate must be re-examined if any behaviour adapter ever makes a non-text-carrying proposal
  model-eligible.

## What this does NOT implement

No HTTP server, route, URL, cookie, CORS, HMAC, webhook or browser reachability. No ingress. No
second Core approval endpoint, second Core decision port or second action contract. No n8n step, no
provider call, no send or delivery of any kind. No QuickFurno repository change, shared/sync file,
shared filesystem, shared database or service-role credential. No RWC-P4 extraction, reducer,
provenance merge or phase transition. No RUI-3A. No migration and no managed-database access.

## Change-control rule

The five materialization conditions in §3, the kind gate in §4 and the post-response precedence in
§5 are owner-locked. Weakening any of them — materializing before the final decision, materializing
for another kind, transforming the body, or moving the capture point into the transport — requires a
new ADR, not an edit to this one.

**Next slice.** The **private Riya web ingress adapter**, deliberately unnumbered here. It owns
authentication, authorization, server-side `dataClass` derivation and the rule that a browser may
never choose its own classification. RUI-3A comes only after that boundary exists.
